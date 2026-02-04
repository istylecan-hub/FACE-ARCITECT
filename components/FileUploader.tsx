import React, { useRef } from 'react';

interface FileUploaderProps {
  label: string;
  onFileSelect: (file: File) => void;
  accept?: string;
  currentImages?: string[]; 
  onClear?: () => void;
  onRemoveSingle?: (index: number) => void;
  compact?: boolean;
  statusMessage?: string | null;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  label, 
  onFileSelect, 
  accept = "image/*", 
  currentImages = [], 
  onClear,
  onRemoveSingle,
  compact = false,
  statusMessage
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
    // Reset input so same file can be selected again if needed
    if (inputRef.current) inputRef.current.value = '';
  };

  const hasImages = currentImages && currentImages.length > 0;
  const primaryImage = hasImages ? currentImages[0] : null;

  return (
    <div className={`w-full ${compact ? 'h-auto' : 'h-64'}`}>
      <input
        type="file"
        ref={inputRef}
        onChange={handleChange}
        accept={accept}
        className="hidden"
      />
      
      {hasImages ? (
        <div className="space-y-2">
            {/* Primary Image (Big) */}
            <div className="relative w-full h-40 rounded-xl overflow-hidden border border-blue-500/50 group bg-gray-900">
                <img src={primaryImage!} alt="Primary" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                
                {statusMessage && (
                    <div className="absolute top-0 left-0 right-0 bg-blue-900/80 backdrop-blur-sm text-blue-100 text-[10px] font-medium py-1 text-center z-10">
                        {statusMessage}
                    </div>
                )}
                
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 flex justify-between items-end">
                    <span className="text-xs font-bold text-white px-1">Primary Face</span>
                    {onClear && (
                        <button onClick={(e) => { e.stopPropagation(); onClear(); }} className="text-xs bg-red-600/80 hover:bg-red-500 text-white px-2 py-1 rounded">
                            Reset All
                        </button>
                    )}
                </div>
            </div>

            {/* Thumbnails (Add More) */}
            <div className="flex gap-2 overflow-x-auto pb-1">
                {currentImages.map((img, idx) => (
                    <div key={idx} className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border border-gray-700 group">
                        <img src={img} className="w-full h-full object-cover" alt={`Ref ${idx}`} />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            {idx > 0 && onRemoveSingle && (
                                <button onClick={() => onRemoveSingle(idx)} className="text-red-400 hover:text-white">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Add Button */}
                {currentImages.length < 3 && (
                    <button 
                        onClick={() => inputRef.current?.click()}
                        className="w-16 h-16 flex-shrink-0 rounded-lg border-2 border-dashed border-gray-700 hover:border-blue-500 hover:bg-gray-800 flex flex-col items-center justify-center text-gray-500 hover:text-blue-400 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        <span className="text-[9px] mt-1 font-medium">Add Angle</span>
                    </button>
                )}
            </div>
            <p className="text-[10px] text-gray-400 text-center">Tip: Add Front, Side, and 45° views for best accuracy.</p>
        </div>
      ) : (
        <div 
          onClick={() => inputRef.current?.click()}
          className="w-full h-32 border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-gray-800/30 transition-all text-gray-400"
        >
          <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <span className="text-xs font-medium">Upload Source Face</span>
        </div>
      )}
    </div>
  );
};