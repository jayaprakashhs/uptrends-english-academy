CREATE TABLE IF NOT EXISTS public.email_template_settings (
  setting_key text PRIMARY KEY DEFAULT 'default'
    CHECK (setting_key = 'default'),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.email_template_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_template_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_template_settings TO service_role;
