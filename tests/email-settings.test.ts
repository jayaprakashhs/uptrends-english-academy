import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyEmailTemplate,
  DEFAULT_EMAIL_SETTINGS,
  normalizeEmailSettings,
  type EmailSettings,
} from '../email-settings';
import { renderBrandedEmail } from '../email-template';
import { handleApiRequest } from '../worker-api';

test('default email settings normalize into all active notification templates', () => {
  const settings = normalizeEmailSettings(DEFAULT_EMAIL_SETTINGS);
  assert.deepEqual(settings, DEFAULT_EMAIL_SETTINGS);
  assert.deepEqual(Object.keys(settings?.templates || {}).sort(), [
    'admission_approved',
    'application_applicant',
    'application_staff',
    'callback_staff',
    'demo_applicant',
    'demo_staff',
  ]);
});

test('email settings reject unsafe colors, untrusted links, and invalid email addresses', () => {
  const invalidColor = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  invalidColor.branding.accentColor = 'red; background:url(javascript:alert(1))';
  assert.equal(normalizeEmailSettings(invalidColor), null);

  const invalidLogo = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  invalidLogo.branding.logoUrl = 'http://example.com/logo.png';
  assert.equal(normalizeEmailSettings(invalidLogo), null);

  const privateLogo = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  privateLogo.branding.logoUrl = 'https://192.168.1.25/logo.png';
  assert.equal(normalizeEmailSettings(privateLogo), null);

  const invalidButton = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  invalidButton.templates.demo_applicant.buttonUrl = 'javascript:alert(1)';
  assert.equal(normalizeEmailSettings(invalidButton), null);

  const invalidEmail = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  invalidEmail.branding.email = 'not-an-email';
  assert.equal(normalizeEmailSettings(invalidEmail), null);

  const invalidPhotoKey = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  invalidPhotoKey.branding.headerPhotoKey = 'email-assets/../outside.png';
  assert.equal(normalizeEmailSettings(invalidPhotoKey), null);
});

test('template tokens keep dynamic application details and optional buttons in the shared renderer', () => {
  const customized = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  customized.branding.academyName = 'Sample Academy';
  const content = applyEmailTemplate(customized, 'application_applicant', {
    title: 'Untrusted title replaced by configured template',
    greeting: 'Sam Student',
    paragraphs: ['Original intro', 'Existing application status detail.'],
    status: 'Awaiting review',
    actionMessage: 'Original follow up',
    referenceNumber: 'UEA-APP-2026-001',
    details: [
      { label: 'Program', value: 'Spoken English' },
      { label: 'Application Reference', value: 'UEA-APP-2026-001' },
    ],
  });
  const email = renderBrandedEmail(content, {
    ...customized.branding,
  });

  assert.match(email.html, /Application Received/);
  assert.match(email.html, /Thank you for applying to Sample Academy for Spoken English\./);
  assert.match(email.html, /Existing application status detail\./);
  assert.match(email.html, /Our admissions team will review your application/);
  assert.match(email.html, /href="https:\/\/uptrendsenglishacademy\.in\/?"/);
  assert.match(email.html, /Visit Our Website/);
  assert.match(email.text, /Application Reference: UEA-APP-2026-001/);
});

test('all configured notification templates render synthetic details, status, and a branded button', () => {
  const keys: Array<keyof EmailSettings['templates']> = [
    'demo_applicant',
    'demo_staff',
    'application_applicant',
    'application_staff',
    'admission_approved',
    'callback_staff',
  ];
  for (const key of keys) {
    const content = applyEmailTemplate(DEFAULT_EMAIL_SETTINGS, key, {
      title: 'Preview',
      greeting: 'Preview Student',
      paragraphs: ['Preview text'],
      status: key === 'admission_approved' ? 'Approved' : 'Pending',
      details: [
        { label: 'Program', value: 'Spoken English' },
        { label: 'Preferred Time', value: 'Evening' },
        { label: 'Preview Data', value: 'Synthetic sample' },
      ],
    });
    const email = renderBrandedEmail(content, DEFAULT_EMAIL_SETTINGS.branding);
    assert.match(email.html, new RegExp(DEFAULT_EMAIL_SETTINGS.templates[key].heading));
    assert.match(email.html, /Synthetic sample/);
    assert.match(email.html, /CURRENT STATUS/);
    assert.match(email.html, /Visit Our Website/);
    assert.match(email.html, /max-width:620px/);
    assert.match(email.html, /@media only screen and \(max-width:620px\)/);
  }
});

test('draft changes are visible immediately through the same shared renderer used for outgoing email', () => {
  const changed = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  changed.branding.accentColor = '#AA3300';
  changed.templates.demo_applicant.heading = 'Draft Heading';
  changed.templates.demo_applicant.buttonLabel = 'Preview Action';
  const content = applyEmailTemplate(changed, 'demo_applicant', {
    title: 'Original',
    paragraphs: ['Original'],
    status: 'Pending',
  });
  const preview = renderBrandedEmail(content, changed.branding);
  assert.match(preview.html, /Draft Heading/);
  assert.match(preview.html, /background-color:#AA3300/);
  assert.match(preview.html, /Preview Action/);
});

test('renderer safely emits configured branding, footer, and optional button content', () => {
  const email = renderBrandedEmail(
    {
      title: 'Preview',
      button: { label: '<Click>', url: 'https://uptrendsenglishacademy.in', color: '#FF6B00' },
    },
    {
      ...DEFAULT_EMAIL_SETTINGS.branding,
      academyName: 'Sample Academy',
      headerText: 'Header sample',
      footerTagline: 'Footer sample',
      footerBackgroundColor: '#123B78',
      accentColor: '#FF6B00',
      copyright: 'Copyright {{year}} {{academyName}}.',
      disclaimer: 'Automated notice.',
    },
  );
  assert.match(email.html, /Header sample/);
  assert.match(email.html, /Footer sample/);
  assert.match(email.html, /background-color:#123B78/);
  assert.match(email.html, /&lt;Click&gt;/);
  assert.match(email.html, /Copyright 2026 Sample Academy\./);
  assert.match(email.html, /Automated notice\./);
});

test('email settings APIs allow all admin roles to read but reserve writes and reset for Super Admin', async () => {
  const originalFetch = globalThis.fetch;
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let role: 'staff' | 'admin' | 'super_admin' = 'staff';
  let stored: { settings: EmailSettings; updated_at: string; updated_by: string } | null = null;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json({ id: userId, full_name: 'Test Admin', role, is_active: true });
    }
    if (url.pathname === '/rest/v1/site_branding') return Response.json([{ logo_url: 'https://assets.example/logo.png' }]);
    if (url.pathname === '/rest/v1/email_template_settings') {
      if (request.method === 'GET') return Response.json(stored ? [stored] : []);
      if (request.method === 'POST') {
        const body = await request.json() as { settings: EmailSettings };
        stored = {
          settings: body.settings,
          updated_at: '2026-11-06T09:00:00.000Z',
          updated_by: userId,
        };
        return Response.json(stored);
      }
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  };

  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  };
  const send = async (path: string, method = 'GET', body?: unknown) => handleApiRequest(
    new Request(`https://academy.example${path}`, {
      method,
      headers: {
        Authorization: 'Bearer test-admin-token',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );

  try {
    for (const adminRole of ['staff', 'admin'] as const) {
      role = adminRole;
      const readResponse = await send('/api/admin/email-settings');
      assert.equal(readResponse.status, 200);
      const writeResponse = await send('/api/admin/email-settings', 'PUT', {
        settings: DEFAULT_EMAIL_SETTINGS,
      });
      assert.equal(writeResponse.status, 403);
      const resetResponse = await send('/api/admin/email-settings/reset', 'POST');
      assert.equal(resetResponse.status, 403);
    }

    role = 'super_admin';
    const updated = structuredClone(DEFAULT_EMAIL_SETTINGS);
    updated.branding.academyName = 'Updated Academy';
    updated.templates.demo_applicant.heading = 'Updated Demo Heading';
    const saveResponse = await send('/api/admin/email-settings', 'PUT', { settings: updated });
    assert.equal(saveResponse.status, 200);
    const savedBody = await saveResponse.json() as { settings: EmailSettings };
    assert.equal(savedBody.settings.branding.academyName, 'Updated Academy');

    const reloadResponse = await send('/api/admin/email-settings');
    assert.equal(reloadResponse.status, 200);
    const reloadedBody = await reloadResponse.json() as { settings: EmailSettings };
    assert.equal(reloadedBody.settings.templates.demo_applicant.heading, 'Updated Demo Heading');

    const invalidResponse = await send('/api/admin/email-settings', 'PUT', {
      settings: { ...updated, branding: { ...updated.branding, accentColor: 'url(javascript:bad)' } },
    });
    assert.equal(invalidResponse.status, 400);

    const resetResponse = await send('/api/admin/email-settings/reset', 'POST');
    assert.equal(resetResponse.status, 200);
    const resetBody = await resetResponse.json() as { settings: EmailSettings };
    assert.deepEqual(resetBody.settings, DEFAULT_EMAIL_SETTINGS);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('existing callback email uses persisted settings without changing its recipient or subject', async () => {
  const originalFetch = globalThis.fetch;
  const customized = structuredClone(DEFAULT_EMAIL_SETTINGS) as EmailSettings;
  customized.branding.academyName = 'Preview Configured Academy';
  customized.templates.callback_staff.heading = 'Configured Callback Heading';
  customized.templates.callback_staff.message = 'Configured message for {{preferredTime}}.';
  customized.templates.callback_staff.buttonLabel = 'Custom Button';
  customized.branding.headerPhotoKey = 'email-assets/11111111-1111-4111-8111-111111111111.jpg';
  const resendPayloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/callback_requests' && request.method === 'POST') {
      return Response.json({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/site_branding') {
      return Response.json({ academy_name: "Uptrend's English Academy", logo_url: 'https://assets.example/logo.png' });
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/email_template_settings') {
      return Response.json({
        settings: customized,
        updated_at: '2026-11-06T09:00:00.000Z',
        updated_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
    }
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      resendPayloads.push(await request.json() as Record<string, unknown>);
      return Response.json({ id: 'test-message-id' });
    }
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(new Request('https://academy.example/api/callback-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Preview Applicant',
        mobile: '+91 9008000211',
        email: 'preview@example.com',
        program_name: 'Spoken English',
        preferred_contact_time: 'Afternoon',
        message: 'Please call me.',
        consent: true,
      }),
    }), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      RESEND_API_KEY: 'test-resend-key',
      APPLICATION_NOTIFICATION_EMAIL: 'academy@example.com',
      CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
    });

    assert.equal(response.status, 202);
    const resendPayload = resendPayloads[0];
    assert.ok(resendPayload);
    assert.equal(resendPayload.to, 'academy@example.com');
    assert.equal(resendPayload.subject, 'New Callback Request — Preview Applicant (Afternoon)');
    assert.match(String(resendPayload.html), /Configured Callback Heading/);
    assert.match(String(resendPayload.html), /Configured message for afternoon\./);
    assert.match(String(resendPayload.html), /Custom Button/);
    assert.match(String(resendPayload.html), /Preview Applicant/);
    assert.match(String(resendPayload.html), /https:\/\/media\.example\/email-assets\/11111111-1111-4111-8111-111111111111\.jpg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email header photos upload, replace, persist, remove, and enforce Super Admin permissions', async () => {
  const originalFetch = globalThis.fetch;
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const objects = new Map<string, Uint8Array>();
  const deletedKeys: string[] = [];
  let role: 'staff' | 'super_admin' = 'staff';
  let stored: { settings: EmailSettings; updated_at: string; updated_by: string } | null = null;
  let failUpload = false;
  const publicMedia = {
    put: async (key: string, value: Uint8Array) => {
      if (failUpload) throw new Error('test R2 upload failure');
      objects.set(key, new Uint8Array(value));
    },
    get: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) return null;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return {
        body: new Blob([buffer]).stream(),
        httpMetadata: { contentType: 'image/jpeg' },
      };
    },
    delete: async (key: string) => {
      deletedKeys.push(key);
      objects.delete(key);
    },
    list: async () => ({ objects: [] }),
  };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json({ id: userId, full_name: 'Test Admin', role, is_active: true });
    }
    if (url.pathname === '/rest/v1/email_template_settings') {
      if (request.method === 'GET') return Response.json(stored ? [stored] : []);
      if (request.method === 'POST') {
        const body = await request.json() as { settings: EmailSettings };
        stored = {
          settings: body.settings,
          updated_at: '2026-11-06T09:00:00.000Z',
          updated_by: userId,
        };
        return Response.json(stored);
      }
    }
    if (url.pathname === '/rest/v1/site_branding') return Response.json([{ logo_url: '' }]);
    throw new Error(`Unexpected photo settings request: ${url.pathname}`);
  };

  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
    PUBLIC_MEDIA: publicMedia,
  };
  const send = async (path: string, method: string, body?: unknown) => handleApiRequest(
    new Request(`https://academy.example${path}`, {
      method,
      headers: {
        Authorization: 'Bearer test-access-token',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
  const upload = () => send('/api/admin/email-settings/header-photo', 'POST', {
    image_file_base64: 'data:image/jpeg;base64,/9j/2Q==',
  });
  const save = (settings: EmailSettings) => send('/api/admin/email-settings', 'PUT', { settings });

  try {
    role = 'super_admin';
    const invalidType = await send('/api/admin/email-settings/header-photo', 'POST', {
      image_file_base64: 'data:image/gif;base64,R0lGODlh',
    });
    assert.equal(invalidType.status, 400);
    const oversizedImage = await send('/api/admin/email-settings/header-photo', 'POST', {
      image_file_base64: `data:image/jpeg;base64,${'A'.repeat(4 * 1024 * 1024 + 4)}`,
    });
    assert.equal(oversizedImage.status, 400);
    assert.equal(objects.size, 0);

    role = 'staff';
    const deniedUpload = await upload();
    assert.equal(deniedUpload.status, 403);
    assert.equal(objects.size, 0);

    role = 'super_admin';
    const firstUploadResponse = await upload();
    assert.equal(firstUploadResponse.status, 200);
    const firstUpload = await firstUploadResponse.json() as { object_key: string; photo_url: string };
    assert.match(firstUpload.object_key, /^email-assets\/[0-9a-f-]+\.jpg$/i);
    assert.equal(firstUpload.photo_url, `https://media.example/${firstUpload.object_key}`);

    const firstSettings = structuredClone(DEFAULT_EMAIL_SETTINGS);
    firstSettings.branding.headerPhotoKey = firstUpload.object_key;
    assert.equal((await save(firstSettings)).status, 200);
    const persistedResponse = await send('/api/admin/email-settings', 'GET');
    assert.equal(persistedResponse.status, 200);
    const persisted = await persistedResponse.json() as { settings: EmailSettings; header_photo_url: string };
    assert.equal(persisted.settings.branding.headerPhotoKey, firstUpload.object_key);
    assert.equal(persisted.header_photo_url, firstUpload.photo_url);

    const activePhotoDelete = await send(
      `/api/admin/email-settings/header-photo?key=${encodeURIComponent(firstUpload.object_key)}`,
      'DELETE',
    );
    assert.equal(activePhotoDelete.status, 409);

    const secondUploadResponse = await upload();
    const secondUpload = await secondUploadResponse.json() as { object_key: string; photo_url: string };
    assert.equal(secondUploadResponse.status, 200);
    const secondSettings = structuredClone(firstSettings);
    secondSettings.branding.headerPhotoKey = secondUpload.object_key;
    assert.equal((await save(secondSettings)).status, 200);
    assert.equal(objects.has(firstUpload.object_key), false);
    assert.deepEqual(deletedKeys, [firstUpload.object_key]);

    failUpload = true;
    const failedUpload = await upload();
    assert.equal(failedUpload.status, 502);
    const activeAfterFailedUploadResponse = await send('/api/admin/email-settings', 'GET');
    const activeAfterFailedUpload = await activeAfterFailedUploadResponse.json() as { settings: EmailSettings };
    assert.equal(activeAfterFailedUpload.settings.branding.headerPhotoKey, secondUpload.object_key);
    assert.equal(objects.has(secondUpload.object_key), true);
    failUpload = false;

    const removedSettings = structuredClone(secondSettings);
    removedSettings.branding.headerPhotoKey = '';
    assert.equal((await save(removedSettings)).status, 200);
    assert.equal(objects.has(secondUpload.object_key), false);
    const removedResponse = await send('/api/admin/email-settings', 'GET');
    const removed = await removedResponse.json() as { settings: EmailSettings; header_photo_url: string | null };
    assert.equal(removed.settings.branding.headerPhotoKey, '');
    assert.equal(removed.header_photo_url, null);

    const stagedUploadResponse = await upload();
    const stagedUpload = await stagedUploadResponse.json() as { object_key: string };
    const cancelled = await send(
      `/api/admin/email-settings/header-photo?key=${encodeURIComponent(stagedUpload.object_key)}`,
      'DELETE',
    );
    assert.equal(cancelled.status, 200);
    assert.equal(objects.has(stagedUpload.object_key), false);

    assert.equal(objects.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
