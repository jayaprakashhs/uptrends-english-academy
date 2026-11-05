import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeIndianMobileNumber } from '../contact-validation';
import { handleApiRequest } from '../worker-api';

type ContactRecord = { email: string | null; mobile: string };
type ContactRows = Record<'applications' | 'callback_requests' | 'demo_class_requests', ContactRecord[]>;

const env = {
  SUPABASE_URL: 'https://project.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

const callbackRequest = (email?: string, mobile = '9987654321') =>
  new Request('https://academy.example/api/callback-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Applicant',
      mobile,
      ...(email ? { email } : {}),
      preferred_contact_time: 'Morning',
      consent: true,
    }),
  });

const contactRecord = (email: string | null, mobile: string): ContactRecord => ({ email, mobile });

const setupContactBackend = (initialRows: Partial<ContactRows> = {}, options: { rpcUnavailable?: boolean } = {}) => {
  const rows: ContactRows = {
    applications: initialRows.applications || [],
    callback_requests: initialRows.callback_requests || [],
    demo_class_requests: initialRows.demo_class_requests || [],
  };
  let insertedCallbacks = 0;
  const notifications: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);

    if (url.pathname === '/rest/v1/rpc/check_application_contact_duplicate') {
      if (options.rpcUnavailable) {
        return Response.json({ code: '500', message: 'validation unavailable' }, { status: 500 });
      }
      const { p_source_table, p_email, p_mobile } = await request.json() as {
        p_source_table: keyof ContactRows;
        p_email: string | null;
        p_mobile: string | null;
      };
      const duplicate = rows[p_source_table].some((record) =>
        Boolean(p_email && record.email?.trim().toLowerCase() === p_email)
        || Boolean(p_mobile && normalizeIndianMobileNumber(record.mobile) === normalizeIndianMobileNumber(p_mobile)),
      );
      return Response.json(duplicate);
    }

    if (url.pathname === '/rest/v1/request_email_notifications') {
      if (request.method === 'POST') {
        notifications.push(...await request.json() as Array<Record<string, unknown>>);
        return new Response(null, { status: 201 });
      }
      if (request.method === 'PATCH') {
        const notificationId = url.searchParams.get('id')?.replace(/^eq\./, '');
        const updates = await request.json() as Record<string, unknown>;
        const notification = notifications.find((item) => item.id === notificationId);
        if (notification) Object.assign(notification, updates);
        return new Response(null, { status: 204 });
      }
    }

    if (url.pathname === '/rest/v1/callback_requests' && request.method === 'POST') {
      const submitted = await request.json() as ContactRecord;
      const duplicate = rows.callback_requests.some((record) =>
        Boolean(submitted.email && record.email?.trim().toLowerCase() === submitted.email.trim().toLowerCase())
        || normalizeIndianMobileNumber(record.mobile) === normalizeIndianMobileNumber(submitted.mobile),
      );
      if (duplicate) {
        return Response.json({
          code: '23505',
          message: 'duplicate_contact',
          details: 'email_or_mobile',
        }, { status: 409 });
      }
      rows.callback_requests.push(submitted);
      insertedCallbacks += 1;
      return Response.json({ id: '550e8400-e29b-41d4-a716-446655440000' }, { status: 201 });
    }

    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };
  return {
    rows,
    notifications,
    get insertedCallbacks() { return insertedCallbacks; },
    restore: () => { globalThis.fetch = originalFetch; },
  };
};

test('duplicate email is blocked within callback requests', async () => {
  const backend = setupContactBackend({ callback_requests: [contactRecord('student@example.com', '9876543210')] });
  try {
    const response = await handleApiRequest(callbackRequest(' Student@Example.com ', '9123456789'), env);
    assert.equal(response.status, 409);
    assert.match((await response.json() as { error: string }).error, /already exists for this form/i);
    assert.equal(backend.insertedCallbacks, 0);
  } finally {
    backend.restore();
  }
});

test('duplicate mobile is blocked within callback requests after number normalization', async () => {
  const backend = setupContactBackend({ callback_requests: [contactRecord('student@example.com', '+91 98765 43210')] });
  try {
    const response = await handleApiRequest(callbackRequest('new@example.com', '09876543210'), env);
    assert.equal(response.status, 409);
    assert.equal(backend.insertedCallbacks, 0);
  } finally {
    backend.restore();
  }
});

test('the same email and mobile are accepted when present only in another form type', async () => {
  const backend = setupContactBackend({
    applications: [contactRecord('student@example.com', '+91 09876-543210')],
    demo_class_requests: [contactRecord('another@example.com', '9123456789')],
  });
  try {
    const response = await handleApiRequest(callbackRequest(' Student@Example.com ', '0091 09876 543210'), env);
    assert.equal(response.status, 202);
    assert.equal(backend.insertedCallbacks, 1);
    assert.equal(normalizeIndianMobileNumber('09876543210'), '9876543210');
    assert.equal(normalizeIndianMobileNumber('0091 09876 543210'), '9876543210');
    assert.equal(normalizeIndianMobileNumber('abc9876543210'), null);
  } finally {
    backend.restore();
  }
});

test('callback remains saved when Resend delivery fails without creating a retry row', async () => {
  const backend = setupContactBackend();
  try {
    const response = await handleApiRequest(callbackRequest('student@example.com'), env);
    assert.equal(response.status, 202);
    assert.equal((await response.json() as { success: boolean }).success, true);
    assert.equal(backend.insertedCallbacks, 1);
    assert.equal(backend.notifications.length, 0);
  } finally {
    backend.restore();
  }
});

test('duplicate and unique callback contacts receive distinct responses', async () => {
  const duplicateBackend = setupContactBackend({
    callback_requests: [contactRecord('other@example.com', '9876543210')],
  });
  let duplicateResponse: Response;
  try {
    duplicateResponse = await handleApiRequest(callbackRequest('other@example.com', '9998765432'), env);
  } finally {
    duplicateBackend.restore();
  }

  const uniqueBackend = setupContactBackend();
  try {
    const uniqueResponse = await handleApiRequest(callbackRequest('new@example.com', '+91 99876 54321'), env);
    assert.equal(duplicateResponse.status, 409);
    assert.equal(uniqueResponse.status, 202);
    assert.match((await duplicateResponse.json() as { error: string }).error, /already exists for this form/i);
    assert.equal((await uniqueResponse.json() as { success: boolean }).success, true);
  } finally {
    uniqueBackend.restore();
  }
});

test('public contact preflight endpoint is no longer available', async () => {
  const response = await handleApiRequest(new Request('https://academy.example/api/check-application-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@example.com' }),
  }), env);
  assert.equal(response.status, 404);
});

test('contact submissions fail closed when the protected database validation RPC is unavailable', async () => {
  const backend = setupContactBackend({}, { rpcUnavailable: true });
  try {
    const response = await handleApiRequest(callbackRequest('student@example.com'), env);
    assert.equal(response.status, 503);
  } finally {
    backend.restore();
  }
});

test('direct demo and callback submissions cannot bypass same-form duplicate checks', async () => {
  const submissions = [
    {
      path: '/api/demo-class-requests',
      body: {
        full_name: 'Applicant',
        mobile: '9876543210',
        email: 'taken@example.com',
        qualification_category: 'Graduate',
        college_name: 'Example College',
        educational_qualification: 'English',
        date_of_birth: '2000-01-01',
        address: 'Example address',
        city: 'Davangere',
      },
    },
    {
      path: '/api/callback-request',
      body: {
        full_name: 'Applicant',
        mobile: '9876543210',
        email: 'taken@example.com',
        preferred_contact_time: 'Morning',
        consent: true,
      },
    },
  ];
  for (const submission of submissions) {
    const table = submission.path === '/api/demo-class-requests'
      ? 'demo_class_requests'
      : 'callback_requests';
    const backend = setupContactBackend({ [table]: [contactRecord('taken@example.com', '9876543210')] });
    try {
      const response = await handleApiRequest(new Request(`https://academy.example${submission.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.body),
      }), env);
      assert.equal(response.status, 409, submission.path);
      assert.equal(backend.insertedCallbacks, 0);
      assert.match((await response.json() as { error: string }).error, /already exists for this form/i);
    } finally {
      backend.restore();
    }
  }
});

test('concurrent same-form duplicate submissions produce one save and one conflict', async () => {
  const backend = setupContactBackend();
  const request = () => callbackRequest('applicant@example.com', '+91 98765 43210');
  try {
    const responses = await Promise.all([
      handleApiRequest(request(), env),
      handleApiRequest(request(), env),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [202, 409]);
    assert.equal(backend.insertedCallbacks, 1);
  } finally {
    backend.restore();
  }
});

test('contact registry migration keeps normalized per-form uniqueness without deleting records', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261030000006_prevent_duplicate_application_contacts.sql', import.meta.url),
    'utf8',
  );
  const coreSchema = await readFile(
    new URL('../supabase/migrations/001_initial_schema.sql', import.meta.url),
    'utf8',
  );
  const demoSchema = await readFile(
    new URL('../supabase/migrations/20261029000000_demo_class_requests.sql', import.meta.url),
    'utf8',
  );
  const scopeMigration = await readFile(
    new URL('../supabase/migrations/20261031000001_scope_contact_registry_per_form.sql', import.meta.url),
    'utf8',
  );
  const repeatApplicationMigration = await readFile(
    new URL('../supabase/migrations/20261105000002_allow_multiple_applications_per_contact.sql', import.meta.url),
    'utf8',
  );
  const identifierMigration = await readFile(
    new URL('../supabase/migrations/20261030000007_dynamic_official_documents_and_course_fees.sql', import.meta.url),
    'utf8',
  );
  for (const table of ['applications', 'callback_requests']) {
    const definition = coreSchema.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1];
    assert.ok(definition, `${table} schema exists`);
    assert.match(definition, /id UUID PRIMARY KEY/);
    assert.match(definition, /mobile TEXT/);
    assert.match(definition, /email TEXT/);
  }
  assert.match(demoSchema, /CREATE TABLE IF NOT EXISTS demo_class_requests \([\s\S]*?id UUID PRIMARY KEY/);
  assert.match(demoSchema, /CREATE TABLE IF NOT EXISTS demo_class_requests \([\s\S]*?mobile TEXT NOT NULL/);
  assert.match(demoSchema, /CREATE TABLE IF NOT EXISTS demo_class_requests \([\s\S]*?email TEXT NOT NULL/);
  assert.match(migration, /CONSTRAINT application_contact_registry_email_key UNIQUE \(normalized_email\)/);
  assert.match(migration, /CONSTRAINT application_contact_registry_mobile_key UNIQUE \(normalized_mobile\)/);
  assert.equal((migration.match(/CREATE TRIGGER trg_sync_/g) || []).length, 3);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(applications|callback_requests|demo_class_requests)/i);
  assert.match(scopeMigration, /DROP CONSTRAINT IF EXISTS application_contact_registry_email_key/);
  assert.match(scopeMigration, /DROP CONSTRAINT IF EXISTS application_contact_registry_mobile_key/);
  assert.match(scopeMigration, /ON public\.application_contact_registry \(source_table, normalized_email\)/);
  assert.match(scopeMigration, /ON public\.application_contact_registry \(source_table, normalized_mobile\)/);
  assert.match(scopeMigration, /source_table = p_source_table/);
  assert.doesNotMatch(scopeMigration, /DELETE\s+FROM\s+public\.application_contact_registry/i);
  assert.match(repeatApplicationMigration, /WHERE source_table IN \('callback_requests', 'demo_class_requests'\)/);
  assert.match(repeatApplicationMigration, /IF p_source_table = 'applications' THEN\s+RETURN false;/);
  assert.match(repeatApplicationMigration, /GRANT EXECUTE ON FUNCTION public\.check_application_contact_duplicate[\s\S]*TO service_role/);
  assert.doesNotMatch(repeatApplicationMigration, /DELETE\s+FROM\s+public\.(applications|callback_requests|demo_class_requests|application_contact_registry)/i);
  assert.match(identifierMigration, /NEW\.application_reference := public\.next_academy_identifier\('APP', v_year\)/);
  assert.match(identifierMigration, /NEW\.student_id := NULL/);
  assert.match(identifierMigration, /NEW\.student_id := public\.next_academy_identifier\('STU', v_year\)/);
  assert.match(identifierMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_student_id_unique/);
});
