BEGIN;

CREATE OR REPLACE FUNCTION public.update_official_document_settings(
  p_settings jsonb,
  p_updated_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document_data jsonb;
  v_updated_at timestamptz;
BEGIN
  IF jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Official document settings must be a JSON object.';
  END IF;
  IF p_settings ? 'termsAndConditions'
    AND jsonb_typeof(p_settings -> 'termsAndConditions') <> 'array' THEN
    RAISE EXCEPTION 'Terms and conditions must be a JSON array.';
  END IF;

  INSERT INTO public.official_document_settings (
    setting_key,
    document_data,
    updated_at,
    updated_by
  )
  VALUES (
    'admission_approval',
    p_settings,
    now(),
    p_updated_by
  )
  ON CONFLICT (setting_key) DO UPDATE
  SET document_data = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(public.official_document_settings.document_data, '{}'::jsonb)
                  || EXCLUDED.document_data,
                '{sectionHeadings}',
                COALESCE(public.official_document_settings.document_data -> 'sectionHeadings', '{}'::jsonb)
                  || COALESCE(EXCLUDED.document_data -> 'sectionHeadings', '{}'::jsonb),
                true
              ),
              '{colors}',
              COALESCE(public.official_document_settings.document_data -> 'colors', '{}'::jsonb)
                || COALESCE(EXCLUDED.document_data -> 'colors', '{}'::jsonb),
              true
            ),
            '{typography}',
            COALESCE(public.official_document_settings.document_data -> 'typography', '{}'::jsonb)
              || COALESCE(EXCLUDED.document_data -> 'typography', '{}'::jsonb),
            true
          ),
          '{layout}',
          COALESCE(public.official_document_settings.document_data -> 'layout', '{}'::jsonb)
            || COALESCE(EXCLUDED.document_data -> 'layout', '{}'::jsonb),
          true
        ),
        '{termsAndConditions}',
        CASE
          WHEN EXCLUDED.document_data ? 'termsAndConditions'
            THEN EXCLUDED.document_data -> 'termsAndConditions'
          ELSE COALESCE(public.official_document_settings.document_data -> 'termsAndConditions', '[]'::jsonb)
        END,
        true
      ),
      updated_at = now(),
      updated_by = EXCLUDED.updated_by
  RETURNING document_data, updated_at
  INTO v_document_data, v_updated_at;

  RETURN jsonb_build_object(
    'settings', v_document_data,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_official_document_settings(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_official_document_settings(jsonb, uuid)
  TO service_role;

COMMIT;
