import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker';
import { handleApiRequest } from '../worker-api';

const requestFor = (path: string) => new Request(`https://academy.example${path}`);

function mockR2Bucket(
  options: { putError?: boolean; deleteError?: boolean; deleteFailures?: number; listError?: boolean } = {},
  events: string[] = [],
) {
  const puts: Array<{ key: string; value: ArrayBuffer | ArrayBufferView; options?: { httpMetadata?: { contentType?: string } } }> = [];
  const deletes: string[] = [];
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  let listCount = 0;
  return {
    binding: {
      put: async (key: string, value: ArrayBuffer | ArrayBufferView, putOptions?: { httpMetadata?: { contentType?: string } }) => {
        if (options.putError) throw new Error('mock R2 put failure');
        puts.push({ key, value, options: putOptions });
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        objects.set(key, { bytes: bytes.slice(), contentType: putOptions?.httpMetadata?.contentType });
      },
      delete: async (key: string) => {
        deletes.push(key);
        events.push('r2-delete');
        if (options.deleteError || (options.deleteFailures && deletes.length <= options.deleteFailures)) {
          throw new Error('mock R2 delete failure');
        }
        objects.delete(key);
      },
      get: async (key: string) => {
        const object = objects.get(key);
        if (!object) return null;
        const bytes = object.bytes.slice();
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: object.contentType },
        };
      },
      list: async () => {
        listCount += 1;
        if (options.listError) throw new Error('mock R2 list failure');
        return { objects: [] };
      },
    },
    puts,
    deletes,
    get listCount() { return listCount; },
  };
}

const contactAcknowledgement = {
  success: true,
  message: 'We received your request. If it can be processed, the academy will contact you.',
};

let nextTestApplicationReference = 1;

const jpegDataUrlOfSize = (sizeBytes: number): string => {
  const bytes = new Uint8Array(sizeBytes);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[sizeBytes - 2] = 0xff;
  bytes[sizeBytes - 1] = 0xd9;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
};

const publicContactSubmissions: Array<{
  path: string;
  table: string;
  body: Record<string, unknown>;
}> = [
  {
    path: '/api/apply',
    table: 'applications',
    body: {
      student_name: 'Test Student',
      mobile: '+91 (98765) 43210',
      email: '  STUDENT@EXAMPLE.COM ',
      qualification_category: 'Graduate',
      qualification: 'Graduate',
      college_name: 'Example College',
      parent_phone: 'ignored hidden value',
      parent_email: 'ignored@example.com',
      school_name: 'ignored school',
      occupation: 'ignored occupation',
      place: 'Vijayanagar',
      city: 'Davangere',
      program_name: 'English',
      privacy_consent: true,
      photo_base64: 'data:image/jpeg;base64,/9j/2Q==',
    },
  },
  {
    path: '/api/callback-request',
    table: 'callback_requests',
    body: {
      full_name: 'Test Student',
      mobile: '09876543210',
      email: '  STUDENT@EXAMPLE.COM ',
      preferred_contact_time: 'Morning',
      consent: true,
    },
  },
  {
    path: '/api/demo-class-requests',
    table: 'demo_class_requests',
    body: {
      full_name: 'Test Student',
      mobile: '0091 98765 43210',
      email: '  STUDENT@EXAMPLE.COM ',
      qualification_category: 'Student',
      parent_name: 'Parent Name',
      school_or_college_name: 'Test College',
      educational_qualification: 'B.Com',
      date_of_birth: '2000-01-01',
      address: '1 Test Street',
      city: 'Davangere',
    },
  },
];

async function submitPublicContact(
  path: string,
  body: Record<string, unknown>,
  duplicateCheck: (payload: Record<string, unknown>) => Response | Promise<Response> = () => Response.json(false),
  options: {
    insertDuplicate?: boolean;
    insertFailure?: boolean;
    insertFailureResponse?: { status: number; body: Record<string, unknown> };
    callbackInsertNoRow?: boolean;
    captureErrorLogs?: boolean;
    notificationLogFailure?: boolean;
    cleanupFailure?: boolean;
  } = {},
) {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const applicationMedia = mockR2Bucket({ deleteError: options.cleanupFailure });
  const duplicateCheckPayloads: Array<Record<string, unknown>> = [];
  const errorLogs: string[] = [];
  const insertedRecords: Array<{ path: string; body: Record<string, unknown>; id: string }> = [];
  const applicationReferences: string[] = [];
  const applicationNotifications: Array<Record<string, unknown>> = [];
  const sentEmails: string[] = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      const email = await request.json() as { to: string };
      sentEmails.push(email.to);
      return Response.json({ id: `test-email-${sentEmails.length}` });
    }
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/rest/v1/rpc/acquire_application_erasure_write_lease') {
      return Response.json('test-erasure-lease-id');
    }
    if (url.pathname === '/rest/v1/rpc/release_application_erasure_write_lease') {
      return Response.json(true);
    }
    if (url.pathname === '/rest/v1/rpc/check_application_contact_duplicate') {
      const payload = await request.json() as Record<string, unknown>;
      duplicateCheckPayloads.push(payload);
      return duplicateCheck(payload);
    }
    if (url.pathname === '/rest/v1/application_notifications') {
      if (request.method === 'POST') {
        applicationNotifications.push(...await request.json() as Array<Record<string, unknown>>);
      }
      if (options.notificationLogFailure && request.method === 'POST') {
        return Response.json({ code: 'XX000', message: 'notification log unavailable' }, { status: 500 });
      }
      return new Response(null, { status: request.method === 'POST' ? 201 : 204 });
    }
    if (options.insertFailure && url.pathname === '/rest/v1/callback_requests') {
      const failure = options.insertFailureResponse || {
        status: 500,
        body: { code: 'XX000', message: 'database unavailable' },
      };
      return Response.json(failure.body, { status: failure.status });
    }
    if (options.callbackInsertNoRow && url.pathname === '/rest/v1/callback_requests') {
      return Response.json(null, { status: 201 });
    }
    if (url.pathname.startsWith('/rest/v1/') && request.method === 'POST') {
      if (options.insertDuplicate && url.pathname === '/rest/v1/applications') {
        return Response.json({ code: '23505', message: 'duplicate_contact' }, { status: 409 });
      }
      const record = {
        path: url.pathname,
        body: await request.json() as Record<string, unknown>,
        id: crypto.randomUUID(),
      };
      insertedRecords.push(record);
      if (url.pathname === '/rest/v1/applications') {
        const applicationReference = `UEA-APP-2026-${String(nextTestApplicationReference++).padStart(4, '0')}`;
        applicationReferences.push(applicationReference);
        return Response.json({ application_reference: applicationReference }, { status: 201 });
      }
      if (url.pathname === '/rest/v1/callback_requests') {
        return Response.json({ id: record.id }, { status: 201 });
      }
      if (url.pathname === '/rest/v1/demo_class_requests') {
        return Response.json({ id: record.id }, { status: 201 });
      }
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  if (options.captureErrorLogs) {
    console.error = (...values: unknown[]) => errorLogs.push(values.map(String).join(' '));
  }

  try {
    const response = await handleApiRequest(
      new Request(`https://academy.example${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        RESEND_API_KEY: 'test-resend-key',
        APPLICATION_MEDIA: applicationMedia.binding,
      },
    );
    return { response, duplicateCheckPayloads, insertedRecords, applicationReferences, applicationMedia, applicationNotifications, sentEmails, errorLogs };
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
}

test('branding updates store uploaded image files and persist mapped theme colors', async () => {
  const originalFetch = globalThis.fetch;
  const publicMedia = mockR2Bucket();
  const existingBranding = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    logo_url: 'https://media.example/branding/old-logo.png',
    favicon_url: '/favicon.ico',
    footer_logo_url: null,
    hero_photo_url: 'https://media.example/branding/old-hero.png',
    primary_orange: '#ea580c',
    primary_green: '#16a34a',
  };
  let savedBranding = { ...existingBranding };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    }
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'super_admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/site_branding' && request.method === 'GET') {
      return Response.json([savedBranding]);
    }
    if (url.pathname === '/rest/v1/site_branding' && request.method === 'PATCH') {
      savedBranding = { ...savedBranding, ...await request.json() as typeof savedBranding };
      return Response.json(savedBranding);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request('https://academy.example/api/admin/branding', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-admin-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          logo_file_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S2cAAAAASUVORK5CYII=',
          hero_photo_file_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S2cAAAAASUVORK5CYII=',
          primary_color: '#123456',
          secondary_color: '#654321',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );

    assert.equal(response.status, 200);
    const result = await response.json() as typeof savedBranding;
    assert.match(result.logo_url, /^https:\/\/media\.example\/branding\/.+\.png$/);
    assert.match(result.hero_photo_url || '', /^https:\/\/media\.example\/branding\/.+\.png$/);
    assert.equal(result.primary_orange, '#123456');
    assert.equal(result.primary_green, '#654321');
    assert.equal(publicMedia.puts.length, 2);
    assert.equal(publicMedia.puts[0].options?.httpMetadata?.contentType, 'image/png');
    assert.deepEqual(publicMedia.deletes, ['branding/old-logo.png', 'branding/old-hero.png']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('branding API enforces the 3 MB limit for logos and hero photos', async () => {
  const originalFetch = globalThis.fetch;
  const publicMedia = mockR2Bucket();
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Test Admin', role: 'super_admin', is_active: true }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const oversizedImage = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')}`;
    for (const field of ['logo_file_base64', 'hero_photo_file_base64']) {
      const response = await handleApiRequest(
        new Request('https://academy.example/api/admin/branding', {
          method: 'PUT',
          headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: oversizedImage }),
        }),
        {
          SUPABASE_URL: 'https://project.example',
          SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
          CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
          PUBLIC_MEDIA: publicMedia.binding,
        },
      );
      assert.equal(response.status, 400);
      assert.match((await response.json() as { error: string }).error, /3 MB or smaller/);
    }
    assert.equal(publicMedia.puts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admins can upload and remove the hero photo without gaining access to other branding fields', async () => {
  const originalFetch = globalThis.fetch;
  const publicMedia = mockR2Bucket();
  const existingBranding = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    logo_url: 'https://media.example/branding/site-logo.png',
    hero_photo_url: 'https://media.example/branding/hero-photo.png',
  };
  let savedBranding = { ...existingBranding };
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Test Admin', role: 'admin', is_active: true }]);
    }
    if (url.pathname === '/rest/v1/site_branding' && request.method === 'GET') return Response.json([savedBranding]);
    if (url.pathname === '/rest/v1/site_branding' && request.method === 'PATCH') {
      savedBranding = { ...savedBranding, ...await request.json() as typeof savedBranding };
      return Response.json(savedBranding);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const uploadResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/branding', {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hero_photo_file_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S2cAAAAASUVORK5CYII=',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(uploadResponse.status, 200);
    assert.match(savedBranding.hero_photo_url || '', /^https:\/\/media\.example\/branding\/.+\.png$/);
    assert.equal(savedBranding.logo_url, existingBranding.logo_url);
    const uploadedHeroKey = publicMedia.puts[0].key;
    assert.deepEqual(publicMedia.deletes, ['branding/hero-photo.png']);

    const removeResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/branding', {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ hero_photo_url: null }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );

    assert.equal(removeResponse.status, 200);
    assert.equal(savedBranding.hero_photo_url, null);
    assert.equal(savedBranding.logo_url, existingBranding.logo_url);
    assert.equal(publicMedia.puts.length, 1);
    assert.deepEqual(publicMedia.deletes, ['branding/hero-photo.png', uploadedHeroKey]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admins cannot change logo or theme settings through the branding API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Test Admin', role: 'admin', is_active: true }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request('https://academy.example/api/admin/branding', {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: 'https://media.example/branding/changed-logo.png' }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
    );

    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('staff cannot change hero branding through the admin API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Test Staff', role: 'staff', is_active: true }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request('https://academy.example/api/admin/branding', {
        method: 'PUT',
        headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ hero_photo_url: null }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
    );

    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('demo class request deletion remains available to admin and super admin only', async () => {
  const originalFetch = globalThis.fetch;
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let deletingRole: 'staff' | 'admin' | 'super_admin' = 'staff';
  let deleteCount = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    }
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: deletingRole,
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/demo_class_requests' && request.method === 'DELETE') {
      deleteCount += 1;
      assert.equal(url.searchParams.get('id'), `eq.${requestId}`);
      return Response.json([{ id: requestId }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  };

  try {
    const makeDeleteRequest = () => new Request(`https://academy.example/api/admin/demo-class-requests/${requestId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    deletingRole = 'staff';
    const staffResponse = await handleApiRequest(makeDeleteRequest(), env);
    assert.equal(staffResponse.status, 403);
    assert.equal(deleteCount, 0);

    for (const role of ['admin', 'super_admin'] as const) {
      deletingRole = role;
      const response = await handleApiRequest(makeDeleteRequest(), env);
      assert.equal(response.status, 200, role);
      assert.deepEqual(await response.json(), {
        success: true,
        message: 'Demo class request deleted successfully.',
      });
    }
    assert.equal(deleteCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('staff, admin, and super admin can list and update the same demo request', async () => {
  const originalFetch = globalThis.fetch;
  const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let currentRole: 'staff' | 'admin' | 'super_admin' = 'staff';
  let requestStatus = 'Pending';
  const requestRecord = {
    id: requestId,
    full_name: 'Demo Applicant',
    mobile: '9876543210',
    email: 'demo@example.com',
    qualification_category: 'Student',
    parent_name: 'Parent',
    school_or_college_name: 'College',
    college_name: null,
    profession: null,
    educational_qualification: 'B.Com',
    date_of_birth: '2000-01-01',
    address: 'Davangere',
    city: 'Davangere',
    additional_information: null,
    status: requestStatus,
    created_at: '2026-10-31T10:00:00.000Z',
  };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: currentRole,
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/demo_class_requests' && request.method === 'GET') {
      assert.equal(url.searchParams.get('order'), 'created_at.desc');
      return Response.json([requestRecord]);
    }
    if (url.pathname === '/rest/v1/demo_class_requests' && request.method === 'PATCH') {
      requestStatus = (await request.json() as { status: string }).status;
      return Response.json([{ ...requestRecord, status: requestStatus }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const env = {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    };
    for (const role of ['staff', 'admin', 'super_admin'] as const) {
      currentRole = role;
      const headers = { Authorization: 'Bearer test-admin-token' };
      const listResponse = await handleApiRequest(new Request('https://academy.example/api/admin/demo-class-requests', { headers }), env);
      assert.equal(listResponse.status, 200, role);
      assert.equal((await listResponse.json() as Array<{ id: string }>)[0].id, requestId);

      const updateResponse = await handleApiRequest(new Request(`https://academy.example/api/admin/demo-class-requests/${requestId}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Completed' }),
      }), env);
      assert.equal(updateResponse.status, 200, role);
      assert.equal((await updateResponse.json() as { status: string }).status, 'Completed');
      assert.equal(requestStatus, 'Completed');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callback request deletion is available to staff, admin, and super admin', async () => {
  const originalFetch = globalThis.fetch;
  const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  let deletingRole: 'staff' | 'admin' | 'super_admin' = 'staff';
  let deleteCount = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    }
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: deletingRole,
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/callback_requests' && request.method === 'DELETE') {
      deleteCount += 1;
      assert.equal(url.searchParams.get('id'), `eq.${requestId}`);
      return Response.json([{ id: requestId }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  };

  try {
    const makeDeleteRequest = () => new Request(`https://academy.example/api/admin/callbacks/${requestId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    for (const role of ['staff', 'admin', 'super_admin'] as const) {
      deletingRole = role;
      const response = await handleApiRequest(makeDeleteRequest(), env);
      assert.equal(response.status, 200, role);
      assert.deepEqual(await response.json(), {
        success: true,
        message: 'Callback request deleted successfully.',
      });
    }
    assert.equal(deleteCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('all staff roles read the same newest-first callback records and update shared statuses', async () => {
  const originalFetch = globalThis.fetch;
  let currentRole: 'staff' | 'admin' | 'super_admin' = 'staff';
  let updateCount = 0;
  const callback = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    full_name: 'Test Student',
    mobile: '9876543210',
    email: 'student@example.com',
    program_name: 'General Inquiry',
    preferred_contact_time: 'Morning',
    message: null,
    consent: true,
    status: 'Pending',
    created_at: '2026-10-31T10:00:00.000Z',
  };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: currentRole,
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/callback_requests' && request.method === 'GET') {
      assert.equal(url.searchParams.get('order'), 'created_at.desc');
      return Response.json([callback]);
    }
    if (url.pathname === '/rest/v1/callback_requests' && request.method === 'PATCH') {
      const { status } = await request.json() as { status: string };
      callback.status = status;
      updateCount += 1;
      return Response.json([callback]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  };

  try {
    const statuses = ['Contacted', 'Completed', 'Pending'] as const;
    for (const [index, role] of (['staff', 'admin', 'super_admin'] as const).entries()) {
      currentRole = role;
      const listResponse = await handleApiRequest(new Request('https://academy.example/api/admin/callbacks', {
        headers: { Authorization: 'Bearer test-admin-token' },
      }), env);
      assert.equal(listResponse.status, 200, role);
      assert.deepEqual(await listResponse.json(), [callback], role);

      const updateResponse = await handleApiRequest(new Request(
        `https://academy.example/api/admin/callbacks/${callback.id}`,
        {
          method: 'PUT',
          headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: statuses[index] }),
        },
      ), env);
      assert.equal(updateResponse.status, 200, role);
      assert.equal((await updateResponse.json() as { status: string }).status, statuses[index]);
    }

    const invalidStatusResponse = await handleApiRequest(new Request(
      `https://academy.example/api/admin/callbacks/${callback.id}`,
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'New' }),
      },
    ), env);
    assert.equal(invalidStatusResponse.status, 400);
    assert.equal(updateCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('request email retry endpoint is unavailable', async () => {
  const response = await handleApiRequest(
    new Request('https://academy.example/api/admin/request-email-notifications/cccccccc-cccc-4ccc-8ccc-cccccccccccc/retry', {
      method: 'POST',
    }),
    {},
  );
  assert.equal(response.status, 404);
});

async function withCapturedLogs<T>(run: (logs: string[]) => Promise<T>): Promise<T> {
  const logs: string[] = [];
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = (...values: unknown[]) => logs.push(values.map(String).join(' '));
  console.info = (...values: unknown[]) => logs.push(values.map(String).join(' '));
  try {
    return await run(logs);
  } finally {
    console.error = originalError;
    console.info = originalInfo;
  }
}

async function assertJson503(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);
  return response.json() as Promise<Record<string, unknown>>;
}

async function deleteMediaWithStoredKey(
  storedMediaKey: string,
  options: { deleteError?: boolean } = {},
) {
  const originalFetch = globalThis.fetch;
  let databaseDeleteCount = 0;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket({ deleteError: options.deleteError });

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/media_items') {
      if (request.method === 'DELETE') {
        databaseDeleteCount += 1;
        return Response.json([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]);
      }
      return Response.json([{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        r2_object_key: storedMediaKey,
      }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request('https://academy.example/api/admin/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-session-token' },
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        APPLICATION_MEDIA: applicationMedia.binding,
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    return {
      response,
      databaseDeleteCount,
      applicationDeleteCount: applicationMedia.deletes.length,
      publicDeletes: publicMedia.deletes,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Worker routes public API paths to the API handler', async () => {
  await withCapturedLogs(async () => {
    const response = await worker.fetch(requestFor('/api/programs'), {});
    const body = await assertJson503(response);
    assert.equal(body.error, 'Supabase is not configured.');
  });
});

test('system status returns the expected JSON shape when Supabase bindings are missing', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    const response = await worker.fetch(requestFor('/api/system-status'), {});
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['r2_storage', 'resend', 'server_time', 'supabase']);
    assert.equal(typeof body.server_time, 'string');
    assert.deepEqual(body.supabase, {
      configured: false,
      connected: false,
      error_category: 'missing_configuration',
    });
    return captured;
  });
  assert.ok(logs.some((line) => line.includes('"operation":"system_status.supabase"')));
  const bindingPresence = logs.find((line) => line.includes('"event":"worker_binding_presence"'));
  assert.ok(bindingPresence);
  assert.match(bindingPresence, /"SUPABASE_SERVICE_ROLE_KEY":false/);
  assert.ok(!bindingPresence.includes('test-service-role-key'));
});

test('system status recognizes all documented runtime bindings as configured', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'project.example') {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.hostname === 'api.resend.com') return Response.json({ data: [] });
    throw new Error('Unexpected test request host.');
  };

  try {
    const applicationMedia = mockR2Bucket();
    const publicMedia = mockR2Bucket();
    const logs = await withCapturedLogs(async (captured) => {
      const response = await worker.fetch(requestFor('/api/system-status'), {
        VITE_SUPABASE_URL: 'https://project.example',
        VITE_SUPABASE_ANON_KEY: 'test-public-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        RESEND_API_KEY: 'test-resend-api-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        APPLICATION_MEDIA: applicationMedia.binding,
        PUBLIC_MEDIA: publicMedia.binding,
      });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, {
        configured: boolean;
        connected: boolean;
        error_category: string | null;
      }>;
      for (const service of ['supabase', 'resend', 'r2_storage']) {
        assert.equal(body[service].configured, true, service);
        assert.equal(body[service].connected, true, service);
        assert.equal(body[service].error_category, null, service);
      }
      return captured;
    });
    const bindingPresence = logs.find((line) => line.includes('"event":"worker_binding_presence"'));
    assert.ok(bindingPresence);
    assert.match(bindingPresence, /"SUPABASE_URL":false/);
    assert.match(bindingPresence, /"VITE_SUPABASE_URL":true/);
    assert.match(bindingPresence, /"SUPABASE_SERVICE_ROLE_KEY":true/);
    assert.ok(!bindingPresence.includes('test-service-role-key'));
    assert.match(bindingPresence, /"APPLICATION_MEDIA":true/);
    assert.match(bindingPresence, /"PUBLIC_MEDIA":true/);
    assert.equal(applicationMedia.listCount, 1);
    assert.equal(publicMedia.listCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public Supabase-backed routes return JSON 503 when public bindings are missing', async () => {
  const routes = ['/api/programs', '/api/media', '/api/branding', '/api/faqs', '/api/announcements'];
  await withCapturedLogs(async () => {
    for (const route of routes) {
      const response = await handleApiRequest(requestFor(route), {});
      const body = await assertJson503(response);
      assert.equal(body.error, 'Supabase is not configured.', route);
    }
  });
});

test('obsolete public reviews route is no longer available', async () => {
  const response = await handleApiRequest(requestFor('/api/reviews'), {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'API route not found.' });
});

test('admin routes preserve fail-closed behavior when privileged bindings are missing', async () => {
  const routes = ['/api/admin/programs', '/api/admin/applications', '/api/admin/callbacks'];
  await withCapturedLogs(async () => {
    for (const route of routes) {
      const response = await handleApiRequest(requestFor(route), {});
      const body = await assertJson503(response);
      assert.equal(
        body.error,
        'Admin APIs are unavailable because Supabase service credentials are not configured.',
        route,
      );
    }
  });
});

test('program update accepts the existing PostgreSQL UUID without RFC version or variant bits', async () => {
  const programId = '11111111-1111-1111-1111-111111111103';
  const response = await handleApiRequest(
    new Request(`https://academy.example/api/admin/programs/${programId}`, { method: 'PUT' }),
    {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  );
  assert.equal(response.status, 401);
  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.match(body.error, /^Unauthorized:/);
});

test('program update continues to reject malformed resource IDs', async () => {
  const response = await handleApiRequest(
    new Request('https://academy.example/api/admin/programs/not-a-uuid', { method: 'PUT' }),
    {},
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Resource ID must be a valid UUID.',
  });
});

test('permanent application deletion requires configured authenticated admin access', async () => {
  const response = await handleApiRequest(
    new Request('https://academy.example/api/admin/applications/11111111-1111-1111-1111-111111111103', {
      method: 'DELETE',
    }),
    {},
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Admin APIs are unavailable because Supabase service credentials are not configured.',
  });
});

test('gallery deletion uses only PUBLIC_MEDIA and validates its managed key', async () => {
  const key = 'media/11111111-1111-4111-8111-111111111103.jpg';
  for (const storedKey of [key, `https://media.example/${key}`]) {
    const deleted = await deleteMediaWithStoredKey(storedKey);
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.publicDeletes, [key]);
    assert.equal(deleted.applicationDeleteCount, 0);
    assert.equal(deleted.databaseDeleteCount, 1);
  }

  const malformed = await deleteMediaWithStoredKey('media/../applications/private.jpg');
  assert.equal(malformed.response.status, 500);
  assert.deepEqual(malformed.publicDeletes, []);
  assert.equal(malformed.applicationDeleteCount, 0);
  assert.equal(malformed.databaseDeleteCount, 0);
});

test('gallery deletion retains its record when PUBLIC_MEDIA deletion fails', async () => {
  const deleted = await deleteMediaWithStoredKey(
    'media/11111111-1111-4111-8111-111111111103.jpg',
    { deleteError: true },
  );
  assert.equal(deleted.response.status, 502);
  assert.equal(deleted.publicDeletes.length, 1);
  assert.equal(deleted.applicationDeleteCount, 0);
  assert.equal(deleted.databaseDeleteCount, 0);
});

test('missing public bindings are logged by operation and binding name only', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    await handleApiRequest(requestFor('/api/programs'), {});
    return captured;
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"operation":"public\.programs\.read"/);
  assert.match(logs[0], /"error_category":"missing_configuration"/);
  assert.match(logs[0], /"missing_bindings":\["SUPABASE_URL","VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY"\]/);
});

test('missing public and privileged keys are identified without logging values', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    await handleApiRequest(requestFor('/api/programs'), {
      SUPABASE_URL: 'https://project.example',
    });
    await handleApiRequest(requestFor('/api/admin/programs'), {
      SUPABASE_URL: 'https://project.example',
    });
    return captured;
  });
  assert.equal(logs.length, 2);
  assert.match(logs[0], /"missing_bindings":\["VITE_SUPABASE_ANON_KEY"\]/);
  assert.match(logs[1], /"missing_bindings":\["SUPABASE_SERVICE_ROLE_KEY"\]/);
});

test('system status logs exact missing service bindings without values', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    await handleApiRequest(requestFor('/api/system-status'), {});
    return captured;
  });
  assert.ok(logs.some((line) => line.includes('"operation":"system_status.supabase"')));
  assert.ok(logs.some((line) => line.includes('"operation":"system_status.resend"') && line.includes('"missing_bindings":["RESEND_API_KEY"]')));
  assert.ok(logs.some((line) =>
    line.includes('"operation":"system_status.r2_storage"') &&
    line.includes('"missing_bindings":["APPLICATION_MEDIA","PUBLIC_MEDIA","CLOUDFLARE_R2_PUBLIC_URL"]'),
  ));
  assert.ok(logs.every((line) => !line.includes('secret') && !line.includes('key-value')));
});

test('system status identifies invalid R2 bindings without logging their values', async () => {
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const logs = await withCapturedLogs(async (captured) => {
    const response = await handleApiRequest(requestFor('/api/system-status'), {
      CLOUDFLARE_R2_PUBLIC_URL: 'http://media.example',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
    });
    assert.equal(response.status, 200);
    return captured;
  });
  const r2Diagnostic = logs.find((line) => line.includes('"operation":"system_status.r2_storage"'));
  assert.ok(r2Diagnostic);
  assert.match(r2Diagnostic, /"invalid_bindings":\["CLOUDFLARE_R2_PUBLIC_URL"\]/);
});

test('system status reports native R2 binding access failures safely', async () => {
  const applicationMedia = mockR2Bucket({ listError: true });
  const publicMedia = mockR2Bucket();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'project.example') return Response.json([]);
    if (url.hostname === 'api.resend.com') return Response.json({ data: [] });
    throw new Error('Unexpected test request host.');
  };

  try {
    const response = await handleApiRequest(requestFor('/api/system-status'), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      RESEND_API_KEY: 'test-resend-api-key',
      CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
      ASSETS: { fetch: async () => new Response(null, { status: 200 }) },
    });
    const body = await response.json() as { r2_storage: { configured: boolean; connected: boolean; error_category: string | null } };
    assert.deepEqual(body.r2_storage, {
      configured: true,
      connected: false,
      error_category: 'storage_unreachable',
    });
    assert.equal(applicationMedia.listCount, 1);
    assert.equal(publicMedia.listCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('application and gallery uploads use separate native buckets and content metadata', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const insertedApplications: Record<string, unknown>[] = [];
  const insertedMediaItems: Record<string, unknown>[] = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/rpc/check_application_contact_duplicate') return Response.json(false);
    if (url.pathname === '/rest/v1/applications' && request.method === 'POST') {
      insertedApplications.push(await request.json() as Record<string, unknown>);
      return Response.json({ application_reference: 'UEA-APP-2026-0001' }, { status: 201 });
    }
    if (url.pathname === '/rest/v1/application_notifications' && request.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'GET') {
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'POST') {
      const insertedMedia = await request.json() as Record<string, unknown>;
      insertedMediaItems.push(insertedMedia);
      return Response.json({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ...insertedMedia,
      });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const applicationResponse = await handleApiRequest(
      new Request('https://academy.example/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: 'Test Student',
          mobile: '9876543210',
          email: 'student@example.com',
          qualification_category: 'Graduate',
          qualification: 'Test',
          college_name: 'Test College',
          place: 'Vijayanagar',
          city: 'Davangere',
          program_name: 'English',
          privacy_consent: true,
          photo_base64: 'data:image/jpeg;base64,/9j/2Q==',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        APPLICATION_MEDIA: applicationMedia.binding,
      },
    );
    assert.equal(applicationResponse.status, 202);
    assert.deepEqual(await applicationResponse.json(), {
      success: true,
      message: 'We received your request. If it can be processed, the academy will contact you.',
    });
    assert.equal(applicationMedia.puts.length, 1);
    assert.match(applicationMedia.puts[0].key, /^applications\/[0-9a-f-]+\.jpg$/);
    assert.equal(applicationMedia.puts[0].options?.httpMetadata?.contentType, 'image/jpeg');
    assert.equal(publicMedia.puts.length, 0);
    assert.equal(insertedApplications.length, 1);
    assert.equal(insertedApplications[0].photo_object_key, applicationMedia.puts[0].key);

    const missingAudienceResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-admin-token',
        },
        body: JSON.stringify({
          title: 'Untagged gallery photo',
          media_type: 'photo',
          media_file_base64: 'data:image/jpeg;base64,/9j/2Q==',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(missingAudienceResponse.status, 400);
    assert.equal(publicMedia.puts.length, 0);

    const mediaResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-session-token',
        },
        body: JSON.stringify({
          title: 'Gallery photo',
          media_type: 'photo',
          audience_tag: 'School Students',
          media_file_base64: 'data:image/jpeg;base64,/9j/2Q==',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(mediaResponse.status, 201);
    assert.equal(publicMedia.puts.length, 1);
    assert.match(publicMedia.puts[0].key, /^media\/[0-9a-f-]+\.jpg$/);
    assert.equal(publicMedia.puts[0].options?.httpMetadata?.contentType, 'image/jpeg');
    assert.equal(applicationMedia.puts.length, 1);
    assert.equal(insertedMediaItems.length, 1);
    assert.equal(insertedMediaItems[0].audience_tag, 'School Students');
    assert.equal(insertedMediaItems[0].r2_object_key, publicMedia.puts[0].key);
    assert.equal(insertedMediaItems[0].media_url, `https://media.example/${publicMedia.puts[0].key}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('media display order rejects numbers already assigned to another entry', async () => {
  const originalFetch = globalThis.fetch;
  const publicMedia = mockR2Bucket();
  const currentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const duplicateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const currentItem = {
    id: currentId,
    media_type: 'video',
    title: 'Existing testimonial',
    caption: null,
    r2_object_key: null,
    media_url: null,
    youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    youtube_video_id: 'abcdefghijk',
    cover_image_url: null,
    alt_text: 'Existing testimonial',
    is_published: true,
    display_order: 2,
  };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'GET') {
      if (url.searchParams.get('id') === `eq.${currentId}`) return Response.json([currentItem]);
      return Response.json([{ id: duplicateId, title: 'Existing duplicate title' }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const env = {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
      PUBLIC_MEDIA: publicMedia.binding,
    };
    const createResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'video',
          title: 'New testimonial',
          audience_tag: 'Professionals',
          youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk',
          display_order: 2,
        }),
      }),
      env,
    );
    assert.equal(createResponse.status, 409);
    assert.match((await createResponse.json() as { error: string }).error, /Existing duplicate title/);

    const updateResponse = await handleApiRequest(
      new Request(`https://academy.example/api/admin/media/${currentId}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_order: 3 }),
      }),
      env,
    );
    assert.equal(updateResponse.status, 409);
    assert.match((await updateResponse.json() as { error: string }).error, /already taken by "Existing duplicate title"/i);
    assert.equal(publicMedia.puts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('media updates validate and persist audience tags', async () => {
  const originalFetch = globalThis.fetch;
  const currentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const currentItem = {
    id: currentId,
    media_type: 'photo',
    title: 'Existing gallery photo',
    caption: null,
    r2_object_key: null,
    media_url: 'https://media.example/media/photo.jpg',
    youtube_url: null,
    youtube_video_id: null,
    cover_image_url: null,
    alt_text: 'Existing gallery photo',
    audience_tag: null,
    is_published: true,
    display_order: 2,
  };
  let savedAudience: unknown;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'GET') {
      if (url.searchParams.get('id') === `eq.${currentId}`) return Response.json([currentItem]);
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'PATCH') {
      const updates = await request.json() as Record<string, unknown>;
      savedAudience = updates.audience_tag;
      return Response.json({ ...currentItem, ...updates });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request(`https://academy.example/api/admin/media/${currentId}`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer audience-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audience_tag: 'College Students' }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
      },
    );
    assert.equal(response.status, 200);
    assert.equal(savedAudience, 'College Students');
    assert.equal((await response.json() as { audience_tag: string }).audience_tag, 'College Students');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('native R2 upload failures return errors without persisting application or gallery rows', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket({ putError: true });
  const publicMedia = mockR2Bucket({ putError: true });
  let databaseWriteCount = 0;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/rpc/check_application_contact_duplicate') return Response.json(false);
    if (url.pathname === '/rest/v1/media_items' && request.method === 'GET') return Response.json([]);
    if (request.method === 'POST') {
      databaseWriteCount += 1;
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const image = 'data:image/jpeg;base64,/9j/2Q==';
  try {
    const applicationResponse = await handleApiRequest(
      new Request('https://academy.example/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: 'Test Student',
          mobile: '9876543210',
          email: 'student@example.com',
          qualification_category: 'Graduate',
          qualification: 'Test',
          college_name: 'Test College',
          place: 'Vijayanagar',
          city: 'Davangere',
          program_name: 'English',
          privacy_consent: true,
          photo_base64: image,
        }),
      }),
      { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key', APPLICATION_MEDIA: applicationMedia.binding },
    );
    assert.equal(applicationResponse.status, 502);

    const mediaResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
        body: JSON.stringify({ title: 'Gallery photo', media_type: 'photo', audience_tag: 'College Students', media_file_base64: image }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(mediaResponse.status, 502);
    assert.equal(databaseWriteCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('database write failures clean up uploads from the matching native bucket', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/rpc/check_application_contact_duplicate') return Response.json(false);
    if (url.pathname === '/rest/v1/media_items' && request.method === 'GET') return Response.json([]);
    if (url.pathname === '/rest/v1/applications' && request.method === 'POST') {
      return Response.json({ message: 'mock application insert failure' }, { status: 500 });
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'POST') {
      return Response.json({ message: 'mock media insert failure' }, { status: 500 });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const image = 'data:image/jpeg;base64,/9j/2Q==';
  try {
    const applicationResponse = await handleApiRequest(
      new Request('https://academy.example/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: 'Test Student',
          mobile: '9876543210',
          email: 'student@example.com',
          qualification_category: 'Graduate',
          qualification: 'Test',
          college_name: 'Test College',
          place: 'Vijayanagar',
          city: 'Davangere',
          program_name: 'English',
          privacy_consent: true,
          photo_base64: image,
        }),
      }),
      { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key', APPLICATION_MEDIA: applicationMedia.binding },
    );
    assert.equal(applicationResponse.status, 500);
    assert.equal(applicationMedia.deletes.length, 1);
    assert.match(applicationMedia.deletes[0], /^applications\//);
    assert.equal(publicMedia.deletes.length, 0);

    const mediaResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
        body: JSON.stringify({ title: 'Gallery photo', media_type: 'photo', audience_tag: 'Homemakers', media_file_base64: image }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(mediaResponse.status, 500);
    assert.equal(publicMedia.deletes.length, 1);
    assert.match(publicMedia.deletes[0], /^media\//);
    assert.equal(applicationMedia.deletes.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase client initialization exceptions return safe JSON 503 and safe diagnostics', async () => {
  const publicSecret = 'test-publishable-key-not-for-production';
  const serviceSecret = 'test-service-role-secret-not-for-production';
  const logs = await withCapturedLogs(async (captured) => {
    const publicResponse = await handleApiRequest(requestFor('/api/programs'), {
      SUPABASE_URL: 'not-a-valid-url',
      VITE_SUPABASE_ANON_KEY: publicSecret,
    });
    await assertJson503(publicResponse);

    const adminResponse = await handleApiRequest(requestFor('/api/admin/programs'), {
      SUPABASE_URL: 'not-a-valid-url',
      SUPABASE_SERVICE_ROLE_KEY: serviceSecret,
    });
    await assertJson503(adminResponse);
    return captured;
  });

  assert.equal(logs.length, 2);
  assert.match(logs[0], /"operation":"public\.programs\.read"/);
  assert.match(logs[0], /"error_category":"invalid_configuration"/);
  assert.match(logs[1], /"operation":"admin\.authentication"/);
  assert.match(logs[1], /"error_category":"invalid_configuration"/);
  assert.ok(logs.every((line) => !line.includes(publicSecret) && !line.includes(serviceSecret)));
});

test('payment APIs and payment-backed recovery are unavailable without querying retained records', async () => {
  const paths = [
    ['/api/admin/applications/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/payments', 'GET'],
    ['/api/admin/applications/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/payments', 'POST'],
    ['/api/admin/payments', 'GET'],
    ['/api/admin/payments', 'POST'],
    ['/api/admin/payments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'PUT'],
    ['/api/admin/payments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'DELETE'],
    ['/api/admin/payments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/receipt', 'POST'],
    ['/api/admin/payments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/receipt/file', 'GET'],
    ['/api/admin/payments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/receipt/email', 'POST'],
    ['/api/admin/official-document/historical-recovery', 'POST'],
  ] as const;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    assert.fail(`Unavailable payment API must not make a Supabase request: ${requestUrl}`);
  };

  try {
    for (const [path, method] of paths) {
      const response = await handleApiRequest(
        new Request(`https://academy.example${path}`, { method }),
        {
          SUPABASE_URL: 'https://project.example',
          SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        },
      );
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: 'API route not found.' });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('certificate administration and verification endpoints are unavailable', async () => {
  const paths = [
    ['/api/admin/certificates', 'GET'],
    ['/api/admin/certificates', 'POST'],
    ['/api/admin/certificates/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/email', 'POST'],
    ['/api/certificates/verify?token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GET'],
  ] as const;

  for (const [path, method] of paths) {
    const response = await handleApiRequest(
      new Request(`https://academy.example${path}`, { method }),
      {},
    );
    assert.equal(response.status, 404, path);
  }
});

test('agreed-fee administration API is unavailable', async () => {
  const response = await handleApiRequest(
    new Request('https://academy.example/api/admin/applications/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/fee', {
      method: 'PUT',
    }),
    {},
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'API route not found.' });
});

test('public contact submissions normalize contacts without checking callback/demo duplicates', async () => {
  const sourceTables = {
    '/api/apply': 'applications',
    '/api/demo-class-requests': 'demo_class_requests',
    '/api/callback-request': 'callback_requests',
  } as const;
  for (const submission of publicContactSubmissions) {
    const result = await submitPublicContact(submission.path, submission.body);
    assert.equal(result.response.status, 202, submission.path);
    assert.deepEqual(await result.response.json(), contactAcknowledgement, submission.path);
    assert.equal(result.duplicateCheckPayloads.length, 0, submission.path);
    assert.equal(result.insertedRecords.length, 1, submission.path);
    assert.equal(result.insertedRecords[0].path, `/rest/v1/${submission.table}`, submission.path);
    assert.equal(result.insertedRecords[0].body.email, 'student@example.com', submission.path);
    assert.equal(result.insertedRecords[0].body.mobile, '9876543210', submission.path);
    if (submission.path === '/api/callback-request') {
      assert.equal(result.insertedRecords[0].body.status, 'Pending');
      assert.equal(result.insertedRecords[0].body.full_name, 'Test Student');
      assert.equal(result.insertedRecords[0].body.preferred_contact_time, 'Morning');
      assert.equal(result.insertedRecords[0].body.program_name, 'General Inquiry');
    }
    if (submission.path === '/api/apply') {
      assert.equal(result.insertedRecords[0].body.status, 'Pending');
      assert.equal('archived_at' in result.insertedRecords[0].body, false);
      assert.equal('archived_by' in result.insertedRecords[0].body, false);
    }
  }
});

test('application Worker stores category-specific fields and removes hidden category values', async () => {
  const application = publicContactSubmissions.find(({ path }) => path === '/api/apply');
  assert.ok(application);
  const categoryCases = [
    {
      qualification_category: 'Student',
      qualification: '10th Standard',
      mobile: undefined,
      email: undefined,
      parent_phone: '+91 98765 43210',
      parent_email: ' PARENT@EXAMPLE.COM ',
      school_name: 'Example School',
      college_name: 'hidden college',
      occupation: 'hidden occupation',
    },
    {
      qualification_category: 'Graduate',
      qualification: 'B.Com',
      college_name: 'Example College',
      parent_phone: 'hidden parent phone',
      parent_email: 'hidden@example.com',
      school_name: 'hidden school',
      occupation: 'hidden occupation',
    },
    {
      qualification_category: 'Working',
      qualification: 'Diploma',
      occupation: 'Teacher',
      parent_phone: 'hidden parent phone',
      parent_email: 'hidden@example.com',
      school_name: 'hidden school',
      college_name: 'hidden college',
    },
  ];

  for (const fields of categoryCases) {
    const result = await submitPublicContact(application.path, {
      ...application.body,
      ...fields,
      place: 'Vijayanagar',
      city: 'Davangere',
    });
    assert.equal(result.response.status, 202, fields.qualification_category);
    const saved = result.insertedRecords.find(({ path }) => path === '/rest/v1/applications')?.body;
    assert.ok(saved, fields.qualification_category);
    assert.equal(saved.qualification_category, fields.qualification_category);
    assert.equal(saved.qualification, fields.qualification);
    assert.equal(saved.place, 'Vijayanagar');
    assert.equal(saved.city, 'Davangere');
    if (fields.qualification_category === 'Student') {
      assert.equal(saved.parent_phone, '9876543210');
      assert.equal(saved.parent_email, 'parent@example.com');
      assert.equal(saved.mobile, '9876543210');
      assert.equal(saved.email, 'parent@example.com');
      assert.equal(saved.school_name, 'Example School');
      assert.equal(saved.college_name, null);
      assert.equal(saved.occupation, null);
      assert.equal(result.duplicateCheckPayloads.length, 0);
      assert.equal(result.applicationNotifications.find(({ notification_type }) =>
        notification_type === 'student_confirmation')?.recipient_email, 'parent@example.com');
      assert.ok(result.sentEmails.includes('parent@example.com'));
    } else if (fields.qualification_category === 'Graduate') {
      assert.equal(saved.college_name, 'Example College');
      assert.equal(saved.parent_phone, null);
      assert.equal(saved.parent_email, null);
      assert.equal(saved.school_name, null);
      assert.equal(saved.occupation, null);
    } else {
      assert.equal(saved.occupation, 'Teacher');
      assert.equal(saved.parent_phone, null);
      assert.equal(saved.parent_email, null);
      assert.equal(saved.school_name, null);
      assert.equal(saved.college_name, null);
    }
  }
});

test('Graduate and Working applications still require applicant mobile and email', async () => {
  const application = publicContactSubmissions.find(({ path }) => path === '/api/apply');
  assert.ok(application);
  const cases = [
    { qualification_category: 'Graduate', college_name: 'Example College', qualification: 'B.Com' },
    { qualification_category: 'Working', occupation: 'Teacher', qualification: 'Diploma' },
  ];

  for (const fields of cases) {
    for (const missingContact of ['mobile', 'email'] as const) {
      const body = {
        ...application.body,
        ...fields,
        [missingContact]: undefined,
      };
      const result = await submitPublicContact(application.path, body);
      assert.equal(result.response.status, 400, `${fields.qualification_category} ${missingContact}`);
      assert.match((await result.response.json() as { error: string }).error, /email|mobile/i);
      assert.equal(result.insertedRecords.filter(({ path }) => path === '/rest/v1/applications').length, 0);
      assert.equal(result.applicationMedia.puts.length, 0);
    }
  }
});

test('application Worker rejects invalid category data before database inserts or photo uploads', async () => {
  const application = publicContactSubmissions.find(({ path }) => path === '/api/apply');
  assert.ok(application);
  const invalidCategoryCases = [
    {
      ...application.body,
      qualification_category: 'Other',
    },
    {
      ...application.body,
      qualification_category: 'Student',
      qualification: '',
      parent_phone: '9876543210',
      parent_email: 'parent@example.com',
      school_name: 'Example School',
    },
    {
      ...application.body,
      qualification_category: 'Graduate',
      qualification: '',
      college_name: 'Example College',
    },
    {
      ...application.body,
      qualification_category: 'Working',
      qualification: '',
      occupation: 'Teacher',
    },
    {
      ...application.body,
      qualification_category: 'Student',
      parent_phone: 'invalid',
      parent_email: 'parent@example.com',
      school_name: 'Example School',
    },
    {
      ...application.body,
      qualification_category: 'Student',
      parent_phone: '9876543210',
      parent_email: 'not-an-email',
      school_name: 'Example School',
    },
  ];

  for (const body of invalidCategoryCases) {
    const result = await submitPublicContact(application.path, body);
    assert.equal(result.response.status, 400, String(body.qualification_category));
    const responseBody = await result.response.json() as { error: string };
    assert.match(responseBody.error, /category|qualification|class|parent phone|parent email/i);
    assert.equal(result.insertedRecords.filter(({ path }) => path === '/rest/v1/applications').length, 0);
    assert.equal(result.applicationMedia.puts.length, 0);
  }
});

test('application Worker accepts exactly 300 KiB and rejects one byte over before R2 upload', async () => {
  const submission = publicContactSubmissions.find(({ path }) => path === '/api/apply');
  assert.ok(submission);
  const exactResult = await submitPublicContact(submission.path, {
    ...submission.body,
    photo_base64: jpegDataUrlOfSize(300 * 1024),
    photo_mime_type: 'image/jpeg',
  });
  assert.equal(exactResult.response.status, 202);
  assert.equal(exactResult.applicationMedia.puts.length, 1);
  assert.equal(exactResult.applicationMedia.puts[0].value.byteLength, 300 * 1024);

  const oversizedResult = await submitPublicContact(submission.path, {
    ...submission.body,
    photo_base64: jpegDataUrlOfSize(300 * 1024 + 1),
    photo_mime_type: 'image/jpeg',
  });
  assert.equal(oversizedResult.response.status, 400);
  assert.match((await oversizedResult.response.json() as { error: string }).error, /300 KB limit/i);
  assert.equal(oversizedResult.applicationMedia.puts.length, 0);
  assert.equal(oversizedResult.insertedRecords.length, 0);
});

test('saved application remains successful when notification outbox insertion fails', async () => {
  const submission = publicContactSubmissions.find(({ path }) => path === '/api/apply');
  assert.ok(submission);
  const result = await submitPublicContact(submission.path, submission.body, undefined, { notificationLogFailure: true });
  assert.equal(result.response.status, 202);
  assert.deepEqual(await result.response.json(), contactAcknowledgement);
  assert.equal(result.insertedRecords.filter(({ path }) => path === '/rest/v1/applications').length, 1);
  assert.equal(result.applicationMedia.puts.length, 1);
});

test('callback submission returns an error and does not acknowledge success when database insert fails', async () => {
  const submission = publicContactSubmissions.find(({ path }) => path === '/api/callback-request');
  assert.ok(submission);
  const result = await submitPublicContact(submission.path, submission.body, undefined, {
    insertFailure: true,
    insertFailureResponse: {
      status: 400,
      body: {
        code: '23514',
        message: 'new row violates check constraint "callback_requests_status_check"',
        constraint: 'callback_requests_status_check',
        column: 'status',
        details: 'Sensitive Caller, 9876543210, caller@example.com, private message',
      },
    },
    captureErrorLogs: true,
  });
  assert.equal(result.response.status, 500);
  assert.deepEqual(await result.response.json(), {
    error: 'Failed to record callback request. Please try again.',
  });
  assert.equal(result.insertedRecords.length, 0);
  assert.equal(result.errorLogs.length, 1);
  assert.deepEqual(JSON.parse(result.errorLogs[0]), {
    event: 'callback_request_insert_failed',
    operation: 'callbacks.submit',
    error_code: '23514',
    error_category: 'check_violation',
    constraint: 'callback_requests_status_check',
    column: 'status',
    insert_error: true,
    missing_inserted_row: true,
  });
  assert.doesNotMatch(result.errorLogs[0], /Sensitive Caller|9876543210|caller@example\.com|private message/);
});

test('callback submission logs a missing inserted row without changing the public error response', async () => {
  const submission = publicContactSubmissions.find(({ path }) => path === '/api/callback-request');
  assert.ok(submission);
  const result = await submitPublicContact(submission.path, submission.body, undefined, {
    callbackInsertNoRow: true,
    captureErrorLogs: true,
  });

  assert.equal(result.response.status, 500);
  assert.deepEqual(await result.response.json(), {
    error: 'Failed to record callback request. Please try again.',
  });
  assert.equal(result.errorLogs.length, 1);
  const diagnostic = JSON.parse(result.errorLogs[0]);
  assert.equal(diagnostic.event, 'callback_request_insert_failed');
  assert.equal(diagnostic.operation, 'callbacks.submit');
  assert.equal(diagnostic.error_category, 'missing_inserted_row');
  assert.equal(diagnostic.insert_error, false);
  assert.equal(diagnostic.missing_inserted_row, true);
  assert.doesNotMatch(result.errorLogs[0], /Test Student|9876543210|student@example\.com/);
});

test('callback and demo requests allow repeated contact details as independent records', async () => {
  for (const submission of publicContactSubmissions.filter(({ path }) => path !== '/api/apply')) {
    const repeatedSubmissions = [
      submission.body,
      submission.body,
      { ...submission.body, email: 'different@example.com' },
      { ...submission.body, mobile: '9123456789' },
    ];
    const results = [];
    for (const body of repeatedSubmissions) {
      results.push(await submitPublicContact(submission.path, body, () => Response.json(true)));
    }

    assert.ok(results.every((result) => result.response.status === 202), submission.path);
    assert.ok(results.every((result) => result.duplicateCheckPayloads.length === 0), submission.path);
    assert.ok(results.every((result) => result.insertedRecords.length === 1), submission.path);
    const records = results.map((result) => result.insertedRecords[0]);
    assert.equal(new Set(records.map(({ id }) => id)).size, repeatedSubmissions.length, submission.path);
    assert.equal(records[0].body.email, records[1].body.email, submission.path);
    assert.equal(records[0].body.mobile, records[1].body.mobile, submission.path);
    assert.equal(records[2].body.mobile, records[0].body.mobile, submission.path);
    assert.notEqual(records[2].body.email, records[0].body.email, submission.path);
    assert.equal(records[3].body.email, records[0].body.email, submission.path);
    assert.notEqual(records[3].body.mobile, records[0].body.mobile, submission.path);
  }
});

test('three applications can reuse the same email and mobile with distinct generated IDs', async () => {
  const submission = publicContactSubmissions.find(({ path }) => path === '/api/apply');
  assert.ok(submission);
  const results = [];
  for (let index = 0; index < 3; index += 1) {
    results.push(await submitPublicContact(submission.path, submission.body));
  }
  const inserted = results.map((result) => result.insertedRecords.find(({ path }) => path === '/rest/v1/applications')?.body);
  const applicationIds = inserted.map((application) => application?.id);
  const applicationReferences = results.flatMap((result) => result.applicationReferences);
  assert.ok(results.every((result) => result.response.status === 202));
  assert.ok(inserted.every((application) =>
    application?.email === 'student@example.com'
    && application.mobile === '9876543210'
    && application.status === 'Pending'
    && !('student_id' in application),
  ));
  assert.equal(new Set(applicationIds).size, 3);
  assert.ok(applicationIds.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)));
  assert.equal(new Set(applicationReferences).size, 3);
  assert.equal(applicationReferences.length, 3);
  assert.ok(results.every((result) => result.duplicateCheckPayloads.length === 0));
});

test('callback and demo submissions succeed without depending on the contact-check RPC', async () => {
  for (const submission of publicContactSubmissions.filter(({ path }) => path !== '/api/apply')) {
    const result = await submitPublicContact(submission.path, submission.body, () => {
      throw new Error('Callback/demo submission must not call the duplicate-check RPC.');
    });
    assert.equal(result.response.status, 202, submission.path);
    assert.equal(result.duplicateCheckPayloads.length, 0, submission.path);
    assert.equal(result.insertedRecords.length, 1, submission.path);
  }
});

test('all public contact submissions reject invalid email or mobile before duplicate verification', async () => {
  const invalidSubmissions = publicContactSubmissions.flatMap((submission) => [
    {
      ...submission,
      body: { ...submission.body, email: 'not-an-email' },
    },
    {
      ...submission,
      body: { ...submission.body, mobile: '12345' },
    },
  ]);

  for (const submission of invalidSubmissions) {
    const result = await submitPublicContact(submission.path, submission.body);
    assert.equal(result.response.status, 400, submission.path);
    assert.equal(result.duplicateCheckPayloads.length, 0, submission.path);
    assert.equal(result.insertedRecords.length, 0, submission.path);
    assert.equal(result.applicationMedia.puts.length, 0, submission.path);
  }
});

test('demo-class route allows POST and preserves the same-origin-only API policy', async () => {
  const wrongMethod = await handleApiRequest(
    new Request('https://academy.example/api/demo-class-requests', { method: 'PUT' }),
    {},
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'POST');

  const crossOrigin = await handleApiRequest(
    new Request('https://academy.example/api/demo-class-requests', {
      method: 'POST',
      headers: { Origin: 'https://other.example' },
    }),
    {},
  );
  assert.equal(crossOrigin.status, 403);
});

test('About Us R2 image uploads require an active super admin', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  let role: 'staff' | 'admin' | 'super_admin' = 'admin';
  globalThis.fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (path === '/rest/v1/admin_profiles') {
      return Response.json({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role,
        is_active: true,
      });
    }
    throw new Error(`Unexpected Supabase request: ${path}`);
  };

  try {
    const env = {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
    };
    for (const unauthorizedRole of ['staff', 'admin'] as const) {
      role = unauthorizedRole;
      const unauthorized = await handleApiRequest(new Request('https://academy.example/api/admin/about-us/assets', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-user-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_type: 'instructor', image_file_base64: 'data:image/jpeg;base64,/9j/2Q==' }),
      }), env);
      assert.equal(unauthorized.status, 403, unauthorizedRole);
    }
    assert.equal(applicationMedia.puts.length, 0);
    assert.equal(publicMedia.puts.length, 0);

    role = 'super_admin';
    const upload = await handleApiRequest(new Request('https://academy.example/api/admin/about-us/assets', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_type: 'instructor', image_file_base64: 'data:image/jpeg;base64,/9j/2Q==' }),
    }), env);
    assert.equal(upload.status, 200);
    const body = await upload.json() as { object_key: string; content_type: string; size_bytes: number };
    assert.match(body.object_key, /^about-us\/instructors\/[0-9a-f-]+\.jpg$/i);
    assert.equal(body.content_type, 'image/jpeg');
    assert.equal(body.size_bytes, 4);
    assert.equal(applicationMedia.puts[0].options?.httpMetadata?.contentType, 'image/jpeg');
    assert.equal(publicMedia.puts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public About Us image reads verify a published database reference before reading R2', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const objectKey = 'about-us/instructors/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
  await applicationMedia.binding.put(objectKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await publicMedia.binding.put(objectKey, new Uint8Array([0xff, 0xd8, 0x00, 0xd9]), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  let publishedFilter = false;
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    if (requestUrl.pathname === '/rest/v1/team_members') {
      publishedFilter = requestUrl.searchParams.get('is_published') === 'eq.true'
        && requestUrl.searchParams.get('photo_object_key') === `eq.${objectKey}`;
      return Response.json({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    }
    throw new Error(`Unexpected Supabase request: ${requestUrl.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request(`https://academy.example/api/about-us/assets?key=${encodeURIComponent(objectKey)}`),
      {
        SUPABASE_URL: 'https://project.example',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
        APPLICATION_MEDIA: applicationMedia.binding,
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(publishedFilter, true);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('About Us R2 image deletion refuses objects still referenced by content', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const objectKey = 'about-us/instructors/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    if (requestUrl.pathname === '/auth/v1/user') {
      return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    }
    if (requestUrl.pathname === '/rest/v1/admin_profiles') {
      return Response.json({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'super_admin',
        is_active: true,
      });
    }
    if (requestUrl.pathname === '/rest/v1/team_members') {
      return Response.json([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]);
    }
    if (requestUrl.pathname === '/rest/v1/about_us_video_configurations') return Response.json([]);
    throw new Error(`Unexpected Supabase request: ${requestUrl.pathname}`);
  };

  try {
    const response = await handleApiRequest(new Request(
      `https://academy.example/api/admin/about-us/assets?key=${encodeURIComponent(objectKey)}`,
      { method: 'DELETE', headers: { Authorization: 'Bearer test-user-token' } },
    ), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
    });
    assert.equal(response.status, 409);
    assert.equal(publicMedia.deletes.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('About Us image deletion uses private APPLICATION_MEDIA only', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const objectKey = 'about-us/video-posters/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  globalThis.fetch = async (input) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    if (requestUrl.pathname === '/auth/v1/user') {
      return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    }
    if (requestUrl.pathname === '/rest/v1/admin_profiles') {
      return Response.json({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Super Admin',
        role: 'super_admin',
        is_active: true,
      });
    }
    if (requestUrl.pathname === '/rest/v1/team_members') return Response.json([]);
    if (requestUrl.pathname === '/rest/v1/about_us_video_configurations') return Response.json([]);
    throw new Error(`Unexpected Supabase request: ${requestUrl.pathname}`);
  };

  try {
    const response = await handleApiRequest(new Request(
      `https://academy.example/api/admin/about-us/assets?key=${encodeURIComponent(objectKey)}`,
      { method: 'DELETE', headers: { Authorization: 'Bearer test-user-token' } },
    ), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(applicationMedia.deletes, [objectKey]);
    assert.equal(publicMedia.deletes.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('joining information drafts are writable by all existing application approver roles', async () => {
  const originalFetch = globalThis.fetch;
  const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const roles = ['staff', 'admin', 'super_admin'] as const;
  const joiningInformation = {
    joiningDate: '2026-11-04',
    classSchedule: 'Monday to Saturday',
    classTimings: '8:00 AM – 9:00 AM',
    venue: 'Davanagere Ram & Co Circle',
  };

  try {
    globalThis.fetch = async () => {
      throw new Error('Unauthorized requests must not access Supabase.');
    };
    const unauthorizedResponse = await handleApiRequest(new Request(
      `https://academy.example/api/admin/applications/${applicationId}/joining-information`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joining_information: joiningInformation }),
      },
    ), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    });
    assert.equal(unauthorizedResponse.status, 401);

    for (const role of roles) {
      globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/auth/v1/user') {
          return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
        }
        if (url.pathname === '/rest/v1/admin_profiles') {
          return Response.json([{
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            full_name: 'Test Approver',
            role,
            is_active: true,
          }]);
        }
        if (url.pathname === `/rest/v1/applications` && request.method === 'PATCH') {
          const updates = await request.json() as { joining_information: typeof joiningInformation };
          return Response.json({
            id: applicationId,
            status: 'Pending',
            joining_information: updates.joining_information,
          });
        }
        throw new Error(`Unexpected Supabase request: ${url.pathname}`);
      };

      const response = await handleApiRequest(new Request(
        `https://academy.example/api/admin/applications/${applicationId}/joining-information`,
        {
          method: 'PUT',
          headers: { Authorization: 'Bearer test-joining-information-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ joining_information: joiningInformation }),
        },
      ), {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      });

      assert.equal(response.status, 200, `${role} should retain its existing staff-level application access`);
      assert.deepEqual((await response.json() as { joining_information: unknown }).joining_information, joiningInformation);
    }

    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          full_name: 'Test Staff',
          role: 'staff',
          is_active: true,
        }]);
      }
      if (url.pathname === '/rest/v1/applications') {
        throw new Error('Invalid joining information must not be written.');
      }
      throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    };
    const invalidResponse = await handleApiRequest(new Request(
      `https://academy.example/api/admin/applications/${applicationId}/joining-information`,
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer test-joining-information-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joining_information: { ...joiningInformation, venue: 'To be confirmed' },
        }),
      },
    ), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
