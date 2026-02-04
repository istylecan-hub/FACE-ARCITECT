export enum ModelType {
  GEMINI_3_PRO = 'gemini-3-pro-preview',
  GEMINI_3_PRO_IMAGE = 'gemini-3-pro-image-preview', // Nano Banana Pro
  GEMINI_2_5_FLASH_IMAGE = 'gemini-2.5-flash-image', // Nano Banana
}

export interface FaceAnalysisResult {
  face_box: number[];
  landmarks: Record<string, any>;
  skin_tone: string;
  undertone: string;
  lighting: {
    direction: string;
    intensity: number;
    color_temperature: string;
  };
  face_scale_ratio: number;
  confidence: number;
}

export interface SwapSettings {
  preserveHair: boolean;
  matchSkinTone: boolean;
  matchLighting: boolean;
  faceScaleLock: 'auto' | 'fixed';
  skinSmoothness: number; // 0-10
  outputQuality: number; // 0-100
}

export interface ProcessedImage {
  id: string;
  originalUrl: string;
  processedUrl?: string;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  error?: string;
  analysis?: FaceAnalysisResult;
}

export interface AppSessionState {
  targets: ProcessedImage[];
  sourceFace?: string;
  analysis?: FaceAnalysisResult;
}

export interface UserPreferences {
  last_used_source?: {
    image: string; // base64
    analysis: FaceAnalysisResult;
    timestamp: number;
  };
  session_state?: AppSessionState;
}