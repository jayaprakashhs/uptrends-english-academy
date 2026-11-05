BEGIN;

DO $$
DECLARE
  function_signature text;
  function_oid regprocedure;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.assert_payment_admin(uuid)',
    'public.set_application_agreed_fee(uuid,uuid,numeric,text)',
    'public.create_application_payment(uuid,uuid,numeric,text,text,text,text)',
    'public.create_application_payment_idempotent(uuid,uuid,numeric,text,text,text,text,uuid)',
    'public.update_application_payment(uuid,uuid,numeric,text,text,text,text)',
    'public.delete_application_payment(uuid,uuid)',
    'public.enqueue_official_document_payment_version(uuid,text)',
    'public.build_official_document_snapshot_for_payment_event(uuid,uuid)',
    'public.create_historical_official_document_version_one(uuid)',
    'public.reconcile_payment_document_versions(uuid)',
    'public.snapshot_application_payment_identity()'
  ]
  LOOP
    function_oid := to_regprocedure(function_signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
        function_oid
      );
    ELSE
      RAISE NOTICE 'Skipping absent payment-related function: %', function_signature;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
  table_oid regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'application_payments',
    'application_fee_agreements',
    'application_payment_audit',
    'application_payment_historical_baseline',
    'application_payment_historical_baseline_meta'
  ]
  LOOP
    table_oid := to_regclass(format('public.%I', table_name));
    IF table_oid IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role',
        table_oid
      );
    ELSE
      RAISE NOTICE 'Skipping absent payment-related table: public.%', table_name;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
