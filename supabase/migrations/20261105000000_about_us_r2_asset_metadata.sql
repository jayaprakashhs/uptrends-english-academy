-- About Us images are stored in R2; Supabase retains only their object keys
-- and the validated content metadata returned by the Worker.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS photo_content_type TEXT,
  ADD COLUMN IF NOT EXISTS photo_size_bytes BIGINT;

ALTER TABLE public.about_us_video_configurations
  ADD COLUMN IF NOT EXISTS poster_content_type TEXT,
  ADD COLUMN IF NOT EXISTS poster_size_bytes BIGINT;
