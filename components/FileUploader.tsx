import React, { useRef } from 'react';

interface FileUploaderProps {
  label: string;
  onFileSelect: (file: File) => void;
  accept?: string;
  currentImage?: string | null;
  onClear?: () => void;
  compact?: boolean;
  statusMessage?: string | null;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  label, 
  onFileSelect, 
  accept = "image/*", 
  currentImage, 
  onClear,
  compact = false,
  statusMessage
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div className={`w-full ${compact ? 'h-32' : 'h-64'}`}>
      <input
        type="file"
        ref={inputRef}
        onChange={handleChange}
        accept={accept}
        className="hidden"
      />
      
      {currentImage ? (
        <div className="relative w-full h-full rounded-xl overflow-hidden border border-gray-700 group">
          <img src={currentImage} alt="Uploaded" className="w-full h-full object-cover" />
          
          {/* Status Message Banner (Auto-remember feature) */}
          {statusMessage && (
             <div className="absolute top-0 left-0 right-0 bg-blue-900/80 backdrop-blur-sm text-blue-100 text-[10px] font-medium py-1 px-2 text-center border-b border-blue-700/50 z-10">
               {statusMessage}
             </div>
          )}

          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button 
              onClick={() => inputRef.current?.click()}
              className="bg-blue-600 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-500"
            >
              Change
            </button>
            {onClear && (
               <button 
               onClick={(e) => { e.stopPropagation(); onClear(); }}
               className="bg-red-600 text-white px-3 py-1 rounded-md text-sm hover:bg-red-500"
             >
               Remove
             </button>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
             <span className="text-xs font-semibold text-gray-200 px-1">{label}</span>
          </div>
        </div>
      ) : (
        <div 
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="w-full h-full border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-gray-800/30 transition-all text-gray-400 group"
        >
          <svg className="w-10 h-10 mb-2 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-gray-500 mt-1">Click or drag image</span>
        </div>
      )}
    </div>
  );
};