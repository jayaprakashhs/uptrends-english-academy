/**
 * Safely extracts the YouTube video ID from various YouTube URL formats.
 */
export function extractYouTubeId(urlOrId?: string | null): string | null {
  if (!urlOrId) return null;
  const clean = urlOrId.trim();

  // If already an 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) {
    return clean;
  }

  // Handle standard youtube.com/watch?v=ID
  const matchWatch = clean.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (matchWatch && matchWatch[1]) {
    return matchWatch[1];
  }

  // Handle shorts or live
  const matchShorts = clean.match(/youtube\.com\/(?:shorts|live)\/([\w-]{11})/);
  if (matchShorts && matchShorts[1]) {
    return matchShorts[1];
  }

  return null;
}

/**
 * Returns the highest resolution available thumbnail with automatic fallbacks.
 */
export function getYouTubeThumbnail(
  videoId: string | null,
  quality: 'hqdefault' | 'maxresdefault' = 'hqdefault',
): string {
  if (!videoId) {
    return 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=80';
  }
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}
