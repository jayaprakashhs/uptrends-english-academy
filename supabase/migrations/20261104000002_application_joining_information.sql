BEGIN;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS joining_information JSONB NOT NULL DEFAULT '{}'::jsonb;

WITH latest_joining_information AS (
  SELECT DISTINCT ON (application_id)
    application_id,
    snapshot -> 'joining_information' AS joining_information
  FROM public.official_document_issuances
  WHERE jsonb_typeof(snapshot -> 'joining_information') = 'object'
    AND snapshot -> 'joining_information' <> '{}'::jsonb
  ORDER BY application_id, version_number DESC
)
UPDATE public.applications AS application
SET joining_information = latest_joining_information.joining_information
FROM latest_joining_information
WHERE application.id = latest_joining_information.application_id
  AND application.joining_information = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.approve_application_with_official_snapshot(
  p_application_id uuid,
  p_approver_id uuid,
  p_approver_name text,
  p_joining_information jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_issuance public.official_document_issuances%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE id = p_approver_id AND is_active = true
      AND role IN ('staff', 'admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Authorized approver is required.';
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application record not found.';
  END IF;

  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1;
  IF FOUND THEN
    RETURN jsonb_build_object('application', to_jsonb(v_application), 'issuance', to_jsonb(v_issuance));
  END IF;

  UPDATE public.applications
  SET status = 'Accepted',
      joining_information = p_joining_information,
      approved_by_user_id = p_approver_id,
      approved_by_name = NULLIF(btrim(p_approver_name), ''),
      approved_at = COALESCE(approved_at, now())
  WHERE id = p_application_id
  RETURNING * INTO v_application;

  v_snapshot := public.build_official_document_snapshot(p_application_id, p_joining_information);
  INSERT INTO public.official_document_issuances (
    application_id,
    application_reference,
    student_id,
    version_number,
    issuance_type,
    source_event_key,
    snapshot,
    status
  )
  VALUES (
    p_application_id,
    v_application.application_reference,
    v_application.student_id,
    1,
    'approval',
    'approval:' || p_application_id::text,
    v_snapshot,
    'pending'
  )
  ON CONFLICT (application_id, version_number) DO NOTHING;

  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1;

  RETURN jsonb_build_object('application', to_jsonb(v_application), 'issuance', to_jsonb(v_issuance));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_application_with_official_snapshot(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_application_with_official_snapshot(uuid, uuid, text, jsonb)
  TO service_role;

COMMIT;
