import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleApiRequest } from '../worker-api';

const APPLICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTH_HEADERS = { Authorization: 'Bearer test-session' };
const ERASURE_OBJECT_KEYS = [
  'applications/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg',
];
const RETAINED_FINANCIAL_OBJECT_KEYS = [
  `official-documents/${APPLICATION_ID}.pdf`,
  `official-documents/${APPLICATION_ID}/v1-11111111-1111-4111-8111-111111111111.pdf`,
  `official-documents/${APPLICATION_ID}/v2-22222222-2222-4222-8222-222222222222.pdf`,
  `official-documents/${APPLICATION_ID}/receipt-v2-33333333-3333-4333-8333-333333333333.pdf`,
  `official-documents/${APPLICATION_ID}/receipt-v2-44444444-4444-4444-8444-444444444444.pdf`,
];

type Options = {
  role?: 'staff' | 'admin' | 'super_admin';
  missing?: boolean;
  sharedPhoto?: boolean;
  photoRetainedForOfficialHistory?: boolean;
  databaseRoleRejected?: boolean;
  deleteFailures?: number;
  finalizeFailures?: number;
};

const makeRequest = (
  path: string,
  method = 'DELETE',
  body?: Record<string, unknown>,
  headers: Record<string, string> = AUTH_HEADERS,
) => new Request(`https://academy.example${path}`, {
  method,
  headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const setup = (options: Options = {}) => {
  const savedObjects = new Set([...ERASURE_OBJECT_KEYS, ...RETAINED_FINANCIAL_OBJECT_KEYS, 'official-document-assets/shared-logo.png']);
  const deletedObjects: string[] = [];
  const rpcCalls: string[] = [];
  let listCalls = 0;
  let applicationExists = !options.missing;
  let jobStatus = 'storage_pending';
  let objectKeys = options.photoRetainedForOfficialHistory ? [] : [...ERASURE_OBJECT_KEYS];
  let deleteFailures = options.deleteFailures || 0;
  let finalizeFailures = options.finalizeFailures || 0;
  const bucket = {
    put: async () => undefined,
    get: async (key: string) => savedObjects.has(key) ? { body: new Response('private').body } : null,
    delete: async (key: string) => {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        throw new Error('test storage failure');
      }
      deletedObjects.push(key);
      savedObjects.delete(key);
    },
    list: async ({ prefix }: { prefix?: string }) => {
      listCalls += 1;
      return {
        objects: [...savedObjects]
          .filter((key) => key.startsWith(prefix || ''))
          .map((key) => ({ key })),
      };
    },
  };
  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    APPLICATION_MEDIA: bucket,
  };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: ADMIN_ID,
        full_name: 'Test Admin',
        role: options.role || 'admin',
        is_active: true,
      }]);
    }
    if (!url.pathname.startsWith('/rest/v1/rpc/')) {
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    }
    const rpc = url.pathname.slice('/rest/v1/rpc/'.length);
    rpcCalls.push(rpc);
    const args = await request.json() as Record<string, unknown>;

    if (rpc === 'begin_application_erasure') {
      assert.equal(args.p_application_id, APPLICATION_ID);
      assert.equal(args.p_deleted_by, ADMIN_ID);
      if (options.databaseRoleRejected) {
        return Response.json({ code: '42501', message: 'application_erasure_admin_required' }, { status: 400 });
      }
      if (options.sharedPhoto) {
        return Response.json({ code: '55000', message: 'application_erasure_photo_not_exclusive' }, { status: 400 });
      }
      if (!applicationExists) return Response.json([]);
      return Response.json([{
        job_id: JOB_ID,
        application_id: APPLICATION_ID,
        status: jobStatus,
        object_keys: objectKeys,
      }]);
    }
    if (rpc === 'record_application_erasure_objects') {
      objectKeys = args.p_object_keys as string[];
      return Response.json([{
        job_id: JOB_ID,
        application_id: APPLICATION_ID,
        status: 'storage_pending',
        object_keys: objectKeys,
      }]);
    }
    if (rpc === 'fail_application_erasure') {
      jobStatus = String(args.p_status);
      return Response.json(true);
    }
    if (rpc === 'complete_application_erasure') {
      assert.deepEqual(args.p_verified_object_keys, objectKeys);
      assert.equal(args.p_actor_id, ADMIN_ID);
      if (finalizeFailures > 0) {
        finalizeFailures -= 1;
        return Response.json({ code: 'XX000', message: 'test transaction failure' }, { status: 500 });
      }
      applicationExists = false;
      jobStatus = 'completed';
      objectKeys = [];
      return Response.json([{
        job_id: JOB_ID,
        status: 'completed',
        deleted_counts: {
          applications: 1,
          application_contact_registry: 1,
          payments_preserved: 2,
          payment_audit_preserved: 3,
          payment_baselines_preserved: 2,
          fee_agreements_preserved: 1,
          notifications_deleted: 2,
          approval_email_state_deleted: 1,
          official_document_issuances_preserved: 2,
        },
      }]);
    }
    if (rpc === 'get_application_erasure_job') {
      return Response.json([{
        job_id: JOB_ID,
        status: jobStatus,
        last_error_code: jobStatus === 'completed' ? null : 'storage_cleanup_failed',
      }]);
    }
    throw new Error(`Unexpected RPC: ${rpc}`);
  };

  return { bucket, env, deletedObjects, listCalls, rpcCalls, savedObjects };
};

test('Admin and Super Admin erase application data while retaining payments, receipts, and all official documents', async () => {
  for (const role of ['admin', 'super_admin'] as const) {
    const state = setup({ role });
    const response = await handleApiRequest(
      makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
      state.env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; deleted_counts: Record<string, number> };
    assert.equal(body.status, 'completed');
    assert.equal(body.deleted_counts.applications, 1);
    assert.equal(body.deleted_counts.application_contact_registry, 1);
    assert.equal(body.deleted_counts.payments_preserved, 2);
    assert.equal(body.deleted_counts.payment_audit_preserved, 3);
    assert.equal(body.deleted_counts.payment_baselines_preserved, 2);
    assert.equal(body.deleted_counts.fee_agreements_preserved, 1);
    assert.equal(body.deleted_counts.official_document_issuances_preserved, 2);
    assert.deepEqual(state.deletedObjects.sort(), [...ERASURE_OBJECT_KEYS].sort());
    for (const key of RETAINED_FINANCIAL_OBJECT_KEYS) assert.ok(state.savedObjects.has(key), key);
    assert.equal(state.listCalls, 0);
    assert.ok(state.savedObjects.has('official-document-assets/shared-logo.png'));
  }
});

test('Staff, unauthenticated callers, invalid IDs, and missing confirmation cannot start deletion', async () => {
  const staff = setup({ role: 'staff' });
  const forbidden = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    staff.env,
  );
  assert.equal(forbidden.status, 403);
  assert.deepEqual(staff.rpcCalls, []);

  const unauthenticated = setup();
  const unauthorized = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }, {}),
    unauthenticated.env,
  );
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthenticated.rpcCalls, []);

  const input = setup();
  const invalid = await handleApiRequest(
    makeRequest('/api/admin/applications/not-a-uuid', 'DELETE', { confirmation: 'DELETE' }),
    input.env,
  );
  const unconfirmed = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'delete' }),
    input.env,
  );
  assert.equal(invalid.status, 400);
  assert.equal(unconfirmed.status, 400);
  assert.deepEqual(input.rpcCalls, []);
});

test('database rejects non-admin actors and retired archive/policy routes are unavailable', async () => {
  const rejected = setup({ databaseRoleRejected: true });
  const forbidden = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    rejected.env,
  );
  assert.equal(forbidden.status, 403);
  assert.deepEqual(rejected.deletedObjects, []);

  for (const [path, method] of [
    [`/api/admin/applications/${APPLICATION_ID}/archive`, 'POST'],
    [`/api/admin/applications/${APPLICATION_ID}/restore`, 'POST'],
    ['/api/admin/application-erasure-policy', 'GET'],
  ] as const) {
    const response = await handleApiRequest(
      makeRequest(path, method),
      rejected.env,
    );
    assert.equal(response.status, 404, path);
  }
});

test('missing applications return 404 and deletion does not consult the retired approval policy', async () => {
  const missing = setup({ missing: true });
  assert.equal((await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    missing.env,
  )).status, 404);

  const state = setup();
  const deleted = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json() as { status: string }).status, 'completed');
  assert.ok(!state.rpcCalls.includes('application_erasure_document_preservation_ready'));
  assert.ok(!state.rpcCalls.some((rpc) => rpc.includes('policy')));
});

test('shared application photos block erasure before storage or database deletion', async () => {
  const state = setup({ sharedPhoto: true });
  const response = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /cannot be verified as exclusive/);
  assert.deepEqual(state.deletedObjects, []);
  assert.ok(!state.rpcCalls.includes('complete_application_erasure'));
});

test('issued document photo references are preserved while application deletion completes', async () => {
  const state = setup({ photoRetainedForOfficialHistory: true });
  const response = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, 'completed');
  assert.deepEqual(state.deletedObjects, []);
  assert.ok(state.savedObjects.has(ERASURE_OBJECT_KEYS[0]));
  for (const key of RETAINED_FINANCIAL_OBJECT_KEYS) assert.ok(state.savedObjects.has(key), key);
});

test('partial R2 failure is recorded and repeated requests retry remaining objects', async () => {
  const state = setup({ deleteFailures: 1 });
  const request = makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' });
  const first = await handleApiRequest(request, state.env);
  assert.equal(first.status, 202);
  assert.equal((await first.json() as { status: string }).status, 'storage_failed');
  assert.ok(state.rpcCalls.includes('fail_application_erasure'));
  assert.ok(!state.rpcCalls.includes('complete_application_erasure'));

  const retry = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { status: string }).status, 'completed');
  assert.deepEqual(state.deletedObjects.sort(), [...ERASURE_OBJECT_KEYS].sort());
});

test('database failure rolls back finalization and the same job can retry after storage cleanup', async () => {
  const state = setup({ finalizeFailures: 1 });
  const first = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(first.status, 202);
  assert.equal((await first.json() as { status: string }).status, 'database_failed');
  assert.ok(state.deletedObjects.length > 0);

  const retry = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { status: string }).status, 'completed');
  assert.deepEqual(state.deletedObjects.sort(), [...ERASURE_OBJECT_KEYS].sort());
});

test('completed deletion is idempotent and cleanup status is admin-only', async () => {
  const state = setup();
  await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  const duplicate = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(duplicate.status, 404);

  const status = await handleApiRequest(
    makeRequest(`/api/admin/application-erasure-jobs/${JOB_ID}`, 'GET'),
    state.env,
  );
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { status: string }).status, 'completed');
});

test('forward migration deletes only reviewed dependencies, retains a PII-minimal audit, and gates legal approval', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000002_tracked_application_erasure.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'application_notifications',
    'official_approval_email_state',
    'application_fee_agreements',
    'application_payment_historical_baseline',
    'official_document_issuances',
    'application_payment_audit',
    'application_payments',
    'applications',
  ]) {
    assert.match(migration, new RegExp(`DELETE FROM public\\.${table}`, 'i'));
  }
  assert.match(migration, /enabled boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /storage_retention_verified boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /external_retention_verified boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /application_erasure_policy_not_approved/i);
  assert.match(migration, /application_erasure_jobs_one_active_per_application/i);
  assert.match(migration, /application_erasure_in_progress/i);
  assert.match(migration, /application_erasure_write_leases/i);
  assert.match(migration, /application\.photo_object_key = p_object_key/i);
  assert.match(migration, /other_issuance\.snapshot #>> '\{application,photo_object_key\}' = p_object_key/i);
  assert.match(migration, /other_issuance\.pdf_object_key = p_object_key/i);
  assert.match(migration, /application_erasure_photo_not_exclusive/i);
  assert.match(migration, /application_erasure_dependency_conflict/i);
  assert.match(migration, /payment\.application_id IS DISTINCT FROM v_application\.id/i);
  assert.match(migration, /notification\.application_id IS DISTINCT FROM v_application\.id/i);
  assert.match(migration, /object_keys = '\[\]'::jsonb/i);
  assert.match(migration, /deleted_counts jsonb/i);
  assert.match(migration, /unreviewed foreign keys to applications/i);
  assert.match(migration, /unreviewed foreign keys to application_payments/i);
  assert.match(migration, /DROP FUNCTION public\.delete_application_preserving_history\(uuid\)/i);
  assert.doesNotMatch(migration, /CASCADE/i);
});

test('separation migration unlinks and preserves financial rows, receipt files, and payment document history', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000003_separate_application_and_payment_retention.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /application_payments_application_id_retained_fk[\s\S]*ON DELETE SET NULL/i);
  assert.match(migration, /application_fee_agreements_application_id_retained_fk[\s\S]*ON DELETE SET NULL/i);
  assert.match(migration, /application_payment_historical_baseline_application_id_retained_fk[\s\S]*ON DELETE SET NULL/i);
  assert.match(migration, /application_notifications_application_id_retained_fk[\s\S]*ON DELETE SET NULL/i);
  assert.match(migration, /receipt_object_key text/i);
  assert.match(migration, /payments_preserved/);
  assert.match(migration, /payment_audit_preserved/);
  assert.match(migration, /payment_baselines_preserved/);
  assert.match(migration, /issuance\.issuance_type = 'approval'/);
  assert.match(migration, /notification_type <> 'student_payment_update'/);
  const erasureFinalizer = migration.match(
    /CREATE OR REPLACE FUNCTION public\.complete_application_erasure\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(erasureFinalizer);
  assert.doesNotMatch(erasureFinalizer, /DELETE FROM public\.(application_payments|application_payment_audit|application_payment_historical_baseline|application_fee_agreements)/i);
  assert.doesNotMatch(migration, /receipt-v2-[^']*FROM public\.application_payments/i);
});

test('new admission snapshots omit fee and payment values', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000003_separate_application_and_payment_retention.sql', import.meta.url),
    'utf8',
  );
  const snapshotBuilder = migration.match(
    /CREATE OR REPLACE FUNCTION public\.build_official_document_snapshot\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(snapshotBuilder);
  assert.doesNotMatch(snapshotBuilder, /'fee'|'payment_summary'|'payments'|'total_paid'|'final_payable'/i);
});

test('official-document preservation migration detaches issuances and inventories only an unreferenced application photo', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000004_preserve_official_documents_during_erasure.sql', import.meta.url),
    'utf8',
  );
  const erasureFinalizer = migration.match(
    /CREATE OR REPLACE FUNCTION public\.complete_application_erasure\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const erasureStarter = migration.match(
    /CREATE OR REPLACE FUNCTION public\.begin_application_erasure\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(erasureFinalizer);
  assert.ok(erasureStarter);
  assert.match(migration, /official_document_issuances_application_id_retained_fk[\s\S]*ON DELETE SET NULL/i);
  assert.match(migration, /status <> 'completed'[\s\S]*Resolve active application-erasure jobs/i);
  assert.match(migration, /issuance\.snapshot #>> '\{application,photo_object_key\}' = p_object_key/i);
  assert.match(erasureStarter, /photo_object_key !~\*[\s\S]*application_erasure_photo_not_exclusive/i);
  assert.match(erasureStarter, /SELECT v_application\.photo_object_key AS key/i);
  assert.doesNotMatch(erasureStarter, /SELECT issuance\.pdf_object_key/i);
  assert.match(erasureFinalizer, /UPDATE public\.official_document_issuances\s+SET application_id = NULL/i);
  assert.match(erasureFinalizer, /official_document_issuances_preserved/i);
  assert.doesNotMatch(erasureFinalizer, /DELETE FROM public\.official_document_issuances/i);
  assert.doesNotMatch(erasureFinalizer, /DELETE FROM public\.(application_payments|application_payment_audit|application_payment_historical_baseline|application_fee_agreements)/i);
  assert.match(migration, /application_erasure_document_preservation_ready[\s\S]*SELECT true/i);
});

test('payment-update snapshots remain separate from payment-free admission snapshots', () => {
  const admissionMigration = readFileSync(
    new URL('../supabase/migrations/20261102000003_separate_application_and_payment_retention.sql', import.meta.url),
    'utf8',
  );
  const paymentMigration = readFileSync(
    new URL('../supabase/migrations/20261031000005_payment_document_audit_recovery.sql', import.meta.url),
    'utf8',
  );
  const admissionBuilder = admissionMigration.match(
    /CREATE OR REPLACE FUNCTION public\.build_official_document_snapshot\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const paymentBuilder = paymentMigration.match(
    /CREATE OR REPLACE FUNCTION public\.build_official_document_snapshot_for_payment_event\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const paymentEnqueuer = paymentMigration.match(
    /CREATE OR REPLACE FUNCTION public\.enqueue_official_document_payment_version\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(admissionBuilder);
  assert.ok(paymentBuilder);
  assert.ok(paymentEnqueuer);
  assert.doesNotMatch(admissionBuilder, /'fee'|'payment_summary'|'payments'|'total_paid'|'final_payable'/i);
  assert.match(paymentBuilder, /RETURN jsonb_set\([\s\S]*?'\{payment_summary\}'/i);
  assert.match(paymentBuilder, /'total_paid', v_total_paid/i);
  assert.match(paymentEnqueuer, /build_official_document_snapshot_for_payment_event\(/i);
});

test('forward migration removes archive and policy gates while preserving retained records and database authorization', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261105000003_remove_application_archive_and_approval_gate.sql', import.meta.url),
    'utf8',
  );
  const begin = migration.match(
    /CREATE OR REPLACE FUNCTION public\.begin_application_erasure\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const complete = migration.match(
    /CREATE FUNCTION public\.complete_application_erasure\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(begin);
  assert.ok(complete);
  assert.match(migration, /DROP COLUMN IF EXISTS archived_at[\s\S]*DROP COLUMN IF EXISTS archived_by/i);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_prevent_direct_application_archive_changes/i);
  assert.match(migration, /CREATE POLICY "Staff can view applications"[\s\S]*public\.is_admin_or_staff\(\)/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.get_application_erasure_policy_status/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.record_application_erasure_policy/i);
  assert.match(migration, /role IN \('admin', 'super_admin'\)[\s\S]*is_active = true/i);
  assert.match(begin, /application_erasure_dependency_conflict/i);
  assert.match(begin, /application_erasure_photo_not_exclusive/i);
  assert.match(begin, /application_erasure_write_leases/i);
  assert.match(begin, /photo_object_key !~\*/i);
  assert.match(begin, /is_application_erasure_object_key\(p_application_id, key\)/i);
  assert.doesNotMatch(begin, /AND NOT public\.is_application_erasure_object_key/i);
  assert.doesNotMatch(begin, /application_erasure_policy|legal\/accounting|approved_at|retention_verified/i);
  assert.match(complete, /p_actor_id uuid/i);
  assert.match(complete, /DELETE FROM public\.application_contact_registry[\s\S]*source_table = 'applications'[\s\S]*source_id = v_application\.id/i);
  assert.match(complete, /UPDATE public\.official_document_issuances[\s\S]*SET application_id = NULL/i);
  assert.match(complete, /payments_preserved|payment_audit_preserved|official_document_issuances_preserved/i);
  assert.doesNotMatch(complete, /DELETE FROM public\.(application_payments|application_payment_audit|application_payment_historical_baseline|application_fee_agreements|official_document_issuances)/i);
  assert.match(migration, /DROP FUNCTION public\.complete_application_erasure\(uuid, text\[\]\)/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.complete_application_erasure\(uuid, text\[\], uuid\)[\s\S]*TO service_role/i);
  assert.doesNotMatch(migration, /DROP TABLE[^;]*(application_erasure_policy|application_erasure_policy_audit)/i);
  assert.doesNotMatch(migration, /UPDATE public\.application_erasure_policy[\s\S]*SET enabled = true/i);
});

test('safe-deletion migration protects foreign-key history and official records', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000001_safe_application_deletion.sql', import.meta.url),
    'utf8',
  );
  const paymentSchema = readFileSync(
    new URL('../supabase/migrations/20261026000000_manual_payment_register.sql', import.meta.url),
    'utf8',
  );
  const issuanceSchema = readFileSync(
    new URL('../supabase/migrations/20261030000007_dynamic_official_documents_and_course_fees.sql', import.meta.url),
    'utf8',
  );

  for (const table of [
    'application_notifications',
    'application_fee_agreements',
    'official_approval_email_state',
    'application_payment_historical_baseline',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /REFERENCES public\.applications\(id\) ON DELETE RESTRICT/i);
  assert.match(migration, /confdeltype = 'c'/i);
  assert.match(paymentSchema, /application_payments[\s\S]*REFERENCES public\.applications\(id\) ON DELETE RESTRICT/i);
  assert.match(paymentSchema, /application_payment_audit[\s\S]*REFERENCES public\.applications\(id\) ON DELETE SET NULL/i);
  assert.match(issuanceSchema, /official_document_issuances[\s\S]*REFERENCES public\.applications\(id\) ON DELETE SET NULL/i);
  assert.match(migration, /snapshot #>> '\{application,photo_object_key\}'/i);
  assert.match(migration, /photo_retained_for_official_history/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_application_preserving_history\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_application_preserving_history\(uuid\)[\s\S]*TO service_role/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(application_payments|application_payment_audit|official_document_issuances)/i);
});

test('lifecycle removal retains notification and business history while dropping obsolete cleanup automation', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261101000007_remove_lifecycle_automation.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /cron\.unschedule\(retention_job_id\)/);
  assert.match(migration, /uptrends-email-notification-retention/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.claim_official_document_issuance/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.reconcile_payment_document_versions/);
  assert.match(migration, /DROP TABLE IF EXISTS public\.application_photo_cleanup_jobs/);
  assert.match(migration, /DROP COLUMN IF EXISTS generation_claim_token/);
  assert.match(migration, /DROP COLUMN IF EXISTS claim_token/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*request_email_notifications/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*official_approval_email_state/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.official_approval_email_state TO service_role/);
  assert.doesNotMatch(migration, /CASCADE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(applications|application_payments|application_payment_audit|certificate_events|official_document_issuances)/i);
});
