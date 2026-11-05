BEGIN;

ALTER TABLE public.application_erasure_policy
  ADD COLUMN IF NOT EXISTS updated_by uuid
    REFERENCES public.admin_profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.application_erasure_policy_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  previous_policy jsonb NOT NULL,
  new_policy jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_erasure_policy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_erasure_policy_audit
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.application_erasure_policy
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_application_erasure_policy_status(
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_policy public.application_erasure_policy%ROWTYPE;
  v_audit jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = p_actor_id
      AND role = 'super_admin'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'application_erasure_policy_super_admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_policy
  FROM public.application_erasure_policy
  WHERE singleton = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_policy_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'changed_by', recent.changed_by,
        'changed_by_name', profile.full_name,
        'previous_policy', recent.previous_policy,
        'new_policy', recent.new_policy,
        'recorded_at', recent.recorded_at
      )
      ORDER BY recent.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_audit
  FROM (
    SELECT *
    FROM public.application_erasure_policy_audit
    ORDER BY id DESC
    LIMIT 20
  ) AS recent
  LEFT JOIN public.admin_profiles AS profile
    ON profile.id = recent.changed_by;

  RETURN jsonb_build_object(
    'policy', to_jsonb(v_policy) - 'singleton',
    'audit', v_audit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_application_erasure_policy(
  p_actor_id uuid,
  p_enabled boolean,
  p_storage_retention_verified boolean,
  p_external_retention_verified boolean,
  p_approved_at timestamptz,
  p_approval_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous public.application_erasure_policy%ROWTYPE;
  v_updated public.application_erasure_policy%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = p_actor_id
      AND role = 'super_admin'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'application_erasure_policy_super_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_enabled IS NULL
     OR p_storage_retention_verified IS NULL
     OR p_external_retention_verified IS NULL THEN
    RAISE EXCEPTION 'application_erasure_policy_fields_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_approved_at IS NOT NULL AND p_approved_at > now() THEN
    RAISE EXCEPTION 'application_erasure_policy_approval_date_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF length(COALESCE(p_approval_reference, '')) > 500 THEN
    RAISE EXCEPTION 'application_erasure_policy_reference_too_long'
      USING ERRCODE = '22023';
  END IF;

  IF p_enabled AND (
    NOT p_storage_retention_verified
    OR NOT p_external_retention_verified
    OR p_approved_at IS NULL
    OR NULLIF(btrim(p_approval_reference), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'application_erasure_policy_requirements_missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_previous
  FROM public.application_erasure_policy
  WHERE singleton = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_policy_unavailable'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.application_erasure_policy
  SET enabled = p_enabled,
      storage_retention_verified = p_storage_retention_verified,
      external_retention_verified = p_external_retention_verified,
      approved_at = p_approved_at,
      approval_reference = NULLIF(btrim(p_approval_reference), ''),
      updated_by = p_actor_id,
      updated_at = now()
  WHERE singleton = true
  RETURNING * INTO v_updated;

  INSERT INTO public.application_erasure_policy_audit (
    changed_by,
    previous_policy,
    new_policy
  )
  VALUES (
    p_actor_id,
    to_jsonb(v_previous) - 'singleton',
    to_jsonb(v_updated) - 'singleton'
  );

  RETURN to_jsonb(v_updated) - 'singleton';
END;
$$;

REVOKE ALL ON FUNCTION public.get_application_erasure_policy_status(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_application_erasure_policy(
  uuid, boolean, boolean, boolean, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_application_erasure_policy_status(uuid),
  public.record_application_erasure_policy(uuid, boolean, boolean, boolean, timestamptz, text)
  TO service_role;

COMMIT;
