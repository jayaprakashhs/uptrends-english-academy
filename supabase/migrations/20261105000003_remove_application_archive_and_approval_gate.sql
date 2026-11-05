BEGIN;

DROP POLICY IF EXISTS "Staff can view active applications" ON public.applications;
DROP POLICY IF EXISTS "Staff can view applications" ON public.applications;
CREATE POLICY "Staff can view applications" ON public.applications
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS "Public can submit applications" ON public.applications;
CREATE POLICY "Public can submit applications" ON public.applications
  FOR INSERT
  WITH CHECK (status = 'Pending');

DROP TRIGGER IF EXISTS trg_prevent_direct_application_archive_changes
  ON public.applications;
DROP FUNCTION IF EXISTS public.prevent_direct_application_archive_changes();
DROP INDEX IF EXISTS public.idx_applications_archived_created;
ALTER TABLE public.applications
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS archived_by;

DROP FUNCTION IF EXISTS public.get_application_erasure_policy_status(uuid);
DROP FUNCTION IF EXISTS public.record_application_erasure_policy(
  uuid, boolean, boolean, boolean, timestamptz, text
);
DROP FUNCTION IF EXISTS public.application_erasure_document_preservation_ready();
DROP FUNCTION IF EXISTS public.delete_application_without_payments(uuid);

CREATE OR REPLACE FUNCTION public.begin_application_erasure(
  p_application_id uuid,
  p_deleted_by uuid
)
RETURNS TABLE (
  job_id uuid,
  application_id uuid,
  status text,
  object_keys text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_job public.application_erasure_jobs%ROWTYPE;
  v_keys text[];
BEGIN
  IF p_deleted_by IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = p_deleted_by
      AND role IN ('admin', 'super_admin')
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'application_erasure_admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.official_document_issuances AS issuance
    WHERE (
      issuance.application_id = v_application.id
      OR issuance.application_reference = v_application.application_reference
    )
      AND (
        (issuance.application_id IS NOT NULL
          AND issuance.application_id <> v_application.id)
        OR issuance.application_reference IS DISTINCT FROM v_application.application_reference
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.application_notifications AS notification
    JOIN public.official_document_issuances AS issuance
      ON issuance.id = notification.official_document_issuance_id
    WHERE (
      notification.application_id = v_application.id
      OR issuance.application_id = v_application.id
      OR issuance.application_reference = v_application.application_reference
    )
      AND (
        notification.application_id IS DISTINCT FROM v_application.id
        OR (issuance.application_id IS NOT NULL
          AND issuance.application_id <> v_application.id)
        OR issuance.application_reference IS DISTINCT FROM v_application.application_reference
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS audit
    LEFT JOIN public.application_payments AS payment
      ON payment.id = audit.payment_id
    WHERE (
      audit.application_id = v_application.id
      AND audit.payment_id IS NOT NULL
      AND payment.application_id IS DISTINCT FROM v_application.id
    ) OR (
      payment.application_id = v_application.id
      AND audit.application_id IS DISTINCT FROM v_application.id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.application_payment_historical_baseline AS baseline
    JOIN public.application_payments AS payment
      ON payment.id = baseline.payment_id
    WHERE (
      baseline.application_id = v_application.id
      AND payment.application_id <> v_application.id
    ) OR (
      payment.application_id = v_application.id
      AND baseline.application_id <> v_application.id
    )
  ) THEN
    RAISE EXCEPTION 'application_erasure_dependency_conflict'
      USING ERRCODE = '55000';
  END IF;

  IF v_application.photo_object_key IS NOT NULL THEN
    IF v_application.photo_object_key !~* (
      '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
      '\.(jpg|png|webp)$'
    ) OR EXISTS (
      SELECT 1
      FROM public.applications AS other_application
      WHERE other_application.id <> v_application.id
        AND other_application.photo_object_key = v_application.photo_object_key
    ) THEN
      RAISE EXCEPTION 'application_erasure_photo_not_exclusive'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_erasure_write_leases.application_id = p_application_id
    AND expires_at <= now();
  IF EXISTS (
    SELECT 1
    FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = p_application_id
      AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM public.application_erasure_jobs
  WHERE application_erasure_jobs.application_id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.application_erasure_jobs (
      application_id, deleted_by, status
    )
    VALUES (p_application_id, p_deleted_by, 'storage_pending')
    RETURNING * INTO v_job;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
  INTO v_keys
  FROM (
    SELECT v_application.photo_object_key AS key
  ) AS referenced_keys
  WHERE key IS NOT NULL
    AND btrim(key) <> ''
    AND public.is_application_erasure_object_key(p_application_id, key);

  RETURN QUERY
  SELECT v_job.id, p_application_id, v_job.status, v_keys;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_application_erasure(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.complete_application_erasure(uuid, text[]);

CREATE FUNCTION public.complete_application_erasure(
  p_job_id uuid,
  p_verified_object_keys text[],
  p_actor_id uuid
)
RETURNS TABLE (
  job_id uuid,
  status text,
  deleted_counts jsonb,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.application_erasure_jobs%ROWTYPE;
  v_application public.applications%ROWTYPE;
  v_application_id uuid;
  v_detachment_audits integer := 0;
  v_payments integer := 0;
  v_baselines integer := 0;
  v_audits integer := 0;
  v_agreements integer := 0;
  v_notifications integer := 0;
  v_email_states integer := 0;
  v_issuances integer := 0;
  v_contact_registry integer := 0;
  v_applications integer := 0;
  v_photo_retained boolean := false;
  v_counts jsonb;
  v_completed_at timestamptz;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = p_actor_id
      AND role IN ('admin', 'super_admin')
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'application_erasure_admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT job.application_id INTO v_application_id
  FROM public.application_erasure_jobs AS job
  WHERE job.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_application_id IS NOT NULL THEN
    SELECT * INTO v_application
    FROM public.applications
    WHERE id = v_application_id
    FOR UPDATE;
  END IF;

  SELECT * INTO v_job
  FROM public.application_erasure_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status = 'completed' THEN
    RETURN QUERY
    SELECT v_job.id, v_job.status, v_job.deleted_counts, v_job.completed_at;
    RETURN;
  END IF;
  IF v_job.application_id IS NULL
     OR v_job.application_id IS DISTINCT FROM v_application_id
     OR v_application.id IS DISTINCT FROM v_application_id THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified'
      USING ERRCODE = '55000';
  END IF;
  IF v_job.object_keys IS DISTINCT FROM to_jsonb(
    COALESCE(
      (
        SELECT array_agg(DISTINCT key ORDER BY key)
        FROM unnest(COALESCE(p_verified_object_keys, ARRAY[]::text[])) AS verified(key)
      ),
      ARRAY[]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = v_application.id
      AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.application_erasure_worker', 'on', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.official_document_issuances AS issuance
    WHERE issuance.snapshot #>> '{application,photo_object_key}'
      = v_application.photo_object_key
  )
  INTO v_photo_retained;

  INSERT INTO public.application_payment_audit (
    application_id,
    application_reference,
    payment_id,
    action,
    changed_by,
    before_data,
    after_data
  )
  SELECT payment.application_id,
         payment.application_reference,
         payment.id,
         'updated',
         v_job.deleted_by,
         to_jsonb(payment),
         to_jsonb(payment) || jsonb_build_object('application_id', NULL)
  FROM public.application_payments AS payment
  WHERE payment.application_id = v_application.id;
  GET DIAGNOSTICS v_detachment_audits = ROW_COUNT;

  UPDATE public.application_payments
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  UPDATE public.application_payment_historical_baseline
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_baselines = ROW_COUNT;

  UPDATE public.application_fee_agreements
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_agreements = ROW_COUNT;

  SELECT count(*) INTO v_audits
  FROM public.application_payment_audit
  WHERE application_id = v_application.id
     OR payment_id IN (
       SELECT id
       FROM public.application_payments
       WHERE application_reference = v_application.application_reference
     );
  v_audits := v_audits + v_detachment_audits;

  DELETE FROM public.application_notifications
  WHERE application_id = v_application.id
    AND notification_type <> 'student_payment_update';
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.official_approval_email_state
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_email_states = ROW_COUNT;

  UPDATE public.official_document_issuances
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_issuances = ROW_COUNT;

  DELETE FROM public.application_contact_registry
  WHERE source_table = 'applications'
    AND source_id = v_application.id;
  GET DIAGNOSTICS v_contact_registry = ROW_COUNT;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_id = v_application.id;
  DELETE FROM public.applications
  WHERE id = v_application.id;
  GET DIAGNOSTICS v_applications = ROW_COUNT;
  IF v_applications <> 1 THEN
    RAISE EXCEPTION 'application_erasure_application_delete_failed'
      USING ERRCODE = '40001';
  END IF;

  v_counts := jsonb_build_object(
    'applications', v_applications,
    'application_contact_registry', v_contact_registry,
    'payments_preserved', v_payments,
    'payment_baselines_preserved', v_baselines,
    'payment_audit_preserved', v_audits,
    'fee_agreements_preserved', v_agreements,
    'notifications_deleted', v_notifications,
    'approval_email_state_deleted', v_email_states,
    'official_document_issuances_preserved', v_issuances,
    'application_photo_retained_for_official_history',
      COALESCE(v_photo_retained, false)
  );
  v_completed_at := now();

  UPDATE public.application_erasure_jobs
  SET application_id = NULL,
      object_keys = '[]'::jsonb,
      status = 'completed',
      deleted_counts = v_counts,
      deleted_object_count = jsonb_array_length(v_job.object_keys),
      last_error_code = NULL,
      completed_at = v_completed_at,
      updated_at = v_completed_at
  WHERE id = p_job_id;

  RETURN QUERY
  SELECT p_job_id, 'completed'::text, v_counts, v_completed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.begin_application_erasure(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.begin_application_erasure(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_application_erasure(uuid, text[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_application_erasure(uuid, text[], uuid)
  TO service_role;

COMMIT;
