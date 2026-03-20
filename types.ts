export enum ModelType {
  GEMINI_3_PRO           = 'gemini-3-pro-preview',
  GEMINI_3_PRO_IMAGE     = 'gemini-3-pro-image-preview',
  GEMINI_FLASH_ANALYSIS  = 'gemini-3-flash-preview',
  GEMINI_2_5_FLASH_IMAGE = 'gemini-2.5-flash-image',
  GEMINI_3_1_PRO         = 'gemini-3.1-pro-preview',
  GEMINI_3_1_FLASH_IMAGE = 'gemini-3.1-flash-image-preview',
  GEMINI_3_1_FLASH_LITE  = 'gemini-3.1-flash-lite-preview',
}

export interface FaceAnalysisResult {
  face_box: number[];
  landmarks: {
    left_eye?:      number[];
    right_eye?:     number[];
    left_eyebrow?:  number[];
    right_eyebrow?: number[];
    nose_bridge?:   number[];
    nose_tip?:      number[];
    mouth_left?:    number[];
    mouth_right?:   number[];
    mouth_center?:  number[];
    chin_center?:   number[];
    jawline?:       number[][];
    [key: string]:  any;
  };
  // Skin
  skin_tone:           string;
  skin_hex:            string;   // NEW: #RRGGBB dominant skin color
  undertone:           string;
  // Lighting
  lighting: {
    direction:         string;
    intensity:         number;
    color_temperature: string;
    has_rim_light?:    string;   // NEW: "yes" | "no"
    shadow_depth?:     number;   // NEW: 0.0–1.0
  };
  // Geometry
  face_scale_ratio:    number;
  face_angle_yaw:      number;   // NEW: degrees -45 to +45
  face_angle_pitch:    number;   // NEW: degrees -30 to +30
  eye_distance_ratio?: number;   // NEW
  // Context
  facial_hair?:        string;
  glasses?:            string;
  expression?:         string;
  approximate_age?:    number;
  gender_presentation?:string;
  emotions?: {
    primary: string;
    secondary?: string;
    valence: number;
    arousal: number;
  };
  facial_metrics?: {
    golden_ratio_score: number;
    face_shape: string;
    symmetry_score: number;
  };
  confidence:          number;
}

export interface SwapSettings {
  preserveHair:    boolean;
  matchSkinTone:   boolean;
  matchLighting:   boolean;
  faceScaleLock:   'auto' | 'fixed';
  skinSmoothness:  number; // 0–10
  outputQuality:   number; // 0–100
}

export interface ProcessedImage {
  id:            string;
  originalUrl:   string;
  processedUrl?: string;
  status:        'idle' | 'processing' | 'completed' | 'failed';
  error?:        string;
  analysis?:     FaceAnalysisResult;
  progressMsg?:  string; // NEW: for showing stage labels during processing
}

export interface AppSessionState {
  targets:      ProcessedImage[];
  sourceFaces:  string[];
  analysis?:    FaceAnalysisResult;
}

export interface UserPreferences {
  last_used_source?: {
    images:    string[];
    analysis:  FaceAnalysisResult;
    timestamp: number;
  };
  session_state?: AppSessionState;
}
