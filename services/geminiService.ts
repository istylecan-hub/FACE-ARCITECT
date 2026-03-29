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

const getImageDimensions = (base64Str: string): Promise<{width: number, height: number}> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = base64Str;
  });

const getClosestAspectRatio = (width: number, height: number): string => {
  const ratio = width / height;
  const ratios = [
    { str: "1:1", val: 1 },
    { str: "4:3", val: 4/3 },
    { str: "3:4", val: 3/4 },
    { str: "16:9", val: 16/9 },
    { str: "9:16", val: 9/16 }
  ];
  return ratios.reduce((prev, curr) => 
    Math.abs(curr.val - ratio) < Math.abs(prev.val - ratio) ? curr : prev
  ).str;
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
    required: ["face_box", "skin_tone", "skin_hex", "undertone", "lighting", "landmarks", "face_angle_yaw", "face_angle_pitch", "face_scale_ratio", "eye_distance_ratio", "expression", "confidence"]
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
- face_scale_ratio: ratio of face width to total image width (0.0 to 1.0)
- eye_distance_ratio: ratio of inter-eye distance to face width (typically 0.3-0.5)
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
// FACE PRESENCE DETECTION
// ─────────────────────────────────────────────

export const detectFacePresence = async (imageBase64: string): Promise<{
  hasFace: boolean;
  neckPosition?: string;  // "top", "center", "visible-from-shoulders"
  bodyOrientation?: string; // "frontal", "side", "back", "3/4"
  headArea?: string; // where the head SHOULD be: "top-center", "top-left", "top-right"
  skinToneVisible?: string; // skin color from visible body parts
  skinHexVisible?: string;
  lightingDirection?: string;
  lightingTemp?: string;
}> => {
  const client = getClient();
  const optimized = await resizeImage(imageBase64, 1024, 0.85);

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      has_face:           { type: Type.BOOLEAN },
      neck_position:      { type: Type.STRING },
      body_orientation:   { type: Type.STRING },
      head_area:          { type: Type.STRING },
      skin_tone_visible:  { type: Type.STRING },
      skin_hex_visible:   { type: Type.STRING },
      lighting_direction: { type: Type.STRING },
      lighting_temp:      { type: Type.STRING },
      neck_width_ratio:   { type: Type.NUMBER },
      shoulders_visible:  { type: Type.BOOLEAN },
    },
    required: ["has_face", "neck_position", "body_orientation", "head_area", "skin_tone_visible", "lighting_direction"]
  };

  const response = await withRetry(() =>
    client.models.generateContent({
      model: ModelType.GEMINI_3_1_PRO,
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: stripBase64(optimized) } },
          {
            text: `Analyze this image for face presence and body context.

1. has_face: Is there a clearly visible human face in this image? (true/false)
2. neck_position: Where is the neck/top of body? ("top-of-frame", "visible-with-shoulders", "not-visible")
3. body_orientation: Body facing direction ("frontal", "slight-left", "slight-right", "side-left", "side-right", "back", "3/4-left", "3/4-right")
4. head_area: Where should the head be positioned if it were added? ("top-center", "top-left", "top-right", "above-frame")
5. skin_tone_visible: Describe visible skin tone from neck/arms/body ("fair", "light", "medium", "olive", "tan", "brown", "dark")
6. skin_hex_visible: Best hex color estimate of visible body skin as #RRGGBB
7. lighting_direction: Main light source direction ("left", "right", "front", "above", "behind", "natural-ambient")
8. lighting_temp: Color temperature ("warm", "neutral", "cool", "golden-hour", "overcast")
9. neck_width_ratio: Ratio of neck width to image width (0.0-1.0), estimate even if partially visible
10. shoulders_visible: Are shoulders clearly visible? (true/false)

Output strict JSON only.`
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
  if (!text) throw new Error("Face detection failed");
  const data = JSON.parse(text);
  
  return {
    hasFace: data.has_face,
    neckPosition: data.neck_position,
    bodyOrientation: data.body_orientation,
    headArea: data.head_area,
    skinToneVisible: data.skin_tone_visible,
    skinHexVisible: data.skin_hex_visible,
    lightingDirection: data.lighting_direction,
    lightingTemp: data.lighting_temp,
  };
};

// ─────────────────────────────────────────────
// FACE ADDITION PROMPT (for headless bodies)
// ─────────────────────────────────────────────

const buildFaceAdditionPrompt = (
  settings: SwapSettings,
  sourceAnalysis: FaceAnalysisResult | null,
  bodyContext: {
    bodyOrientation?: string;
    headArea?: string;
    skinToneVisible?: string;
    skinHexVisible?: string;
    lightingDirection?: string;
    lightingTemp?: string;
    neckPosition?: string;
  }
): string => {
  const lines: string[] = [];

  lines.push('You are given a REFERENCE FACE image and a TARGET BODY image that has NO visible face (the photo is cropped at the neck/shoulders, or the head is cut off).');
  lines.push('');
  lines.push('YOUR TASK: Generate and add the reference person\'s face/head onto the target body image, extending the image upward if needed to show the complete head naturally.');
  lines.push('');

  lines.push('=== CRITICAL RULES (ALL MANDATORY) ===');
  lines.push('');
  lines.push('1. NATURAL PHOTO EXTENSION: The result must look like the original uncropped photograph. The added head/face must appear as if the camera simply captured a wider frame. NO visible seam, NO artificial boundary between the original image and the added portion.');
  lines.push('');
  lines.push('2. ANATOMICAL ACCURACY: The head size, neck thickness, and proportions must be anatomically correct for the visible body. The head must sit naturally on the neck — not floating, not sunk into shoulders, not tilted unnaturally. Ensure the jawline and neck connect flawlessly.');
  lines.push('');
  lines.push('3. STRICT PHOTOREALISM: The added face must have the exact same photo quality, noise level, sharpness, depth of field, and grain as the original image. NO plastic/airbrushed/painted look. Keep natural skin pores, imperfections, and micro-textures.');
  lines.push('');
  lines.push('4. NO MAKEUP HALLUCINATION: Do NOT add any makeup not present in the reference face image. Keep the face raw and natural if the reference is natural.');
  lines.push('');

  // Body context
  lines.push('=== BODY CONTEXT ===');
  lines.push(`Body orientation: ${bodyContext.bodyOrientation || 'frontal'}`);
  lines.push(`Head should be positioned: ${bodyContext.headArea || 'top-center'}`);
  lines.push(`Neck position in frame: ${bodyContext.neckPosition || 'top-of-frame'}`);
  lines.push('');

  // Skin matching
  lines.push('=== SKIN COLOR MATCHING (CRITICAL) ===');
  if (bodyContext.skinHexVisible && sourceAnalysis?.skin_hex) {
    lines.push(`5. Visible body skin color: ${bodyContext.skinHexVisible} (${bodyContext.skinToneVisible || 'unknown'} tone)`);
    lines.push(`   Reference face skin color: ${sourceAnalysis.skin_hex} (${sourceAnalysis.skin_tone} tone, ${sourceAnalysis.undertone} undertone)`);
    lines.push(`   The added face skin MUST match the body skin color (${bodyContext.skinHexVisible}). Adapt the reference face tone to blend seamlessly with the neck, chest, and shoulders. ZERO color boundary.`);
  } else {
    lines.push('5. Match the added face skin color exactly to the visible body skin. No color difference at neck/jawline.');
  }
  lines.push('');

  // Lighting matching
  lines.push('=== LIGHTING MATCHING ===');
  lines.push(`6. Target scene lighting: Direction="${bodyContext.lightingDirection || 'natural'}", Temperature="${bodyContext.lightingTemp || 'neutral'}".`);
  lines.push('   The added face MUST have identical lighting — same shadow direction, same warmth/coolness, same intensity. Do NOT bring reference photo lighting.');
  lines.push('');

  // Head angle matching
  lines.push('=== HEAD POSE MATCHING ===');
  const orientation = bodyContext.bodyOrientation || 'frontal';
  if (orientation.includes('left') || orientation.includes('right')) {
    lines.push(`7. The body is oriented "${orientation}". The head must face the SAME direction as the body naturally. Match the body\'s rotation angle.`);
  } else if (orientation === 'frontal') {
    lines.push('7. The body faces front. The head should face forward or very slightly turned — natural and relaxed pose.');
  } else if (orientation === 'back') {
    lines.push('7. The body faces away. Show the BACK of the head with the reference person\'s hair color and style. Only show the ear/jawline if the body is slightly turned.');
  }
  lines.push('');

  // Hair
  lines.push('=== HAIR ===');
  if (settings.preserveHair) {
    lines.push('8. Generate the reference person\'s natural hair (from the reference image) styled appropriately for the scene. The hair should look natural, with correct volume and flow matching the scene\'s wind/environment.');
  } else {
    lines.push('8. Generate natural, appropriate hair for the person and scene.');
  }
  lines.push('');

  // Background extension
  lines.push('=== BACKGROUND CONTINUITY ===');
  lines.push('9. If the image needs to be extended upward to fit the head, continue the background SEAMLESSLY. Match colors, patterns, bokeh, and depth of field exactly. The extended area must be indistinguishable from the original.');
  lines.push('');

  // Scene preservation
  lines.push('=== PRESERVE EVERYTHING ELSE ===');
  lines.push('10. PRESERVE CLOTHING & FRAMING: The top, dress, body, and all clothing MUST remain exactly the same. DO NOT modify the outfit. DO NOT crop the image. Only add new pixels above/around the neck area for the head.');
  lines.push('');

  // Identity context
  if (sourceAnalysis) {
    lines.push('=== REFERENCE IDENTITY ===');
    lines.push(`Person: ${sourceAnalysis.gender_presentation || 'Person'}, approx age ${sourceAnalysis.approximate_age || 'unknown'}.`);
    lines.push(`Face shape: ${sourceAnalysis.facial_metrics?.face_shape || 'unknown'}.`);
    lines.push(`Facial hair: ${sourceAnalysis.facial_hair || 'none'}. Glasses: ${sourceAnalysis.glasses || 'none'}.`);
    lines.push('Transfer the complete facial identity — bone structure, eyes, nose, lips, jawline, and unique features.');
  }

  // Smoothness
  if (settings.skinSmoothness > 0) {
    const level = settings.skinSmoothness <= 3 ? 'minimal (keep all texture)' : settings.skinSmoothness <= 6 ? 'subtle (natural softening)' : 'moderate (soften but keep photorealistic)';
    lines.push('');
    lines.push(`=== SKIN SMOOTHNESS: ${level} (${settings.skinSmoothness}/10) ===`);
  }

  return lines.join('\n').trim();
};

// ─────────────────────────────────────────────
// CONTEXT-AWARE PROMPT BUILDER (FIXED VERSION)
// ─────────────────────────────────────────────

const buildSwapPrompt = (
  sourceFaceCount: number,
  settings: SwapSettings,
  sourceAnalysis: FaceAnalysisResult | null,
  targetAnalysis: FaceAnalysisResult | null,
  batchIndex?: number,
  batchTotal?: number
): string => {
  const lines: string[] = [];

  lines.push('Seamlessly edit the TARGET image to replace the person\'s face with the facial identity from the REFERENCE image(s).');
  lines.push('The final image MUST be an undetectable, high-end photorealistic photograph.');
  lines.push('');

  lines.push('=== CRITICAL EDITING CONSTRAINTS (ALL MANDATORY) ===');
  lines.push('1. STRICT PHOTOREALISM: Raw natural photograph look. NO plastic/painted/airbrushed/glossy/3D render. Keep skin pores, fine lines, moles, micro-textures, and imperfections.');
  lines.push('2. NO MAKEUP HALLUCINATION: Do NOT add ANY makeup not clearly present in the reference image. Preserve the exact facial aesthetic of the reference.');
  lines.push('3. PERFECT SKIN BLENDING: Swapped face skin must PERFECTLY blend with neck, chest, ears, arms in TARGET. Zero seams, halos, or color shifts at the jawline and hairline. The transition must be invisible.');
  lines.push('4. MATCH TARGET ENVIRONMENT: Inherit exact lighting, shadows, color temperature, film grain, and depth of field from TARGET. Do NOT bring reference lighting.');
  lines.push('5. PRESERVE CLOTHING & SCENE: The top, dress, clothing, accessories, background, and body MUST remain 100% pixel-perfect unchanged. DO NOT alter the outfit or crop the image in any way. Only the facial features should change.');
  lines.push('');

  // Face geometry
  if (sourceAnalysis && targetAnalysis) {
    lines.push('=== FACE GEOMETRY MATCHING ===');
    if (settings.faceScaleLock === 'fixed') {
      lines.push(`6. FACE SCALE: Target face scale ratio: ${targetAnalysis.face_scale_ratio?.toFixed(3)}. Swapped face MUST match this exact size. Not bigger, not smaller.`);
    } else {
      lines.push(`6. FACE SCALE: Target face scale ratio: ${targetAnalysis.face_scale_ratio?.toFixed(3)}. Adapt swapped face to fit naturally, but keep close to this size.`);
    }
    lines.push(`7. FACE BOX: Target face at [${targetAnalysis.face_box?.map(v => v.toFixed(3)).join(', ')}]. Place swapped face precisely here.`);
    lines.push(`8. POSE: Target yaw=${targetAnalysis.face_angle_yaw?.toFixed(1)}° pitch=${targetAnalysis.face_angle_pitch?.toFixed(1)}°. Adapt reference face to this angle.`);
    lines.push('');
  }

  // Skin color
  if (settings.matchSkinTone && sourceAnalysis && targetAnalysis) {
    lines.push('=== SKIN COLOR ===');
    lines.push(`9. Target body skin: ${targetAnalysis.skin_hex} (${targetAnalysis.skin_tone}). Reference face: ${sourceAnalysis.skin_hex} (${sourceAnalysis.skin_tone}).`);
    lines.push(`   Adapt face to match body color ${targetAnalysis.skin_hex}. Seamless face-neck-body transition.`);
    lines.push('');
  }

  // Lighting
  if (settings.matchLighting && targetAnalysis?.lighting) {
    lines.push('=== LIGHTING ===');
    lines.push(`10. Target: direction="${targetAnalysis.lighting.direction}", intensity=${targetAnalysis.lighting.intensity?.toFixed(2)}, temp="${targetAnalysis.lighting.color_temperature}", shadows=${targetAnalysis.lighting.shadow_depth?.toFixed(2)}.`);
    lines.push('    Relight the face to match these conditions exactly.');
    lines.push('');
  }

  // Hair
  if (settings.preserveHair) {
    lines.push('=== HAIR BLENDING ===');
    lines.push('11. Keep target hair exactly. Seamless forehead-to-hairline transition. Natural temple/sideburn blending. No gaps or lines.');
    lines.push('');
  }

  // Smoothness
  if (settings.skinSmoothness > 0) {
    const level = settings.skinSmoothness <= 3 ? 'minimal (keep all micro-textures)' : settings.skinSmoothness <= 6 ? 'moderate (soften but keep photorealistic)' : 'significant (smooth skin, but maintain realism)';
    lines.push(`=== SKIN SMOOTHNESS: ${level} (${settings.skinSmoothness}/10) ===`);
    lines.push('');
  }

  // Batch consistency
  if (batchIndex !== undefined && batchTotal !== undefined && batchTotal > 1) {
    lines.push('=== BATCH CONSISTENCY ===');
    lines.push(`Image ${batchIndex + 1}/${batchTotal}. Same person in ALL outputs. Identical skin rendering, features, sharpness. Only lighting/pose changes per target.`);
    lines.push('');
  }

  // Identity
  if (sourceAnalysis) {
    lines.push('=== REFERENCE IDENTITY ===');
    lines.push(`${sourceAnalysis.gender_presentation || 'Person'}, age ~${sourceAnalysis.approximate_age || '?'}. Hair: ${sourceAnalysis.facial_hair || 'none'}. Shape: ${sourceAnalysis.facial_metrics?.face_shape || '?'}.`);
  }

  return lines.join('\n').trim();
};

// ─────────────────────────────────────────────
// MAIN FACE SWAP / FACE ADDITION (AUTO-DETECT)
// ─────────────────────────────────────────────

export const performFaceSwap = async (
  sourceFacesBase64: string[],
  targetImageBase64: string,
  settings: SwapSettings,
  sourceAnalysis?: FaceAnalysisResult | null,
  onProgress?: (stage: string) => void,
  batchIndex?: number,
  batchTotal?: number
): Promise<string> => {
  const client = getClient();

  // Step 1: Detect if target has a face
  onProgress?.('Detecting face in target image...');
  let targetHasFace = true;
  let bodyContext: any = {};
  
  try {
    const detection = await detectFacePresence(targetImageBase64);
    targetHasFace = detection.hasFace;
    bodyContext = detection;
    onProgress?.(targetHasFace ? 'Face detected → Swap mode' : 'No face detected → Generation mode');
  } catch {
    console.warn('Face detection failed — defaulting to swap mode');
  }

  let targetAnalysis: FaceAnalysisResult | null = null;
  let finalPrompt: string;

  if (targetHasFace) {
    // ── SWAP MODE: Face exists, replace it ──
    onProgress?.('Analyzing target face geometry & lighting...');
    try {
      targetAnalysis = await analyzeFace(targetImageBase64);
    } catch {
      console.warn('Target analysis failed — proceeding without context');
    }

    onProgress?.('Building swap prompt...');
    finalPrompt = buildSwapPrompt(
      sourceFacesBase64.length,
      settings,
      sourceAnalysis ?? null,
      targetAnalysis,
      batchIndex,
      batchTotal
    );
  } else {
    // ── GENERATION MODE: No face, add one ──
    onProgress?.('Building face addition prompt...');
    finalPrompt = buildFaceAdditionPrompt(
      settings,
      sourceAnalysis ?? null,
      bodyContext
    );
  }

  // Build multimodal content
  const contentParts: any[] = [];

  // Optimize source images
  onProgress?.('Preparing reference images...');
  const optimizedSources = await Promise.all(
    sourceFacesBase64.map(face => resizeImage(face, 1024, 0.95))
  );

  optimizedSources.forEach((face, index) => {
    contentParts.push({ inlineData: { mimeType: 'image/jpeg', data: stripBase64(face) } });
    contentParts.push({
      text: index === 0
        ? 'REFERENCE FACE — PRIMARY IDENTITY (highest priority). This is the face to use. Preserve exact bone structure, eye shape, nose shape, lip shape, and all unique features.'
        : `REFERENCE FACE ${index + 1} — SUPPLEMENTAL ANGLE for 3D structure understanding.`
    });
  });

  // Optimize target
  const targetDims = await getImageDimensions(targetImageBase64);
  const targetAspectRatio = getClosestAspectRatio(targetDims.width, targetDims.height);
  const optimizedTarget = await resizeImage(targetImageBase64, 2048, (settings.outputQuality || 90) / 100);
  
  contentParts.push({ inlineData: { mimeType: getMimeType(optimizedTarget), data: stripBase64(optimizedTarget) } });
  
  if (targetHasFace) {
    contentParts.push({ text: 'TARGET IMAGE — Replace ONLY the face. DO NOT CROP. Keep exact framing, hair, top, dress, clothing, background, and body pose unchanged.' });
  } else {
    contentParts.push({ text: 'TARGET BODY IMAGE — This image has NO visible face. Add the reference person\'s face/head naturally onto this body. DO NOT CROP. Keep the top, dress, and clothing exactly the same.' });
  }
  
  contentParts.push({ text: finalPrompt });

  // Add the AI STUDIO MASTER PROMPT as system instruction
  const systemInstruction = `You are a professional-grade, high-end photorealistic face engine with TWO modes:

MODE 1 — FACE SWAP (when target image HAS a visible face):
Replace the face in the target with the reference identity.

MODE 2 — FACE GENERATION (when target image has NO face, only body):
Add/generate the reference person's face onto the headless body, extending the image naturally.

AUTO-DETECT which mode to use based on whether the target has a visible face.

=== ABSOLUTE RULES FOR BOTH MODES ===

1. PHOTOREALISM: Output must be indistinguishable from a real, unedited, high-resolution photograph. Natural skin pores, fine lines, moles, micro-textures, and photographic imperfections MUST be present. NO plastic, NO airbrushed, NO painted, NO glossy, NO 3D render look.

2. ZERO MAKEUP HALLUCINATION: Do NOT add ANY makeup (eyeliner, eyeshadow, lipstick, blush, foundation) unless it is clearly visible in the reference face image. This is the most common error — avoid it completely.

3. FACE SIZE & ALIGNMENT: In swap mode, the new face must be the EXACT same size and alignment as the original target face. In generation mode, the head must be anatomically proportional to the visible body/neck.

4. SKIN COLOR CONTINUITY: The face skin MUST seamlessly match the visible body skin (neck, chest, arms, ears). If there's a color difference between reference and target body, adjust the FACE to match the BODY — never the other way. Zero visible color boundary anywhere. The blend must be flawless.

5. LIGHTING MATCH: The face must have identical lighting to the target image — same direction, shadows, color temperature, intensity, ambient cast. Do NOT carry reference photo lighting into the target.

6. HAIR HANDLING:
   - SWAP mode: Preserve target hair exactly. Seamless forehead-to-hairline blend. No gaps at temples or sideburns.
   - GENERATION mode: Generate the reference person's hair naturally, matching the scene style and environment.

7. STRICT SCENE & CLOTHING PRESERVATION: The target image MUST NOT BE CROPPED. The aspect ratio and framing must remain identical. The person's top, dress, clothing, body, and background MUST remain 100% pixel-perfect unchanged. ONLY the face/head should be modified.

8. IDENTITY TRANSFER: Preserve the reference person's exact bone structure, eye shape/color, nose, lips, jawline, and unique identifying features. Adapt expression and pose to match the target naturally.

=== MODE 2 SPECIFIC: FACE GENERATION ON HEADLESS BODIES ===

When the target shows only a body with no visible face:

A. ANATOMICAL ACCURACY: The head must sit naturally on the neck. Correct proportions for the body size. Not floating, not sunk into shoulders. The jawline must connect to the neck flawlessly.

B. HEAD ANGLE: Match the body orientation. If body faces slightly left, head faces slightly left. Natural relaxed pose.

C. BACKGROUND EXTENSION: If the image needs to be extended upward, continue the background SEAMLESSLY — match colors, bokeh, depth of field, patterns exactly.

D. NECK BLEND: The face-to-neck transition must be invisible. Match skin tone, lighting, and texture perfectly at the junction.

E. PRESERVE ORIGINAL PIXELS: The original image area must remain completely unchanged. Only add new content where the head should be.

=== BATCH CONSISTENCY ===

When processing multiple targets with the same reference:
- The swapped/generated face must be the EXACT same person in every output
- Same skin texture, same feature rendering, same sharpness
- Only lighting and pose change to match each target

=== MULTIPLE REFERENCE IMAGES ===
- Image 1 = PRIMARY (highest priority for identity)
- Image 2+ = Supplemental angles for 3D understanding
- Always prioritize primary image features

=== OUTPUT ===
- Single photorealistic image, same aspect ratio as target (or extended if generating head)
- Must pass as genuine unedited photograph
- No watermarks, borders, or text`;

  onProgress?.(targetHasFace ? 'Generating face swap...' : 'Generating face onto body...');
  const response = await withRetry(() =>
    client.models.generateContent({
      model: ModelType.GEMINI_3_PRO_IMAGE,
      contents: { parts: contentParts },
      config: { 
        imageConfig: { 
          imageSize: '2K',
          aspectRatio: targetAspectRatio
        },
        temperature: 0.2,
        systemInstruction: systemInstruction,
      }
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
