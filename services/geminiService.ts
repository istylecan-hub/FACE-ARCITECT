import { GoogleGenAI, Type, Schema } from "@google/genai";
import { FaceAnalysisResult, ModelType, SwapSettings } from "../types";

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

const stripBase64 = (dataUrl: string) => dataUrl.split(',')[1] || dataUrl;

const getMimeType = (dataUrl: string): string => {
  const match = dataUrl.match(/data:([^;]+);/);
  return match?.[1] || 'image/png';
};

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found. Set API_KEY in .env.local");
  return new GoogleGenAI({ apiKey });
};

const resizeImage = (base64Str: string, maxDim: number, quality = 0.92): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error("Canvas context failed"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = base64Str;
  });

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, baseDelayMs = 1200): Promise<T> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable = err?.status === 429 || err?.status === 503 || err?.message?.includes('quota');
      if (attempt === retries - 1 || !isRetryable) throw err;
      await new Promise(r => setTimeout(r, baseDelayMs * (2 ** attempt)));
    }
  }
  throw new Error('Max retries exceeded');
};

// ─────────────────────────────────────────────
// DEEP FACE ANALYSIS
// ─────────────────────────────────────────────

export const analyzeFace = async (imageBase64: string): Promise<FaceAnalysisResult> => {
  const client = getClient();
  const optimizedImage = await resizeImage(imageBase64, 1024, 0.92);

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      face_box: { type: Type.ARRAY, items: { type: Type.NUMBER } },
      landmarks: {
        type: Type.OBJECT,
        properties: {
          left_eye:      { type: Type.ARRAY, items: { type: Type.NUMBER } },
          right_eye:     { type: Type.ARRAY, items: { type: Type.NUMBER } },
          left_eyebrow:  { type: Type.ARRAY, items: { type: Type.NUMBER } },
          right_eyebrow: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          nose_bridge:   { type: Type.ARRAY, items: { type: Type.NUMBER } },
          nose_tip:      { type: Type.ARRAY, items: { type: Type.NUMBER } },
          mouth_left:    { type: Type.ARRAY, items: { type: Type.NUMBER } },
          mouth_right:   { type: Type.ARRAY, items: { type: Type.NUMBER } },
          mouth_center:  { type: Type.ARRAY, items: { type: Type.NUMBER } },
          chin_center:   { type: Type.ARRAY, items: { type: Type.NUMBER } },
          jawline:       { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } },
        }
      },
      skin_tone:           { type: Type.STRING },
      skin_hex:            { type: Type.STRING },
      undertone:           { type: Type.STRING },
      lighting: {
        type: Type.OBJECT,
        properties: {
          direction:         { type: Type.STRING },
          intensity:         { type: Type.NUMBER },
          color_temperature: { type: Type.STRING },
          has_rim_light:     { type: Type.STRING },
          shadow_depth:      { type: Type.NUMBER },
        }
      },
      face_scale_ratio:    { type: Type.NUMBER },
      face_angle_yaw:      { type: Type.NUMBER },
      face_angle_pitch:    { type: Type.NUMBER },
      eye_distance_ratio:  { type: Type.NUMBER },
      facial_hair:         { type: Type.STRING },
      glasses:             { type: Type.STRING },
      expression:          { type: Type.STRING },
      approximate_age:     { type: Type.NUMBER },
      gender_presentation: { type: Type.STRING },
      emotions: {
        type: Type.OBJECT,
        properties: {
          primary: { type: Type.STRING },
          secondary: { type: Type.STRING },
          valence: { type: Type.NUMBER },
          arousal: { type: Type.NUMBER },
        }
      },
      facial_metrics: {
        type: Type.OBJECT,
        properties: {
          golden_ratio_score: { type: Type.NUMBER },
          face_shape: { type: Type.STRING },
          symmetry_score: { type: Type.NUMBER },
        }
      },
      confidence:          { type: Type.NUMBER },
    },
    required: ["face_box", "skin_tone", "skin_hex", "undertone", "lighting", "landmarks", "face_angle_yaw", "face_angle_pitch", "expression", "confidence"]
  };

  const response = await withRetry(() =>
    client.models.generateContent({
      model: ModelType.GEMINI_3_1_PRO,
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: stripBase64(optimizedImage) } },
          {
            text: `You are a precision facial cartography system for a production face-swap pipeline.
Analyze the DOMINANT face in this image with maximum precision.

Output requirements:
- face_box: tight normalized [x1, y1, x2, y2] where 0,0 is top-left, 1,1 is bottom-right
- landmarks: pixel-space [x, y]; jawline as array of [x,y] points (8-12 points along jaw arc)
- skin_hex: sample mid-cheek for truest skin color, output as #RRGGBB
- face_angle_yaw: head rotation in degrees (-45 left to +45 right, 0 = frontal)
- face_angle_pitch: head tilt degrees (-30 down to +30 up)
- lighting.shadow_depth: 0.0 (flat/diffuse) to 1.0 (deep dramatic shadows)
- lighting.has_rim_light: "yes" or "no"
- approximate_age: precise integer estimation
- gender_presentation: highly precise estimation
- emotions: primary and secondary emotions, valence (-1.0 to 1.0), arousal (0.0 to 1.0)
- facial_metrics: golden_ratio_score (0.0 to 1.0), face_shape, symmetry_score (0.0 to 1.0)

Be precise. Output strict JSON only.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      }
    })
  );

  const text = response.text;
  if (!text) throw new Error("No analysis returned");
  return JSON.parse(text) as FaceAnalysisResult;
};

// ─────────────────────────────────────────────
// CONTEXT-AWARE PROMPT BUILDER
// ─────────────────────────────────────────────

const buildSwapPrompt = (
  sourceFaceCount: number,
  settings: SwapSettings,
  sourceAnalysis: FaceAnalysisResult | null,
  targetAnalysis: FaceAnalysisResult | null
): string => {
  return `Seamlessly edit the target image to replace the person's face with the facial identity from the reference image(s).

The final image MUST be a flawless, unedited, photorealistic photograph. 

CRITICAL EDITING CONSTRAINTS (MANDATORY):
1. STRICT PHOTOREALISM: The result must look like a raw, natural photograph. Absolutely NO "plastic", "painted", "airbrushed", "filtered", or "3D render" appearance. Retain natural skin pores, fine lines, and photographic imperfections.
2. NO MAKEUP HALLUCINATION: Do NOT add heavy makeup (e.g., thick blue eyeliner, unnatural eyeshadow, heavy lipstick) unless it is explicitly present in the reference image. Keep the face looking natural.
3. PERFECT SKIN BLENDING: The skin tone, texture, and melanin level of the new face must PERFECTLY match the neck, chest, and arms in the TARGET image. The transition at the jawline, neck, and hairline must be completely invisible with zero blurring, seams, or color shifts.
4. MATCH TARGET ENVIRONMENT: The new face MUST inherit the exact lighting, shadows, color temperature, and film grain of the TARGET image. Do NOT bring the studio lighting or background colors from the reference image into the target.
5. PRESERVE SCENE: The hair, clothing, accessories, and background of the target image must remain 100% unchanged.

${settings.matchSkinTone ? 'Ensure strict skin tone matching with the target body.' : ''}
${settings.matchLighting ? 'Ensure strict relighting to match the target scene.' : ''}
${settings.preserveHair ? 'Preserve the target image hair exactly.' : ''}

${targetAnalysis ? `Target Scene Context: Lighting is ${targetAnalysis.lighting?.direction || 'natural'}, intensity ${targetAnalysis.lighting?.intensity?.toFixed(2) || 'medium'}.` : ''}
${sourceAnalysis ? `Reference Identity Context: ${sourceAnalysis.gender_presentation || 'Person'} with ${sourceAnalysis.facial_hair || 'no facial hair'}.` : ''}
`.trim();
};

// ─────────────────────────────────────────────
// MAIN FACE SWAP  
// ─────────────────────────────────────────────

export const performFaceSwap = async (
  sourceFacesBase64: string[],
  targetImageBase64: string,
  settings: SwapSettings,
  sourceAnalysis?: FaceAnalysisResult | null,
  onProgress?: (stage: string) => void
): Promise<string> => {
  const client = getClient();

  // Analyze the target for scene lighting + skin context
  onProgress?.('Analyzing target scene lighting...');
  let targetAnalysis: FaceAnalysisResult | null = null;
  try {
    targetAnalysis = await analyzeFace(targetImageBase64);
  } catch {
    console.warn('Target scene analysis failed — proceeding without context');
  }

  onProgress?.('Building context-aware composite prompt...');
  const finalPrompt = buildSwapPrompt(
    sourceFacesBase64.length,
    settings,
    sourceAnalysis ?? null,
    targetAnalysis
  );

  // Build multimodal content: references → target → prompt
  const contentParts: any[] = [];

  sourceFacesBase64.forEach((face, index) => {
    contentParts.push({ inlineData: { mimeType: getMimeType(face), data: stripBase64(face) } });
    contentParts.push({
      text: index === 0
        ? 'REFERENCE FACE — PRIMARY IDENTITY (highest priority)'
        : `REFERENCE FACE ${index + 1} — SUPPLEMENTAL (${index === 1 ? 'provides alternate angle for 3D reconstruction' : 'additional context'})`
    });
  });

  contentParts.push({ inlineData: { mimeType: getMimeType(targetImageBase64), data: stripBase64(targetImageBase64) } });
  contentParts.push({ text: 'TARGET IMAGE — Preserve all framing, clothing, background. Replace face only.' });
  contentParts.push({ text: finalPrompt });

  onProgress?.('Generating high-quality composite...');
  const response = await withRetry(() =>
    client.models.generateContent({
      model: ModelType.GEMINI_3_1_FLASH_IMAGE,
      contents: { parts: contentParts },
      config: { imageConfig: { imageSize: '2K' } }
    })
  );

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new Error(`No candidates returned. Feedback: ${JSON.stringify(response.promptFeedback)}`);
  }
  if (candidate.finishReason === 'SAFETY') {
    throw new Error(`Content policy filter triggered. Ratings: ${JSON.stringify(candidate.safetyRatings)}`);
  }

  for (const part of candidate.content?.parts || []) {
    if (part.inlineData?.data) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error(
    `Image generation failed. finishReason: ${candidate.finishReason ?? 'unknown'}. ` +
    `Text: ${candidate.content?.parts?.find(p => p.text)?.text?.slice(0, 200) ?? 'none'}`
  );
};
