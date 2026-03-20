import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { Button } from './components/Button';
import { Toggle } from './components/Toggle';
import { AnalysisPanel } from './components/AnalysisPanel';
import { analyzeFace, performFaceSwap } from './services/geminiService';
import { loadPreferences, updatePreferences } from './services/storageService';
import { DEFAULT_SWAP_SETTINGS } from './constants';
import { FaceAnalysisResult, ProcessedImage, SwapSettings } from './types';
import JSZip from 'jszip';
import saveAs from 'file-saver';

// Declare global window interface for AI Studio
declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// Simple in-memory cache to prevent re-analyzing the same file
const analysisCache = new Map<string, FaceAnalysisResult>();

// Helper to hash file for cache key
const generateFileHash = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
};

function App() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  
  // CHANGED: Store multiple source faces
  const [sourceFaces, setSourceFaces] = useState<string[]>([]); 
  
  const [targets, setTargets] = useState<ProcessedImage[]>([]);
  const [analysis, setAnalysis] = useState<FaceAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [settings, setSettings] = useState<SwapSettings>(DEFAULT_SWAP_SETTINGS);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [autoRestoreMsg, setAutoRestoreMsg] = useState<string | null>(null);

  // Check for API Key
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        // Fallback for dev environments without the wrapper
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      // Assume success after dialog closes (race condition mitigation)
      setHasApiKey(true);
    }
  };

  // Load Preferences
  useEffect(() => {
    const init = async () => {
      try {
        const prefs = await loadPreferences();
        if (prefs) {
          if (prefs.session_state) {
             const s = prefs.session_state;
             setTargets(s.targets || []);
             setSourceFaces(s.sourceFaces || []); // Load Array
             setAnalysis(s.analysis || null);
             if (s.sourceFaces && s.sourceFaces.length > 0) setAutoRestoreMsg("✓ Session Restored");
          } else if (prefs.last_used_source) {
             // Fallback to legacy or new format
             // Type assertion to handle potential legacy string vs new array structure safely
             const lastSource = prefs.last_used_source as any;
             
             if (lastSource.images && Array.isArray(lastSource.images)) {
                 setSourceFaces(lastSource.images);
             } else if (lastSource.image && typeof lastSource.image === 'string') {
                 setSourceFaces([lastSource.image]);
             }
             
             setAnalysis(prefs.last_used_source.analysis); 
             setAutoRestoreMsg("✓ Face Restored");
          }
        }
      } catch (e) {
        console.warn("Failed to load user preferences", e);
      } finally {
        setIsStorageLoaded(true);
        setTimeout(() => setAutoRestoreMsg(null), 3000);
      }
    };
    init();
  }, []);

  // Auto-save
  useEffect(() => {
    if (!isStorageLoaded) return;
    const timer = setTimeout(() => {
      updatePreferences({ 
        session_state: { targets, sourceFaces: sourceFaces, analysis: analysis || undefined } 
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [isStorageLoaded, targets, sourceFaces, analysis]);

  const handleSourceSelect = async (file: File) => {
    const hash = await generateFileHash(file);
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      
      // Add to array instead of replacing
      setSourceFaces(prev => {
        // Prevent duplicates
        if (prev.includes(base64)) return prev;
        // Limit to 3 images
        if (prev.length >= 3) return prev;
        return [...prev, base64];
      });

      // Only analyze if it's the first image (Primary)
      if (sourceFaces.length === 0) {
        setAnalysis(null);
        setAutoRestoreMsg(null); 
        
        if (analysisCache.has(hash)) {
          setAnalysis(analysisCache.get(hash)!);
          return;
        }

        setIsAnalyzing(true);
        try {
          const result = await analyzeFace(base64);
          analysisCache.set(hash, result);
          setAnalysis(result);
        } catch (err) {
          console.error("Analysis failed", err);
        } finally {
          setIsAnalyzing(false);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const removeSourceImage = (index: number) => {
      setSourceFaces(prev => {
          const newFaces = [...prev];
          newFaces.splice(index, 1);
          return newFaces;
      });
      if (index === 0) setAnalysis(null); // Clear analysis if primary removed
  };

  const handleTargetSelect = (file: File) => {
     const reader = new FileReader();
    reader.onload = (e) => {
      setTargets(prev => [...prev, {
        id: Date.now().toString() + Math.random().toString(),
        originalUrl: e.target?.result as string,
        status: 'idle'
      }]);
    };
    reader.readAsDataURL(file);
  };

  const runBatchProcessor = async () => {
    if (sourceFaces.length === 0) return;
    setIsProcessingBatch(true);

    // Snapshot idle targets ONCE to avoid stale closure reads
    const idleTargets = targets.filter(t => t.status === 'idle');

    for (const target of idleTargets) {
      setTargets(prev => prev.map(t => t.id === target.id
        ? { ...t, status: 'processing', progressMsg: 'Starting...' } : t));
      try {
        const swappedImage = await performFaceSwap(
          sourceFaces,
          target.originalUrl,
          settings,
          analysis,           // pass source face analysis for context injection
          (stage: string) => {  // per-card progress label
            setTargets(prev => prev.map(t => t.id === target.id
              ? { ...t, progressMsg: stage } : t));
          }
        );
        setTargets(prev => prev.map(t => t.id === target.id
          ? { ...t, status: 'completed', processedUrl: swappedImage, progressMsg: undefined } : t));
      } catch (error) {
        // If permission denied, reset key state to prompt again
        if (error instanceof Error && (error.message.includes('403') || error.message.includes('PERMISSION_DENIED'))) {
             setHasApiKey(false);
        }
        setTargets(prev => prev.map(t => t.id === target.id
          ? { ...t, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error', progressMsg: undefined } : t));
      }
      await new Promise(r => setTimeout(r, 300));
    }
    setIsProcessingBatch(false);
  };

  const downloadAll = async () => {
    const completed = targets.filter(t => t.status === 'completed' && t.processedUrl);
    if (completed.length === 0) return;

    setIsZipping(true);
    const zip = new JSZip();
    const folder = zip.folder("swapped_faces");

    completed.forEach((target, index) => {
      if (target.processedUrl) {
        const base64Data = target.processedUrl.split(',')[1];
        folder?.file(`swap_${index + 1}.png`, base64Data, { base64: true });
      }
    });

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "gemini_architect_batch.zip");
    setIsZipping(false);
  };

  if (!hasApiKey) {
    return (
      <div className="flex h-screen w-full bg-gray-950 items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">API Key Required</h2>
          <p className="text-gray-400 mb-8 leading-relaxed">
            Gemini Architect uses the <strong>Gemini 3.1 Flash Image</strong> model, which requires a paid API key from a Google Cloud project.
          </p>
          <Button onClick={handleSelectKey} className="w-full py-4 text-lg">
            Select API Key
          </Button>
          <p className="mt-6 text-xs text-gray-600">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">
              Learn more about billing
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-gray-950 text-gray-100 overflow-hidden">
      {/* SIDEBAR */}
      <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900 z-10 shadow-2xl">
        <div className="p-4 border-b border-gray-800">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">Gemini Architect</h1>
            <p className="text-xs text-gray-500 mt-1">Engine: Gemini 3.1 Pro + 3.1 Flash Image</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Source Identity</h3>
            <FileUploader 
              label="Upload Source" 
              onFileSelect={handleSourceSelect} 
              currentImages={sourceFaces} 
              statusMessage={autoRestoreMsg}
              onClear={() => { setSourceFaces([]); setAnalysis(null); }}
              onRemoveSingle={removeSourceImage}
              compact
            />
          </div>

          <div>
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Controls</h3>
              <div className="space-y-0 divide-y divide-gray-800">
                <Toggle label="Preserve Hair" checked={settings.preserveHair} onChange={v => setSettings(s => ({...s, preserveHair: v}))} />
                <Toggle label="Match Skin Tone" checked={settings.matchSkinTone} onChange={v => setSettings(s => ({...s, matchSkinTone: v}))} />
                <Toggle label="Match Lighting" checked={settings.matchLighting} onChange={v => setSettings(s => ({...s, matchLighting: v}))} />
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs mb-1 text-gray-400">
                    <span>Skin Smoothness ({settings.skinSmoothness})</span>
                </div>
                <input 
                    type="range" min="0" max="10" step="1" 
                    value={settings.skinSmoothness} 
                    onChange={(e) => setSettings(s => ({...s, skinSmoothness: parseInt(e.target.value)}))}
                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs mb-1 text-gray-400">
                    <span>Output Quality ({settings.outputQuality}%)</span>
                </div>
                <input 
                    type="range" min="0" max="100" step="5" 
                    value={settings.outputQuality} 
                    onChange={(e) => setSettings(s => ({...s, outputQuality: parseInt(e.target.value)}))}
                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
          </div>

          <div className="mt-4">
            <AnalysisPanel analysis={analysis} isLoading={isAnalyzing} />
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col bg-gray-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
        
        <div className="p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-md flex justify-between items-center z-10">
        <div>
            <h2 className="text-lg font-semibold text-white">Target Workspace</h2>
            <p className="text-sm text-gray-400">Batch processing optimized for cost</p>
        </div>
        <div className="flex gap-3">
             {targets.some(t => t.status === 'completed') && (
                <Button 
                  variant="secondary" 
                  onClick={downloadAll}
                  isLoading={isZipping}
                  className="bg-green-600 hover:bg-green-500 text-white"
                >
                  Download All ZIP
                </Button>
            )}

            <div className="relative overflow-hidden">
                <Button variant="secondary" onClick={() => document.getElementById('target-upload')?.click()}>
                    + Add Target
                </Button>
                <input id="target-upload" type="file" className="hidden" multiple accept="image/*" onChange={(e) => {
                      if(e.target.files) Array.from(e.target.files).forEach(handleTargetSelect);
                }} />
            </div>
            <Button 
                disabled={sourceFaces.length === 0 || targets.filter(t => t.status === 'idle').length === 0}
                onClick={runBatchProcessor}
                isLoading={isProcessingBatch}
            >
                Run Batch ({targets.filter(t => t.status === 'idle').length})
            </Button>
        </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {targets.map((target) => (
                    <div key={target.id} className="relative group bg-gray-900 rounded-xl border border-gray-800 overflow-hidden shadow-lg">
                        <div className="aspect-[4/5] relative">
                            <img 
                                src={target.processedUrl || target.originalUrl} 
                                className="w-full h-full object-cover" 
                                alt="Target"
                            />
                            {target.status === 'processing' && (
                                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 px-4">
                                  <div className="relative w-14 h-14">
                                    <div className="w-14 h-14 border-4 border-blue-900 rounded-full" />
                                    <div className="absolute inset-0 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                    <div className="absolute inset-2 border-2 border-indigo-500 border-b-transparent rounded-full animate-spin" style={{animationDirection:"reverse",animationDuration:"0.8s"}} />
                                  </div>
                                  <p className="text-xs font-mono text-blue-300 animate-pulse text-center leading-relaxed">
                                    {target.progressMsg || "Compositing..."}
                                  </p>
                                </div>
                            )}
                            {target.status === 'completed' && (
                                <div className="absolute top-2 right-2">
                                    <span className="bg-green-500 text-black text-xs font-bold px-2 py-1 rounded shadow-lg">DONE</span>
                                </div>
                            )}
                             {target.status === 'failed' && (
                                <div className="absolute inset-0 bg-red-900/90 flex items-center justify-center p-4">
                                    <span className="text-white text-xs">{target.error}</span>
                                </div>
                            )}
                        </div>
                        <div className="p-3 flex justify-between items-center bg-gray-850 border-t border-gray-800">
                             {target.status === 'completed' && target.processedUrl ? (
                                <a href={target.processedUrl} download={`swap_${target.id}.png`} className="text-blue-400 hover:text-blue-300 text-xs font-medium">Download</a>
                             ) : <span className="text-xs text-gray-500">{target.status}</span>}
                            
                            <button onClick={() => setTargets(prev => prev.filter(p => p.id !== target.id))} className="text-gray-500 hover:text-red-400">
                                ×
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      </div>
    </div>
  );
}

export default App;
