import React from 'react';
import { FaceAnalysisResult } from '../types';

interface AnalysisPanelProps {
  analysis: FaceAnalysisResult | null;
  isLoading: boolean;
}

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ analysis, isLoading }) => {
  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-8 bg-gray-850 rounded-xl border border-gray-700">
        <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-400 text-sm animate-pulse">Gemini 3 Pro Analyzing...</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="h-full w-full flex items-center justify-center p-8 bg-gray-900/50 rounded-xl border border-dashed border-gray-800 text-gray-500 text-sm">
        No analysis data available. Upload a source face to begin.
      </div>
    );
  }

  // Safely handle potentially missing numeric values with defaults
  const confidence = analysis.confidence ?? 0.85; // Default to decent confidence if missing
  const faceScale = analysis.face_scale_ratio ?? 0;
  const lightingIntensity = analysis.lighting?.intensity ?? 0.5;

  return (
    <div className="bg-gray-850 rounded-xl border border-gray-700 p-4 space-y-4 font-mono text-sm overflow-y-auto max-h-96">
      <div className="flex items-center justify-between border-b border-gray-700 pb-2">
        <h3 className="text-blue-400 font-bold uppercase tracking-wider">Face Intelligence</h3>
        <span className="text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded">Confidence: {(confidence * 100).toFixed(0)}%</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Skin Tone</label>
          <div className="text-gray-200 bg-gray-800 px-2 py-1 rounded">{analysis.skin_tone || 'Unknown'}</div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Undertone</label>
          <div className="text-gray-200 bg-gray-800 px-2 py-1 rounded">{analysis.undertone || 'Unknown'}</div>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Lighting</label>
        <div className="bg-gray-800 p-2 rounded space-y-1">
            <div className="flex justify-between">
                <span className="text-gray-400">Direction</span>
                <span className="text-gray-200">{analysis.lighting?.direction || 'Unknown'}</span>
            </div>
             <div className="flex justify-between">
                <span className="text-gray-400">Temp</span>
                <span className="text-gray-200">{analysis.lighting?.color_temperature || 'Unknown'}</span>
            </div>
             <div className="flex justify-between items-center">
                <span className="text-gray-400">Intensity</span>
                <div className="w-20 bg-gray-700 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-yellow-500 h-full" style={{ width: `${Math.min(lightingIntensity * 100, 100)}%` }}></div>
                </div>
            </div>
        </div>
      </div>
      
       <div>
          <label className="text-xs text-gray-500 block mb-1">Scale Ratio</label>
          <div className="text-gray-200">{faceScale.toFixed(3)} (Face/Img)</div>
        </div>
    </div>
  );
};