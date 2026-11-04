import React from 'react';
import { X } from 'lucide-react';
import { extractYouTubeId } from '../lib/youtube';

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrlOrId: string | null;
  title: string;
}

export const VideoModal: React.FC<VideoModalProps> = ({
  isOpen,
  onClose,
  videoUrlOrId,
  title,
}) => {
  if (!isOpen || !videoUrlOrId) return null;

  const videoId = extractYouTubeId(videoUrlOrId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[600px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 text-white border-b border-slate-800">
          <h3 className="font-bold text-sm sm:text-base text-slate-100 truncate pr-4">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Close video"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative aspect-video max-h-[calc(100dvh-7rem)] w-full bg-black">
          {videoId ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
              title={title}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Invalid or unavailable YouTube video.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
