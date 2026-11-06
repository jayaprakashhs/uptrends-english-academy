import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isValidIndianMobileNumber, validateDemoClassRequest } from '../demo-class-request';
import { getWhatsAppUrl } from '../src/lib/whatsapp';
import { handleApiRequest } from '../worker-api';

test('builds WhatsApp URLs from Indian and international phone numbers', () => {
  assert.equal(getWhatsAppUrl('+91 (98765) 43210'), 'https://wa.me/919876543210');
  assert.equal(getWhatsAppUrl('98765-43210'), 'https://wa.me/919876543210');
  assert.equal(getWhatsAppUrl('09876543210'), 'https://wa.me/919876543210');
  assert.equal(getWhatsAppUrl('+1 (202) 555-0123'), 'https://wa.me/12025550123');
});

test('does not create WhatsApp URLs for empty or invalid phone numbers', () => {
  assert.equal(getWhatsAppUrl(''), null);
  assert.equal(getWhatsAppUrl('12345'), null);
  assert.equal(getWhatsAppUrl('0000000000'), null);
  assert.equal(getWhatsAppUrl(null), null);
});

const requestBase = {
  full_name: 'Test Applicant',
  mobile: '+91 90000 00000',
  email: 'applicant@example.com',
  qualification_category: 'Student',
  parent_name: 'Parent Name',
  school_or_college_name: 'Test College',
  educational_qualification: 'B.Com',
  date_of_birth: '2000-01-01',
  address: '1 Test Street',
  city: 'Davangere',
  additional_information: '',
};

const submitDemoRequestWithInsertResponse = async (insertResponse: Response) => {
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const logs: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'supabase.example' && url.pathname === '/rest/v1/demo_class_requests') {
      return insertResponse;
    }
    throw new Error(`Unexpected request in demo insert failure test: ${url.hostname}${url.pathname}`);
  };
  console.error = (...values: unknown[]) => logs.push(values.map(String).join(' '));

  try {
    const response = await handleApiRequest(new Request('https://academy.example/api/demo-class-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBase),
    }), {
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    });
    return { response, logs };
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
  }
};

test('validates Indian mobile number formats', () => {
  assert.equal(isValidIndianMobileNumber('+91 90000 00000'), true);
  assert.equal(isValidIndianMobileNumber('09000000000'), true);
  assert.equal(isValidIndianMobileNumber('5000000000'), false);
  assert.equal(isValidIndianMobileNumber('900000000'), false);
});

test('accepts student demo requests with student-specific fields', () => {
  const result = validateDemoClassRequest(requestBase);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.value.qualification_category, 'Student');
    assert.equal(result.value.parent_name, 'Parent Name');
    assert.equal(result.value.school_or_college_name, 'Test College');
  }
});

test('requires only qualification-category-specific fields', () => {
  const graduate = validateDemoClassRequest({
    ...requestBase,
    qualification_category: 'Graduate',
    college_name: 'Graduate College',
  });
  assert.equal(graduate.valid, true);
  if (graduate.valid) {
    assert.equal(graduate.value.college_name, 'Graduate College');
    assert.equal(graduate.value.parent_name, null);
    assert.equal(graduate.value.school_or_college_name, null);
  }

  const working = validateDemoClassRequest({
    ...requestBase,
    qualification_category: 'Working',
    profession: 'Teacher',
  });
  assert.equal(working.valid, true);
  if (working.valid) {
    assert.equal(working.value.profession, 'Teacher');
    assert.equal(working.value.parent_name, null);
  }
});

test('rejects missing conditional data, invalid email, and future dates', () => {
  const missingStudentDetails = validateDemoClassRequest({
    ...requestBase,
    parent_name: '',
  });
  assert.equal(missingStudentDetails.valid, false);

  const invalidEmail = validateDemoClassRequest({
    ...requestBase,
    email: 'invalid-email',
  });
  assert.equal(invalidEmail.valid, false);

  const futureDate = validateDemoClassRequest({
    ...requestBase,
    date_of_birth: '2999-01-01',
  });
  assert.equal(futureDate.valid, false);
});

test('demo booking date field opens its native picker across the input area', async () => {
  const modal = await readFile(new URL('../src/components/DemoClassBookingModal.tsx', import.meta.url), 'utf8');

  assert.match(modal, /const openDatePicker = \(\) => \{[\s\S]*?input\.showPicker\(\)/);
  assert.match(modal, /<input ref=\{dateOfBirthInputRef\} name="date_of_birth" type="date"[\s\S]*?onClick=\{openDatePicker\}[\s\S]*?required max=\{today\}/);
});

test('demo request API validates data before touching storage or database', async () => {
  const response = await handleApiRequest(new Request('https://academy.example/api/demo-class-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBase, mobile: '12345' }),
  }), {});
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /Indian mobile number/);
});

test('demo request admin endpoint remains protected when server credentials are missing', async () => {
  const response = await handleApiRequest(new Request('https://academy.example/api/admin/demo-class-requests'), {});
  assert.equal(response.status, 503);
});

test('Admin Portal loads applications independently and refreshes the open demo list', async () => {
  const adminPortal = await readFile(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8');
  const demoRequests = await readFile(new URL('../src/components/AdminDemoClassRequests.tsx', import.meta.url), 'utf8');

  assert.match(adminPortal, /const loadApplications = async/);
  assert.match(adminPortal, /void loadApplications\(\);[\s\S]*?const headers = getAuthHeaders\(\);[\s\S]*?await Promise\.all/);
  assert.match(adminPortal, /Load 10 more applications/);
  assert.match(adminPortal, /refreshToken=\{demoRefreshToken\}/);
  assert.match(demoRequests, /refreshToken: number/);
  assert.match(demoRequests, /useEffect\(\(\) => \{\s*void loadRequests\(\);\s*\}, \[currentAdmin\.id, refreshToken\]\)/);
});

test('request email outbox migration is private and does not delete request records', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261031000002_request_email_outbox.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /UNIQUE \(request_type, request_id, notification_type\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.request_email_notifications FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.request_email_notifications TO service_role/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(applications|demo_class_requests|callback_requests)/i);
});

test('stores demo requests separately and sends independent applicant and academy emails', async () => {
  const previousFetch = globalThis.fetch;
  const databaseRequests: Array<{ url: string; method: string; body: unknown }> = [];
  const emailMessages: Array<{
    to: string | string[];
    subject: string;
    html: string;
    text: string;
  }> = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://supabase.example/')) {
      if (url.includes('/rpc/check_application_contact_duplicate')) return Response.json(false);
      databaseRequests.push({
        url,
        method: init?.method || 'GET',
        body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
      });
      if (url.includes('/rest/v1/site_branding?')) {
        return Response.json({
          academy_name: "Uptrend's English Academy",
          logo_url: 'https://assets.example/branding/current-logo.png',
          primary_green: '#14532d',
          primary_orange: '#ea580c',
        });
      }
      return Response.json({ id: '550e8400-e29b-41d4-a716-446655440000' }, { status: 201 });
    }
    if (url === 'https://api.resend.com/emails') {
      const email = JSON.parse(String(init?.body)) as {
        to: string | string[];
        subject: string;
        html: string;
        text: string;
      };
      emailMessages.push(email);
      if (emailMessages.length === 1) {
        return Response.json({ message: 'temporary Resend failure' }, { status: 503 });
      }
      return Response.json({ id: `email-${emailMessages.length}` });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const response = await handleApiRequest(new Request('https://academy.example/api/demo-class-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBase),
    }), {
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      RESEND_API_KEY: 'test-resend-key',
      APPLICATION_NOTIFICATION_EMAIL: 'academy@example.com',
      CLOUDFLARE_R2_PUBLIC_URL: 'https://assets.example',
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      success: true,
      message: 'We received your request. If it can be processed, the academy will contact you.',
    });
    const savedRequest = databaseRequests.find(({ url }) => url.includes('/rest/v1/demo_class_requests?'));
    assert.ok(savedRequest);
    assert.equal((savedRequest.body as Record<string, unknown>).status, 'Pending');
    assert.equal('photo_object_key' in (savedRequest.body as Record<string, unknown>), false);
    assert.equal(databaseRequests.some(({ url }) =>
      url.includes('/rest/v1/request_email_notifications?')), false);
    assert.equal(emailMessages.length, 2);
    assert.equal(emailMessages[0].to, 'applicant@example.com');
    assert.equal(emailMessages[1].to, 'academy@example.com');
    assert.equal(databaseRequests.filter(({ url }) => url.includes('/rest/v1/site_branding?')).length, 2);
    for (const email of emailMessages) {
      assert.match(email.html, /src="https:\/\/assets\.example\/branding\/current-logo\.png"/);
      assert.match(email.html, /alt="Uptrend&#39;s English Academy logo"/);
      assert.match(email.html, /Visit the academy website/);
      assert.match(email.html, /ACADEMY NOTIFICATION/);
      assert.doesNotMatch(email.html, /bimi-logo\.svg/);
      assert.match(email.html, /Davangere, Karnataka, India/);
      assert.ok(email.text.length > 0);
    }
    assert.match(emailMessages[0].html, /Free Demo Class Request Received/);
    assert.match(emailMessages[0].html, /Pending/);
    assert.match(emailMessages[0].html, /Test Applicant/);
    assert.match(emailMessages[1].html, /New Free Demo Class Request/);
    assert.match(emailMessages[1].html, /applicant@example\.com/);
    assert.equal(databaseRequests.some(({ url }) => /\/(?:applications|application_notifications)\b/.test(url)), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('demo insert errors log sanitized database diagnostics and preserve the public error response', async () => {
  const result = await submitDemoRequestWithInsertResponse(Response.json({
    code: '23514',
    message: 'new row violates check constraint "demo_class_requests_status_check"',
    column: 'status',
    details: 'Sensitive Applicant Name, 9876543210, applicant@example.com, 2000-01-01, 1 Private Street',
  }, { status: 400 }));

  assert.equal(result.response.status, 500);
  assert.deepEqual(await result.response.json(), {
    error: 'Unable to save the demo class request. Please try again.',
  });
  assert.equal(result.logs.length, 1);
  assert.deepEqual(JSON.parse(result.logs[0]), {
    event: 'demo_class_request_insert_failed',
    operation: 'demo_class_requests.submit',
    error_code: '23514',
    error_category: 'check_violation',
    constraint: 'demo_class_requests_status_check',
    column: 'status',
    insert_error: true,
    missing_inserted_row: true,
  });
  assert.doesNotMatch(result.logs[0], /Sensitive Applicant Name|9876543210|applicant@example\.com|2000-01-01|1 Private Street/);
});

test('demo insert with no returned row logs the PostgREST result without exposing database details', async () => {
  const result = await submitDemoRequestWithInsertResponse(Response.json(null, { status: 201 }));

  assert.equal(result.response.status, 500);
  assert.deepEqual(await result.response.json(), {
    error: 'Unable to save the demo class request. Please try again.',
  });
  assert.equal(result.logs.length, 1);
  const diagnostic = JSON.parse(result.logs[0]);
  assert.equal(diagnostic.event, 'demo_class_request_insert_failed');
  assert.equal(diagnostic.operation, 'demo_class_requests.submit');
  assert.equal(diagnostic.error_code, null);
  assert.equal(diagnostic.error_category, 'missing_inserted_row');
  assert.equal(diagnostic.insert_error, false);
  assert.equal(diagnostic.missing_inserted_row, true);
  assert.doesNotMatch(result.logs[0], /Test Applicant|9876543210|applicant@example\.com|1 Test Street/);
});
