import { GoogleGenAI, Type, Schema } from "@google/genai";
import { FaceAnalysisResult, ModelType, SwapSettings } from "../types";

const stripBase64 = (dataUrl: string) => {
  return dataUrl.split(',')[1] || dataUrl;
};

const getClient = () => {
  const apiKey = process.env.API_KEY; 
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

// COST SAVER: Resize image for Analysis to 800px max (Reduces tokens significantly)
const resizeForAnalysis = async (base64Str: string, maxDim = 800): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxDim) { height *= maxDim / width; width = maxDim; }
      } else {
        if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } else {
        reject(new Error("Canvas context failed"));
      }
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = base64Str;
  });
};

export const analyzeFace = async (imageBase64: string): Promise<FaceAnalysisResult> => {
  const client = getClient();
  const optimizedImage = await resizeForAnalysis(imageBase64);

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      face_box: { type: Type.ARRAY, items: { type: Type.NUMBER } },
      landmarks: { 
        type: Type.OBJECT, 
        properties: {
          left_eye: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          right_eye: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          nose_tip: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          mouth_center: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          jawline: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } }
        } 
      },
      skin_tone: { type: Type.STRING },
      undertone: { type: Type.STRING },
      lighting: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING },
          intensity: { type: Type.NUMBER },
          color_temperature: { type: Type.STRING }
        }
      },
      face_scale_ratio: { type: Type.NUMBER },
      confidence: { type: Type.NUMBER }
    },
    required: ["face_box", "skin_tone", "lighting", "landmarks"]
  };

  const response = await client.models.generateContent({
    // STRICTLY USING FLASH FOR ANALYSIS
    model: 'gemini-3-flash-preview', 
    contents: {
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: stripBase64(optimizedImage) } },
        { text: "Analyze the primary face. Output strict JSON." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
    }
  });

  const text = response.text;
  if (!text) throw new Error("No analysis returned");
  return JSON.parse(text) as FaceAnalysisResult;
};

export const performFaceSwap = async (
  sourceFacesBase64: string[], 
  targetImageBase64: string,
  settings: SwapSettings
): Promise<string> => {
  const client = getClient();

  const promptParts = [
    "You are an expert VFX artist.",
    "MISSION: Swap the face in the FINAL Target image with the identity provided in the Reference images.",
    "",
    `INPUT CONTEXT: You have been provided with ${sourceFacesBase64.length} reference images of the Source Identity.`,
    "Use ALL reference images to build a complete 3D understanding of the Source's facial structure, profiles, and unique features.",
    "",
    "STRICT IDENTITY REQUIREMENTS:",
    "1. LIKENESS: The output face must look EXACTLY like the Source identity.",
    "2. ANGLE HANDLING: If the Target is side-profile, use the side-profile Reference to ensure the nose and jawline are accurate.",
    "3. EYES: Strictly maintain the Source's eye shape and pupil distance.",
    "",
    "SETTINGS:",
    settings.preserveHair ? "- Preserve Target hair." : "- Adapt Source hair.",
    settings.matchSkinTone ? "- Grade Source skin to match Target body." : "- Keep Source skin tone.",
    settings.matchLighting ? "- Relight Source to match Target scene." : "",
    ` - Skin Smoothness: ${settings.skinSmoothness}/10`,
    ` - Fidelity: ${settings.outputQuality}/100`,
    "",
    "Output only the final image."
  ];

  // Prepare content parts
  const contentParts = [];
  
  // 1. Add All Source Faces
  sourceFacesBase64.forEach((face, index) => {
      contentParts.push({ 
          inlineData: { mimeType: "image/png", data: stripBase64(face) } 
      });
      contentParts.push({ text: `Reference Image ${index + 1} (Source Identity)` });
  });

  // 2. Add Target Image
  contentParts.push({ 
      inlineData: { mimeType: "image/png", data: stripBase64(targetImageBase64) } 
  });
  contentParts.push({ text: "Target Image (Swap Destination)" });

  // 3. Add Prompt
  contentParts.push({ text: promptParts.join("\n") });

  const response = await client.models.generateContent({
    model: ModelType.GEMINI_3_PRO_IMAGE,
    contents: {
      parts: contentParts
    },
    config: { 
      imageConfig: { imageSize: "2K" } 
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData && part.inlineData.data) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("No image generated");
};