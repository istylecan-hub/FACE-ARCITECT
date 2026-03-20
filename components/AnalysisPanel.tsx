import React from 'react';
import { FaceAnalysisResult } from '../types';

interface AnalysisPanelProps {
  analysis: FaceAnalysisResult | null;
  isLoading: boolean;
}

const Meter = ({ value, max = 1, color = '#3b82f6' }: { value: number; max?: number; color?: string }) => (
  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
    <div
      className="h-full rounded-full transition-all duration-500"
      style={{ width: `${Math.min((value / max) * 100, 100)}%`, background: color }}
    />
  </div>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center py-1 border-b border-gray-800/60 last:border-0">
    <span className="text-gray-500 text-[11px] uppercase tracking-wider">{label}</span>
    <span className="text-gray-200 text-xs font-medium text-right ml-2">{value}</span>
  </div>
);

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ analysis, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6 bg-gray-900/50 rounded-xl border border-gray-800">
        <div className="text-center">
          <svg className="animate-spin h-7 w-7 text-blue-500 mx-auto mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-400 text-xs animate-pulse">Deep facial analysis...</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center p-5 bg-gray-900/30 rounded-xl border border-dashed border-gray-800 text-gray-600 text-xs text-center">
        Face Intelligence panel — Upload a source face to populate.
      </div>
    );
  }

  const conf = analysis.confidence ?? 0.85;
  const yaw = analysis.face_angle_yaw ?? 0;
  const pitch = analysis.face_angle_pitch ?? 0;

  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800 overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60 border-b border-gray-700">
        <span className="text-blue-400 font-bold tracking-widest text-[10px] uppercase">Face Intelligence</span>
        <span className="text-[10px] bg-blue-950 text-blue-300 px-2 py-0.5 rounded-full border border-blue-900">
          {(conf * 100).toFixed(0)}% conf
        </span>
      </div>

      <div className="p-3 space-y-3">

        {/* Skin */}
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Skin</p>
          <div className="flex items-center gap-2 mb-1">
            {analysis.skin_hex && (
              <div
                className="w-5 h-5 rounded-full border border-gray-700 flex-shrink-0 shadow-inner"
                style={{ background: analysis.skin_hex }}
                title={analysis.skin_hex}
              />
            )}
            <span className="text-gray-300 text-[11px] leading-tight">{analysis.skin_tone || 'Unknown'}</span>
          </div>
          <div className="space-y-0">
            <Row label="Undertone" value={<span className="capitalize">{analysis.undertone || 'N/A'}</span>} />
            {analysis.skin_hex && <Row label="Hex" value={<code className="text-green-400">{analysis.skin_hex}</code>} />}
          </div>
        </div>

        {/* Geometry */}
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Head Geometry</p>
          <div className="grid grid-cols-2 gap-2 mb-1">
            <div className="bg-gray-800/50 rounded-lg p-2 text-center">
              <div className="text-blue-400 font-mono font-bold">{yaw > 0 ? '+' : ''}{yaw?.toFixed(1) ?? '0'}°</div>
              <div className="text-gray-600 text-[9px] mt-0.5">Yaw {yaw < -5 ? '← Left' : yaw > 5 ? 'Right →' : 'Frontal'}</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2 text-center">
              <div className="text-indigo-400 font-mono font-bold">{pitch > 0 ? '+' : ''}{pitch?.toFixed(1) ?? '0'}°</div>
              <div className="text-gray-600 text-[9px] mt-0.5">Pitch {pitch < -5 ? '↓ Down' : pitch > 5 ? '↑ Up' : 'Level'}</div>
            </div>
          </div>
          {analysis.approximate_age && <Row label="Age Est." value={analysis.approximate_age.toString()} />}
          {analysis.gender_presentation && <Row label="Gender" value={<span className="capitalize">{analysis.gender_presentation}</span>} />}
        </div>

        {/* Biometrics */}
        {analysis.facial_metrics && (
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Biometrics</p>
            <Row label="Face Shape" value={<span className="capitalize">{analysis.facial_metrics.face_shape}</span>} />
            <div className="mt-1.5">
              <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                <span>Golden Ratio</span>
                <span>{(analysis.facial_metrics.golden_ratio_score * 100).toFixed(1)}%</span>
              </div>
              <Meter value={analysis.facial_metrics.golden_ratio_score} color="#f59e0b" />
            </div>
            <div className="mt-1.5">
              <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                <span>Symmetry</span>
                <span>{(analysis.facial_metrics.symmetry_score * 100).toFixed(1)}%</span>
              </div>
              <Meter value={analysis.facial_metrics.symmetry_score} color="#8b5cf6" />
            </div>
          </div>
        )}

        {/* Emotions */}
        {analysis.emotions && (
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Emotions</p>
            <Row label="Primary" value={<span className="capitalize">{analysis.emotions.primary}</span>} />
            {analysis.emotions.secondary && <Row label="Secondary" value={<span className="capitalize">{analysis.emotions.secondary}</span>} />}
            <div className="mt-1.5">
              <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                <span>Valence</span>
                <span>{analysis.emotions.valence > 0 ? '+' : ''}{analysis.emotions.valence.toFixed(2)}</span>
              </div>
              <Meter value={(analysis.emotions.valence + 1) / 2} color={analysis.emotions.valence > 0 ? "#22c55e" : "#ef4444"} />
            </div>
          </div>
        )}

        {/* Lighting */}
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Scene Lighting</p>
          <Row label="Direction" value={analysis.lighting?.direction || 'N/A'} />
          <Row label="Temperature" value={
            <span className={
              analysis.lighting?.color_temperature === 'warm' ? 'text-amber-400' :
              analysis.lighting?.color_temperature === 'cool' ? 'text-blue-400' : 'text-gray-300'
            }>{analysis.lighting?.color_temperature || 'N/A'}</span>
          } />
          {analysis.lighting?.has_rim_light && (
            <Row label="Rim Light" value={
              <span className={analysis.lighting.has_rim_light === 'yes' ? 'text-yellow-400' : 'text-gray-500'}>
                {analysis.lighting.has_rim_light}
              </span>
            } />
          )}
          <div className="mt-1.5">
            <div className="flex justify-between text-[10px] text-gray-600 mb-1">
              <span>Intensity</span>
              <span>{((analysis.lighting?.intensity ?? 0.5) * 100).toFixed(0)}%</span>
            </div>
            <Meter value={analysis.lighting?.intensity ?? 0.5} color="#eab308" />
          </div>
          {analysis.lighting?.shadow_depth !== undefined && (
            <div className="mt-1.5">
              <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                <span>Shadow Depth</span>
                <span>{((analysis.lighting.shadow_depth) * 100).toFixed(0)}%</span>
              </div>
              <Meter value={analysis.lighting.shadow_depth} color="#6366f1" />
            </div>
          )}
        </div>

        {/* Context */}
        {(analysis.facial_hair || analysis.glasses) && (
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Features</p>
            {analysis.facial_hair && <Row label="Facial Hair" value={<span className="capitalize">{analysis.facial_hair}</span>} />}
            {analysis.glasses && <Row label="Glasses" value={<span className="capitalize">{analysis.glasses}</span>} />}
          </div>
        )}

      </div>
    </div>
  );
};
