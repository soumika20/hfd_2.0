import React, { useState } from 'react';
import { analyzeIncidentImage, fileToBase64 } from './services/geminiService';
import { IncidentAnalysis, AnalysisState } from './types';
import ImageUploader from './components/ImageUploader';
import AnalysisDisplay from './components/AnalysisDisplay';
import { Siren, ShieldAlert, Loader2, X, Info } from 'lucide-react';

const App: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    isLoading: false,
    error: null,
    data: null,
  });

  const handleImageSelect = async (file: File) => {
    try {
      // 1. Reset state & Show loading
      setAnalysisState({ isLoading: true, error: null, data: null });
      
      // 2. Preview Image
      const base64 = await fileToBase64(file);
      setSelectedImage(`data:${file.type};base64,${base64}`);

      // 3. Call API
      const analysis = await analyzeIncidentImage(base64, file.type);
      
      setAnalysisState({
        isLoading: false,
        error: null,
        data: analysis,
      });

    } catch (error) {
      console.error(error);
      setAnalysisState({
        isLoading: false,
        error: error instanceof Error ? error.message : "An unknown error occurred during analysis.",
        data: null,
      });
    }
  };

  const clearSession = () => {
    setSelectedImage(null);
    setAnalysisState({ isLoading: false, error: null, data: null });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      
      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-600 rounded-lg">
                <Siren className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">CrisisLens AI</h1>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-slate-400 text-sm">
                <ShieldAlert className="w-4 h-4" />
                <span>For Emergency Assessment Support</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Intro / Empty State */}
        {!selectedImage && !analysisState.isLoading && (
          <div className="flex flex-col items-center justify-center py-12 animate-in fade-in duration-500">
            <div className="text-center max-w-2xl mb-12">
              <h2 className="text-3xl font-bold text-slate-900 mb-4">Rapid Visual Intelligence for Response</h2>
              <p className="text-slate-600 text-lg">
                Upload scene imagery to instantly generate situational reports, estimate injury counts, and assess critical response timelines.
              </p>
            </div>
            <div className="w-full max-w-xl">
               <ImageUploader onImageSelect={handleImageSelect} isLoading={false} />
            </div>
            
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-center max-w-4xl w-full">
                <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3 text-blue-600 font-bold">1</div>
                    <h3 className="font-semibold text-slate-900 mb-1">Upload</h3>
                    <p className="text-sm text-slate-500">Capture or upload scene photos securely.</p>
                </div>
                <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3 text-indigo-600 font-bold">2</div>
                    <h3 className="font-semibold text-slate-900 mb-1">Analyze</h3>
                    <p className="text-sm text-slate-500">AI identifies injuries, urgency, and relevant hazards.</p>
                </div>
                <div className="p-4 bg-white rounded-lg shadow-sm border border-slate-200">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3 text-red-600 font-bold">3</div>
                    <h3 className="font-semibold text-slate-900 mb-1">Prioritize</h3>
                    <p className="text-sm text-slate-500">Get time-critical intelligence for triage.</p>
                </div>
            </div>
          </div>
        )}

        {/* Processing & Result View */}
        {(selectedImage || analysisState.isLoading) && (
          <div className="grid lg:grid-cols-5 gap-8">
            
            {/* Left Column: Image Preview */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden sticky top-24">
                <div className="relative aspect-[4/3] bg-slate-100 w-full">
                  <img 
                    src={selectedImage || ''} 
                    alt="Scene to analyze" 
                    className="w-full h-full object-cover"
                  />
                  {analysisState.isLoading && (
                    <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                        <Loader2 className="w-10 h-10 animate-spin mb-3" />
                        <p className="font-medium tracking-wide">ANALYZING SCENE...</p>
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Source Image</span>
                    <button 
                        onClick={clearSession}
                        disabled={analysisState.isLoading}
                        className="text-sm text-slate-600 hover:text-red-600 flex items-center gap-1 font-medium transition-colors disabled:opacity-50"
                    >
                        <X className="w-4 h-4" />
                        Reset Analysis
                    </button>
                </div>
              </div>
            </div>

            {/* Right Column: Analysis Output */}
            <div className="lg:col-span-3">
              {analysisState.error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2">
                    <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                    <div>
                        <h3 className="text-lg font-semibold text-red-800 mb-1">Analysis Failed</h3>
                        <p className="text-red-600">{analysisState.error}</p>
                        <button 
                            onClick={clearSession}
                            className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-sm font-medium transition-colors"
                        >
                            Try Another Image
                        </button>
                    </div>
                </div>
              )}

              {analysisState.data && !analysisState.isLoading && (
                <AnalysisDisplay data={analysisState.data} />
              )}
              
              {!analysisState.data && !analysisState.error && !analysisState.isLoading && (
                 <div className="h-full flex items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-xl">
                    <p className="text-slate-400">Waiting for image processing...</p>
                 </div>
              )}
            </div>

          </div>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
             <div className="flex items-center justify-center gap-2 text-amber-600 bg-amber-50 inline-block px-4 py-2 rounded-full mb-2">
                <Info className="w-4 h-4" />
                <span className="text-xs font-semibold">AI GENERATED CONTENT - VERIFY BEFORE ACTING</span>
             </div>
             <p className="text-slate-400 text-xs">
                CrisisLens AI is an assistive tool. Always rely on professional medical and emergency assessment protocols.
                <br/>Determinations made by this AI may be inaccurate.
             </p>
        </div>
      </footer>
    </div>
  );
};

export default App;