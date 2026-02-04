import React, { useState, useEffect, useCallback } from 'react';
import { FileUploader } from './components/FileUploader';
import { Button } from './components/Button';
import { Toggle } from './components/Toggle';
import { AnalysisPanel } from './components/AnalysisPanel';
import { analyzeFace, performFaceSwap } from './services/geminiService';
import { loadPreferences, updatePreferences } from './services/storageService';
import { DEFAULT_SWAP_SETTINGS } from './constants';
import { FaceAnalysisResult, ProcessedImage, SwapSettings, AppSessionState } from './types';

function App() {
  // App Loading State
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);

  // State for Face Swap
  const [sourceFace, setSourceFace] = useState<string | null>(null);
  const [targets, setTargets] = useState<ProcessedImage[]>([]);
  const [analysis, setAnalysis] = useState<FaceAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [settings, setSettings] = useState<SwapSettings>(DEFAULT_SWAP_SETTINGS);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const [autoRestoreMsg, setAutoRestoreMsg] = useState<string | null>(null);

  // Load User Preferences (Full Session Restore) on Mount
  useEffect(() => {
    const init = async () => {
      try {
        const prefs = await loadPreferences();
        if (prefs) {
          // Restore Complete Session State if available
          if (prefs.session_state) {
             const s = prefs.session_state;
             setTargets(s.targets || []);
             setSourceFace(s.sourceFace || null);
             setAnalysis(s.analysis || null);
             
             if (s.sourceFace || s.targets.length > 0) {
                 setAutoRestoreMsg("✓ Session Restored");
                 setTimeout(() => setAutoRestoreMsg(null), 4000);
             }
          } 
          // Fallback: If no full session, check for last validated source (bookmarks)
          else if (prefs.last_used_source?.image) {
            setSourceFace(prefs.last_used_source.image);
            setAnalysis(prefs.last_used_source.analysis); 
            setAutoRestoreMsg("✓ Face Restored");
            setTimeout(() => setAutoRestoreMsg(null), 4000);
          }
        }
      } catch (e) {
        console.warn("Failed to load user preferences", e);
      } finally {
        setIsStorageLoaded(true);
      }
    };
    init();
  }, []);

  // Auto-save Session State (Debounced)
  useEffect(() => {
    if (!isStorageLoaded) return; // Don't save before initial load completes

    const timer = setTimeout(() => {
      const sessionState: AppSessionState = {
          targets,
          sourceFace: sourceFace || undefined,
          analysis: analysis || undefined,
      };
      
      updatePreferences({ session_state: sessionState }).catch(e => 
        console.warn("Failed to auto-save session", e)
      );
    }, 500); // 500ms debounce for responsiveness

    return () => clearTimeout(timer);
  }, [isStorageLoaded, targets, sourceFace, analysis]);

  // Save successful face to IndexedDB (Bookmark)
  const saveSourceFaceToStorage = async (image: string, analysisData: FaceAnalysisResult) => {
    try {
      await updatePreferences({
        last_used_source: {
          image,
          analysis: analysisData,
          timestamp: Date.now()
        }
      });
    } catch (e) {
      console.warn("Failed to save user preferences", e);
    }
  };

  // Handle file selection
  const handleSourceSelect = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setSourceFace(base64);
      setAnalysis(null);
      setAutoRestoreMsg(null); 
      setIsAnalyzing(true);
      try {
        const result = await analyzeFace(base64);
        setAnalysis(result);
      } catch (err) {
        console.error("Analysis failed", err);
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTargetSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      const newTarget: ProcessedImage = {
        id: Date.now().toString() + Math.random().toString(),
        originalUrl: base64,
        status: 'idle'
      };
      setTargets(prev => [...prev, newTarget]);
    };
    reader.readAsDataURL(file);
  };

  const processQueue = useCallback(async () => {
    if (processingQueue.length === 0 || !sourceFace) return;

    const targetId = processingQueue[0];
    const target = targets.find(t => t.id === targetId);

    if (!target) {
      setProcessingQueue(prev => prev.slice(1));
      return;
    }

    setTargets(prev => prev.map(t => t.id === targetId ? { ...t, status: 'processing' } : t));

    try {
      const swappedImage = await performFaceSwap(sourceFace, target.originalUrl, settings);
      
      // Save this source face as the "Last Used" valid face if successful
      if (analysis) {
        saveSourceFaceToStorage(sourceFace, analysis);
      }

      setTargets(prev => prev.map(t => t.id === targetId ? { 
        ...t, 
        status: 'completed', 
        processedUrl: swappedImage 
      } : t));

    } catch (error) {
       setTargets(prev => prev.map(t => t.id === targetId ? { 
        ...t, 
        status: 'failed', 
        error: error instanceof Error ? error.message : 'Unknown error'
      } : t));
    } finally {
      setProcessingQueue(prev => prev.slice(1));
    }
  }, [processingQueue, sourceFace, targets, settings, analysis]);

  useEffect(() => {
    if (processingQueue.length > 0) {
      processQueue();
    }
  }, [processingQueue, processQueue]);

  const startBatchProcessing = () => {
    const pendingIds = targets.filter(t => t.status === 'idle').map(t => t.id);
    setProcessingQueue(pendingIds);
  };

  return (
    <div className="flex h-screen w-full bg-gray-950 text-gray-100 overflow-hidden">
      
      {/* SIDEBAR */}
      <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900 z-10 shadow-2xl">
        <div className="p-4 border-b border-gray-800">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">Gemini Architect</h1>
            <p className="text-xs text-gray-500 mt-1">Powered by Gemini 3 Pro</p>
        </div>

        {/* Removed Tab Navigation */}

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* SOURCE UPLOAD */}
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Source Face</h3>
            <FileUploader 
              label="Upload Face" 
              onFileSelect={handleSourceSelect} 
              currentImage={sourceFace}
              statusMessage={autoRestoreMsg}
              onClear={() => { 
                setSourceFace(null); 
                setAnalysis(null); 
                setAutoRestoreMsg(null);
              }}
              compact
            />
          </div>

          {/* SETTINGS */}
          <div>
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Architect Controls</h3>
              <div className="space-y-0 divide-y divide-gray-800">
                <Toggle label="Preserve Hair" checked={settings.preserveHair} onChange={v => setSettings(s => ({...s, preserveHair: v}))} />
                <Toggle label="Match Skin Tone" checked={settings.matchSkinTone} onChange={v => setSettings(s => ({...s, matchSkinTone: v}))} />
                <Toggle label="Match Lighting" checked={settings.matchLighting} onChange={v => setSettings(s => ({...s, matchLighting: v}))} />
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs mb-1 text-gray-400">
                    <span>Skin Smoothness</span>
                    <span>{settings.skinSmoothness}/10</span>
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
                    <span>Output Quality</span>
                    <span>{settings.outputQuality}%</span>
                </div>
                <input 
                    type="range" min="0" max="100" step="5" 
                    value={settings.outputQuality} 
                    onChange={(e) => setSettings(s => ({...s, outputQuality: parseInt(e.target.value)}))}
                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
          </div>

          {/* ANALYSIS */}
          <div className="mt-4">
            <AnalysisPanel analysis={analysis} isLoading={isAnalyzing} />
          </div>

        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col bg-gray-950 relative overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
        
        <div className="p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-md flex justify-between items-center z-10">
        <div>
            <h2 className="text-lg font-semibold text-white">Target Workspace</h2>
            <p className="text-sm text-gray-400">Add target images to process batch swaps</p>
        </div>
        <div className="flex gap-3">
            <div className="relative overflow-hidden">
                <Button variant="secondary" onClick={() => document.getElementById('target-upload')?.click()}>
                    + Add Target
                </Button>
                <input id="target-upload" type="file" className="hidden" multiple accept="image/*" onChange={(e) => {
                      if(e.target.files) Array.from(e.target.files).forEach(handleTargetSelect);
                }} />
            </div>
            <Button 
                disabled={!sourceFace || targets.filter(t => t.status === 'idle').length === 0}
                onClick={startBatchProcessing}
                isLoading={processingQueue.length > 0}
            >
                Run Batch ({targets.filter(t => t.status === 'idle').length})
            </Button>
        </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {targets.map((target) => (
                    <div key={target.id} className="relative group bg-gray-900 rounded-xl border border-gray-800 overflow-hidden shadow-lg transition-all hover:border-gray-600">
                        <div className="aspect-[4/5] relative">
                            <img 
                                src={target.processedUrl || target.originalUrl} 
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                                alt="Target"
                            />
                            
                            {/* Status Overlays */}
                            {target.status === 'processing' && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                                      <span className="text-sm font-mono text-blue-400">Nano Banana Working...</span>
                                </div>
                            )}
                            {target.status === 'failed' && (
                                <div className="absolute inset-0 bg-red-900/80 flex items-center justify-center p-4 text-center">
                                    <p className="text-white text-sm">Failed: {target.error}</p>
                                </div>
                            )}
                            {target.status === 'completed' && (
                                <div className="absolute top-2 right-2">
                                    <span className="bg-green-500 text-black text-xs font-bold px-2 py-1 rounded shadow-lg flex items-center gap-1">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                                        DONE
                                    </span>
                                </div>
                            )}
                        </div>
                        
                        {/* Card Footer */}
                        <div className="p-3 flex justify-between items-center bg-gray-850 border-t border-gray-800">
                            <span className="text-xs text-gray-500 font-mono truncate max-w-[120px]">{target.id.substring(0,8)}...</span>
                            {target.status === 'completed' && target.processedUrl && (
                                <a href={target.processedUrl} download={`swap_${target.id}.png`} className="text-blue-400 hover:text-blue-300 text-xs font-medium flex items-center gap-1">
                                    Download <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                </a>
                            )}
                            {target.status === 'idle' && (
                                  <button onClick={() => {
                                    setTargets(prev => prev.filter(p => p.id !== target.id));
                                  }} className="text-red-500 hover:text-red-400">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                  </button>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Empty State */}
                {targets.length === 0 && (
                    <div className="col-span-full h-64 flex flex-col items-center justify-center text-gray-600 border-2 border-dashed border-gray-800 rounded-2xl">
                        <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <p>No target images. Add images to start swapping.</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}

export default App;