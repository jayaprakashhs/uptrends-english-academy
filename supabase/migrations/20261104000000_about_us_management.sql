-- About Us management uses the existing admin_profiles role system.
-- Team-member access continues to use the existing is_super_admin() policies.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS qualifications TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_object_key TEXT,
  ADD COLUMN IF NOT EXISTS photo_content_type TEXT,
  ADD COLUMN IF NOT EXISTS photo_size_bytes BIGINT;

CREATE INDEX IF NOT EXISTS idx_team_members_published_display_order
  ON public.team_members (display_order, created_at)
  WHERE is_published = true;

CREATE TABLE IF NOT EXISTS public.about_us_video_configurations (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  youtube_url TEXT NOT NULL DEFAULT 'https://www.youtube.com/watch?v=ScMzIvxBSi4'
    CHECK (youtube_url ~* '^https://(www[.])?youtube[.]com/|^https://youtu[.]be/'),
  poster_object_key TEXT,
  poster_content_type TEXT,
  poster_size_bytes BIGINT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_about_us_video_configurations_updated_at
  BEFORE UPDATE ON public.about_us_video_configurations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.about_us_video_configurations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.about_us_video_configurations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.about_us_video_configurations TO authenticated;

DROP POLICY IF EXISTS "Public can view published About Us video configuration"
  ON public.about_us_video_configurations;
CREATE POLICY "Public can view published About Us video configuration"
  ON public.about_us_video_configurations
  FOR SELECT
  USING (is_published = true);

DROP POLICY IF EXISTS "Super admins can manage About Us video configuration"
  ON public.about_us_video_configurations;
CREATE POLICY "Super admins can manage About Us video configuration"
  ON public.about_us_video_configurations
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
