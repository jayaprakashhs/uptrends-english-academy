ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS audience_tag TEXT;

ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_audience_tag_check
  CHECK (
    audience_tag IS NULL
    OR audience_tag IN (
      'School Students',
      'College Students',
      'Professionals',
      'Homemakers'
    )
  );

CREATE INDEX IF NOT EXISTS idx_media_items_published_audience
  ON public.media_items (is_published, media_type, audience_tag);
