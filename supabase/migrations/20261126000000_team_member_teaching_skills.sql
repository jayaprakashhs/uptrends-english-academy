ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS teaching_skills JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(teaching_skills) = 'array');
