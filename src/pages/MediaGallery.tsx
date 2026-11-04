import React, { useEffect, useState } from 'react';
import { MediaItem, AUDIENCE_TAGS, AudienceTag } from '../types';
import { Play, Image as ImageIcon, Video, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { extractYouTubeId, getYouTubeThumbnail } from '../lib/youtube';
import { ApplicationCTA } from '../components/ApplicationCTA';
import { PremiumDropdown } from '../components/PremiumDropdown';

interface MediaGalleryProps {
  mediaItems: MediaItem[];
  openVideoModal: (url: string, title: string) => void;
  openDemoClassModal: () => void;
  openCallbackModal: (programName?: string) => void;
}

export const MediaGallery: React.FC<MediaGalleryProps> = ({
  mediaItems,
  openVideoModal,
  openDemoClassModal,
  openCallbackModal,
}) => {
  const [contentType, setContentType] = useState<'all' | 'photo' | 'video'>('all');
  const [audience, setAudience] = useState<'all' | AudienceTag>('all');
  const [photoIndex, setPhotoIndex] = useState(0);
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const [lightboxPhoto, setLightboxPhoto] = useState<MediaItem | null>(null);

  const publishedItems = mediaItems.filter((item) => item.is_published);
  const photos = publishedItems.filter((item) =>
    item.media_type === 'photo' && (audience === 'all' || item.audience_tag === audience),
  );
  const testimonials = publishedItems.filter((item) =>
    item.media_type === 'video' && (audience === 'all' || item.audience_tag === audience),
  );

  useEffect(() => {
    setPhotoIndex((index) => Math.min(index, Math.max(photos.length - 1, 0)));
  }, [photos.length]);
  useEffect(() => {
    setTestimonialIndex((index) => Math.min(index, Math.max(testimonials.length - 1, 0)));
  }, [testimonials.length]);
  useEffect(() => {
    if (photos.length < 2) return;
    const intervalId = window.setInterval(() => {
      if (window.matchMedia('(max-width: 639px)').matches) {
        setPhotoIndex((index) => (index + 1) % photos.length);
      }
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [photos.length]);
  useEffect(() => {
    if (testimonials.length < 2) return;
    const intervalId = window.setInterval(() => {
      if (window.matchMedia('(max-width: 639px)').matches) {
        setTestimonialIndex((index) => (index + 1) % testimonials.length);
      }
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [testimonials.length]);

  const renderMediaCard = (item: MediaItem, mobile = false) => {
    const isVideo = item.media_type === 'video';
    const yId = isVideo ? extractYouTubeId(item.youtube_url || item.youtube_video_id) : null;
    const coverSrc = isVideo
      ? item.cover_image_url || getYouTubeThumbnail(yId)
      : item.cover_image_url || item.media_url || '';

    return (
      <div
        key={item.id}
        className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-all duration-300 hover:shadow-xl ${mobile ? 'media-card-mobile-transition' : ''}`}
        onClick={() => {
          if (isVideo && item.youtube_url) openVideoModal(item.youtube_url, item.title);
          else setLightboxPhoto(item);
        }}
      >
        <div className="relative aspect-16/10 overflow-hidden bg-slate-900">
          <img
            src={coverSrc}
            alt={item.alt_text || item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {isVideo ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/35 transition-colors group-hover:bg-black/20">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg transition-transform group-hover:scale-110">
                <Play className="ml-0.5 h-6 w-6 fill-current" />
              </div>
              <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                YouTube Video
              </span>
            </div>
          ) : (
            <span className="absolute left-3 top-3 rounded bg-emerald-700/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur-xs">
              Photo
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-between p-5">
          <div>
            <span className="mb-2 inline-flex max-w-full rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-semibold text-orange-800">
              {item.audience_tag || 'Audience not set'}
            </span>
            <h3 className="text-base font-bold leading-snug text-slate-900 transition-colors group-hover:text-orange-600">
              {item.title}
            </h3>
            {item.caption && (
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">
                {item.caption}
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400">
            <span>{isVideo ? 'Click to play video' : 'Click to view photo'}</span>
            <span className="font-medium text-orange-600">{isVideo ? 'Watch →' : 'Expand →'}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderMediaCards = (
    items: MediaItem[],
    emptyText: string,
    currentIndex: number,
    setCurrentIndex: React.Dispatch<React.SetStateAction<number>>,
    carouselLabel: string,
  ) => {
    if (!items.length) {
      return (
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-700">{emptyText}</p>
        </div>
      );
    }

    return (
      <>
        <div className="hidden grid-cols-1 gap-6 sm:grid sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => renderMediaCard(item))}
        </div>
        <div className="mx-auto max-w-md sm:hidden">
          {renderMediaCard(items[currentIndex], true)}
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              aria-label={`Previous ${carouselLabel}`}
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-[#0B1F4D] shadow-sm transition hover:border-orange-300 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-xs font-semibold text-slate-500" aria-live="polite">
              {currentIndex + 1} / {items.length}
            </span>
            <button
              type="button"
              aria-label={`Next ${carouselLabel}`}
              disabled={currentIndex === items.length - 1}
              onClick={() => setCurrentIndex((index) => Math.min(index + 1, items.length - 1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-[#0B1F4D] shadow-sm transition hover:border-orange-300 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="space-y-12 py-12">
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-orange-800">
            <Video className="h-4 w-4 text-orange-600" />
            <span>Academy In Pictures &amp; Video</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Media &amp; Testimonials
          </h1>
          <p className="text-base leading-relaxed text-slate-600">
            Take a look inside Uptrend’s English Academy: classroom interaction sessions, video talks, and student speech activities at our Davangere campus.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:gap-4 sm:p-5">
          <div className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block text-[11px] sm:text-xs">Content Type</span>
            <PremiumDropdown
              id="media-content-type-filter"
              aria-label="Filter content type"
              value={contentType}
              onChange={(event) => {
                const selected = event;
                setContentType(selected === 'photo' || selected === 'video' ? selected : 'all');
              }}
              className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-800 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100 sm:min-h-11 sm:px-3 sm:text-sm"
              options={[
                { value: 'all', label: 'All' },
                { value: 'photo', label: 'Photos' },
                { value: 'video', label: 'Testimonials' },
              ]}
            />
          </div>
          <div className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block text-[11px] sm:text-xs">Audience</span>
            <PremiumDropdown
              id="media-audience-filter"
              aria-label="Filter audience"
              value={audience}
              onChange={(value) => {
                const selected = AUDIENCE_TAGS.find((tag) => tag === value);
                setAudience(value === 'all' ? 'all' : selected || 'all');
                setPhotoIndex(0);
                setTestimonialIndex(0);
              }}
              className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-800 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100 sm:min-h-11 sm:px-3 sm:text-sm"
              options={[
                { value: 'all', label: 'All' },
                ...AUDIENCE_TAGS.map((tag) => ({ value: tag, label: tag })),
              ]}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-12 px-4 sm:px-6 lg:px-8">
        {(contentType === 'all' || contentType === 'photo') && (
          <div>
            <div className="mb-5 text-center">
              <h2 className="flex items-center justify-center gap-2 text-2xl font-extrabold text-slate-950">
                <ImageIcon className="h-5 w-5 text-orange-600" />
                Media Gallery
              </h2>
            </div>
            {renderMediaCards(photos, 'No published photos found for this audience.', photoIndex, setPhotoIndex, 'photos')}
          </div>
        )}

        {(contentType === 'all' || contentType === 'video') && (
          <div>
            <div className="mb-5 text-center">
              <h2 className="flex items-center justify-center gap-2 text-2xl font-extrabold text-slate-950">
                <Video className="h-5 w-5 text-orange-600" />
                Testimonials
              </h2>
            </div>
            {renderMediaCards(testimonials, 'No approved testimonials found for this audience.', testimonialIndex, setTestimonialIndex, 'testimonials')}
          </div>
        )}
      </section>

      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/85 p-4 backdrop-blur-md fade-in duration-200">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 p-4 text-white">
              <h3 className="truncate pr-4 text-sm font-bold text-slate-200">{lightboxPhoto.title}</h3>
              <button
                type="button"
                aria-label="Close photo preview"
                onClick={() => setLightboxPhoto(null)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex max-h-[75vh] items-center justify-center bg-black p-2">
              <img
                src={lightboxPhoto.media_url || lightboxPhoto.cover_image_url || ''}
                alt={lightboxPhoto.alt_text || lightboxPhoto.title}
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            </div>
            {lightboxPhoto.caption && (
              <div className="border-t border-slate-800 bg-slate-900 p-4 text-xs text-slate-300">
                {lightboxPhoto.caption}
              </div>
            )}
          </div>
        </div>
      )}
      <ApplicationCTA
        openDemoClassModal={openDemoClassModal}
        openCallbackModal={openCallbackModal}
      />
    </div>
  );
};
