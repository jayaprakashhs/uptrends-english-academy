BEGIN;

ALTER TABLE public.application_contact_registry
  DROP CONSTRAINT IF EXISTS application_contact_registry_email_key,
  DROP CONSTRAINT IF EXISTS application_contact_registry_mobile_key;

DROP INDEX IF EXISTS public.idx_application_contact_registry_source_email;
DROP INDEX IF EXISTS public.idx_application_contact_registry_source_mobile;

CREATE OR REPLACE FUNCTION public.check_application_contact_duplicate(
  p_source_table text,
  p_email text,
  p_mobile text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_source_table NOT IN ('applications', 'demo_class_requests', 'callback_requests') THEN
    RAISE EXCEPTION 'Unsupported contact request type.';
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.check_application_contact_duplicate(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_application_contact_duplicate(text, text, text)
  TO service_role;

COMMIT;
