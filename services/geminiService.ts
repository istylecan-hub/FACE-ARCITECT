import { GoogleGenAI, Type, Schema } from "@google/genai";
import { FaceAnalysisResult, ModelType, SwapSettings } from "../types";

// Helper to remove data URL prefix
const stripBase64 = (dataUrl: string) => {
  return dataUrl.split(',')[1] || dataUrl;
};

// Initialize Gemini Client
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables");
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeFace = async (imageBase64: string): Promise<FaceAnalysisResult> => {
  const client = getClient();
  
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      face_box: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Bounding box [ymin, xmin, ymax, xmax]" },
      landmarks: { 
        type: Type.OBJECT, 
        properties: {
          left_eye: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Left eye coordinates [x, y]" },
          right_eye: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Right eye coordinates [x, y]" },
          nose_tip: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Nose tip coordinates [x, y]" },
          mouth_center: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Mouth center coordinates [x, y]" },
          jawline: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } }, description: "Array of points along the jawline" }
        }, 
        description: "Key facial landmarks" 
      },
      skin_tone: { type: Type.STRING, description: "Estimated skin tone (e.g., Fair, Medium, Dark)" },
      undertone: { type: Type.STRING, description: "Warm, Cool, or Neutral" },
      lighting: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING },
          intensity: { type: Type.NUMBER },
          color_temperature: { type: Type.STRING }
        }
      },
      face_scale_ratio: { type: Type.NUMBER, description: "Ratio of face area to total image area" },
      confidence: { type: Type.NUMBER }
    },
    required: ["face_box", "skin_tone", "lighting", "landmarks"]
  };

  const response = await client.models.generateContent({
    model: ModelType.GEMINI_3_PRO,
    contents: {
      parts: [
        { inlineData: { mimeType: "image/png", data: stripBase64(imageBase64) } },
        { text: "Analyze the primary face in this image. Extract landmarks, skin tone, lighting conditions, and face scale." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      systemInstruction: "You are an expert computer vision analyzer. Output strict JSON."
    }
  });

  const text = response.text;
  if (!text) throw new Error("No analysis returned");
  return JSON.parse(text) as FaceAnalysisResult;
};

export const performFaceSwap = async (
  sourceFaceBase64: string,
  targetImageBase64: string,
  settings: SwapSettings
): Promise<string> => {
  const client = getClient();

  // Construct a detailed prompt based on settings
  const promptParts = [
    "You are a professional image editor using the Nano Banana Pro engine.",
    "Task: Replace the face in the SECOND image (Target) with the face from the FIRST image (Source).",
    "CRITICAL: Do NOT morph the faces. The goal is to fully swap the identity so the person looks exactly like the Source.",
    "CONSTRAINTS:",
    "- Replace eyes, nose, mouth, and facial structure completely with the Source identity.",
    "- Preserve the neck, body, outfit, pose, and background of the Target image exactly.",
    "- Seamlessly blend the edges (forehead, jawline) without altering the Source identity.",
    settings.preserveHair ? "- Preserve the hair of the Target image." : "- Adapt the hair from the Source if it fits better, otherwise keep Target hair.",
    settings.matchSkinTone ? "- Color grade the Source face to match the Target body's skin tone exactly." : "- Keep original Source skin tone.",
    settings.matchLighting ? "- Re-light the Source face to match the Target scene's lighting direction and intensity." : "",
    ` - Apply a skin smoothness level of ${settings.skinSmoothness}/10.`,
    ` - Generate with an output quality/fidelity level of ${settings.outputQuality}/100.`,
    "Output only the final high-quality image."
  ];

  const response = await client.models.generateContent({
    model: ModelType.GEMINI_3_PRO_IMAGE, // Maps to Nano Banana Pro for high quality
    contents: {
      parts: [
        { inlineData: { mimeType: "image/png", data: stripBase64(sourceFaceBase64) } },
        { inlineData: { mimeType: "image/png", data: stripBase64(targetImageBase64) } },
        { text: promptParts.join("\n") }
      ]
    },
    config: {
      // imageConfig for gemini-3-pro-image-preview
      imageConfig: {
        // We generally want to maintain the aspect ratio/size logic implicitly, 
        // but the API requires specific enums if set. 
        // We'll let the model infer from context or default to 1:1 if not specified, 
        // but often 'generateContent' for image editing just returns the image.
        // For 'gemini-3-pro-image-preview', we can request higher res.
        imageSize: "2K" 
      }
    }
  });

  // Extract image
  // The response structure for generateContent with image output:
  // candidates[0].content.parts[...].inlineData
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData && part.inlineData.data) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("No image generated in response");
};