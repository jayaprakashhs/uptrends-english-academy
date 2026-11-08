BEGIN;

CREATE TABLE IF NOT EXISTS public.official_document_email_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.applications(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  action_type text NOT NULL
    CHECK (action_type IN ('approval', 'resend_official_pdf')),
  attempted_by uuid
    REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  result text NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending', 'success', 'failure')),
  failure_code text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_official_document_email_attempts_application
  ON public.official_document_email_attempts (application_id, attempted_at DESC);

ALTER TABLE public.official_document_email_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.official_document_email_attempts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.official_document_email_attempts TO service_role;

COMMIT;
