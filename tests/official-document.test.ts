import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  mergeOfficialDocumentSettings,
  generateOfficialPdf,
  type OfficialCourse,
  type OfficialStudent,
} from '../official-document';
import { handleApiRequest } from '../worker-api';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const programId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const photoKey = 'applications/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png';
const pngBytes = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0XQAAAAASUVORK5CYII=', 'base64'),
);

const student: OfficialStudent = {
  fullName: 'Test Learner',
  studentId: 'UEA-STU-2026-0001',
  applicationNumber: 'UEA-APP-2026-0001',
  qualification: 'Graduate',
  programName: 'IELTS Preparation',
  email: 'learner@example.com',
  mobile: '+919876543210',
  dateOfBirth: '2000-01-01',
  address: 'Davangere',
};

const selectedCourse: OfficialCourse = {
  name: 'IELTS Preparation',
  duration: '12 weeks',
  level: 'Intermediate',
};

const decodePdfStreams = (bytes: Uint8Array): string => {
  const source = Buffer.from(bytes).toString('latin1');
  const decodedStreams: string[] = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      decodedStreams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch {
      // Non-Flate streams do not contain the generated page commands.
    }
  }
  return decodedStreams.join('\n');
};

const decodePdfText = (bytes: Uint8Array): string =>
  [...decodePdfStreams(bytes).matchAll(/<([0-9a-f]+)> Tj/gi)]
    .map((text) => Buffer.from(text[1], 'hex').toString('latin1'))
    .join('\n');

const makeWorkerEnv = (overrides: Record<string, unknown> = {}) => ({
  SUPABASE_URL: 'https://project.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  RESEND_API_KEY: 'test-resend-key',
  APPLICATION_MEDIA: {
    get: async (key: string) => {
      if (key !== photoKey) return null;
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(pngBytes);
            controller.close();
          },
        }),
        httpMetadata: { contentType: 'image/png' },
      };
    },
    put: async () => undefined,
    delete: async () => undefined,
    list: async () => ({ objects: [] }),
  },
  ...overrides,
});

const withAdminFetch = async (
  role: 'staff' | 'admin' | 'super_admin',
  handleRestRequest: (request: Request, url: URL) => Promise<Response>,
  run: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'project.example' && url.pathname === '/auth/v1/user') {
      return Response.json({ id: userId });
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: userId,
        full_name: 'Test Admin',
        role,
        is_active: true,
      }]);
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/rpc/acquire_application_erasure_write_lease') {
      return Response.json('test-erasure-lease-id');
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/rpc/release_application_erasure_write_lease') {
      return Response.json(true);
    }
    return handleRestRequest(request, url);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const authorizedRequest = (path: string, method = 'GET', body?: unknown) =>
  new Request(`https://academy.example${path}`, {
    method,
    headers: {
      Authorization: 'Bearer test-admin-token',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('admission approval PDF contains real student details without fee or payment content', async () => {
  const input = {
    settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    },
    student,
    course: selectedCourse,
  };
  const bytes = await generateOfficialPdf(input);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getPages()[0].getWidth(), 595.28);
  assert.equal(pdf.getPages()[0].getHeight(), 841.89);
  const text = decodePdfText(bytes);
  assert.match(text, /ADMISSION CONFIRMATION/);
  assert.match(text, /IELTS Preparation/);
  assert.match(text, /UEA-STU-2026-0001/);
  assert.match(text, /UEA-APP-2026-0001/);
  assert.doesNotMatch(text, /\bfees?\b|FEE BREAKDOWN|Course Fee|Net Payable Amount|TERMS & CONDITIONS|Fictional fee conditions/i);
  assert.doesNotMatch(text, /PAYMENT PENDING|INR 0\.00|Net Payable Amount/);
  assert.doesNotMatch(text, /payment|paid|balance|transaction|INR|PRIVATE-REFERENCE|private-payment-id|upi/i);
  assert.doesNotMatch(text, /Spoken English|Business English|Other Course/);
  assert.doesNotMatch(text, /\b(?:document\s*)?version\s*[:#-]?\s*\d+\b/i);
});

test('official PDF uses branded header and footer and omits a missing-photo placeholder', async () => {
  const bytes = await generateOfficialPdf({
    settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      colors: {
        orange: '#00AA00',
        green: '#00AA00',
        navy: '#00AA00',
        background: '#00AA00',
      },
      layout: {
        ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout,
        showLogo: false,
      },
    },
    student,
    course: selectedCourse,
    assets: { logo: { bytes: pngBytes, mime: 'image/png' } },
  });
  const pdf = await PDFDocument.load(bytes);
  const text = decodePdfText(bytes);
  const source = Buffer.from(bytes).toString('latin1');
  const commands = decodePdfStreams(bytes);

  assert.equal(pdf.getPageCount(), 1);
  assert.match(text, /Uptrend's English Academy/);
  assert.match(text, /DAVANGERE - KARNATAKA/);
  assert.match(text, /https:\/\/uptrendsenglishacademy\.in/);
  assert.match(text, /Page 1 of 1/);
  assert.match(text, /UEA-APP-2026-0001/);
  assert.doesNotMatch(text, /\bPHOTO\b|Best Wishes!|document\s*version/i);
  assert.match(source, /\/Subtype\s*\/Image/);
  assert.match(commands, /0\.07058823529411765 0\.23137254901960785 0\.47058823529411764 rg/);
  assert.match(commands, /1 0\.4196078431372549 0 rg/);
  assert.doesNotMatch(commands, /0 0\.6666666666666666 0 rg/);
});

test('graduate and working PDFs use applicant contacts and never parent contacts', async () => {
  for (const qualificationCategory of ['Graduate', 'Working'] as const) {
    const bytes = await generateOfficialPdf({
      settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      student: {
        ...student,
        qualificationCategory,
        email: `${qualificationCategory.toLowerCase()}@example.com`,
        mobile: '+919876500001',
        parentEmail: 'hidden-parent@example.com',
        parentPhone: 'HIDDEN-PARENT-PHONE',
      },
      course: selectedCourse,
    });
    const text = decodePdfText(bytes);
    assert.match(text, /Mobile Number/);
    assert.match(text, /Email ID/);
    assert.match(text, /\+919876500001/);
    assert.match(text, new RegExp(`${qualificationCategory.toLowerCase()}@example\\.com`));
    assert.doesNotMatch(text, /Parent Phone Number|Parent Email ID|hidden-parent|HIDDEN-PARENT/);
  }
});

test('missing photo and long joining details produce a readable multipage PDF', async () => {
  const longStudent = `${'Long Applicant Name '.repeat(10)}End`;
  const bytes = await generateOfficialPdf({
    settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      joiningInstructions: [`${'Joining instruction '.repeat(140)}Last instruction detail`],
    },
    student: { ...student, fullName: longStudent },
    course: selectedCourse,
  });
  const pdf = await PDFDocument.load(bytes);
  const text = decodePdfText(bytes);
  assert.ok(pdf.getPageCount() > 1);
  assert.match(text, /End/);
  assert.match(text, /Last instruction/);
});

test('legacy fee and payment settings are excluded from admission document settings', () => {
  const legacySettings = mergeOfficialDocumentSettings({
    ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    terms: ['Old fee condition'],
    paymentInstructions: 'Old fee instructions',
    sectionHeadings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings,
      fees: 'Old fee heading',
      payment: 'Old payment heading',
      terms: 'Old terms heading',
    },
    layout: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout,
      visibleSections: ['student', 'fees', 'course', 'terms', 'joining', 'payment'],
      sectionOrder: ['student', 'fees', 'course', 'terms', 'joining', 'payment'],
    },
  });
  assert.ok(legacySettings);
  assert.deepEqual(legacySettings.layout.visibleSections, ['student', 'course', 'joining']);
  assert.deepEqual(legacySettings.layout.sectionOrder, DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout.sectionOrder);
  assert.equal('terms' in legacySettings, false);
  assert.equal('paymentInstructions' in legacySettings, false);
  assert.equal('fees' in legacySettings.sectionHeadings, false);
  assert.equal('payment' in legacySettings.sectionHeadings, false);
});

test('admission document preview uses the selected approved application data', async () => {
  const photoReads: string[] = [];
  const application = {
    id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    student_name: student.fullName,
    email: student.email,
    mobile: student.mobile,
    qualification: student.qualification,
    program_id: programId,
    program_name: student.programName,
    date_of_birth: student.dateOfBirth,
    address: student.address,
    photo_object_key: photoKey,
    approved_at: '2026-01-01T10:00:00Z',
    status: 'Accepted',
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        photoReads.push(key);
        if (key !== photoKey) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/png' },
        };
      },
      list: async () => ({ objects: [] }),
    },
  });

  const applicationSnapshot = {
    application: {
      ...application,
      qualification_category: 'Graduate',
      parent_phone: null,
      parent_email: null,
    },
    program: { name: selectedCourse.name, duration: selectedCourse.duration, mode: 'Regular classroom' },
    payment_summary: { total_payable: 13000, total_paid: 500, payments: [] },
    document_settings: {},
    joining_information: {},
  };
  await withAdminFetch('admin', async (request, url) => {
    if (url.pathname.endsWith('/official_document_settings')) return Response.json([]);
    if (url.pathname.endsWith('/applications')) {
      return Response.json([{ id: applicationId, status: 'Accepted', student_id: student.studentId }]);
    }
    if (url.pathname.endsWith('/rpc/build_official_document_snapshot')) {
      assert.equal(request.method, 'POST');
      return Response.json(applicationSnapshot);
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document/preview', 'POST', { application_id: applicationId }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    const text = decodePdfText(bytes);
    assert.match(text, /PREVIEW ONLY - NOT AN OFFICIAL STUDENT DOCUMENT/);
    assert.match(text, /Test Learner/);
    assert.match(text, /IELTS Preparation/);
    assert.match(text, /UEA-STU-2026-0001/);
    assert.doesNotMatch(text, /PREVIEW APPLICANT|FEE BREAKDOWN|Net Payable Amount|PAYMENT PENDING|INR 500/);
  });
  assert.deepEqual(photoReads, [photoKey]);
});

test('approval attaches and stores the PDF generated from the immutable issuance snapshot', async () => {
  const uploaded: Array<{ key: string; bytes: Uint8Array; contentType?: string }> = [];
  const emailPayloads: Record<string, unknown>[] = [];
  const notificationWrites: Record<string, unknown>[] = [];
  const snapshot = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: student.fullName,
      email: student.email,
      mobile: student.mobile,
      qualification: student.qualification,
      date_of_birth: student.dateOfBirth,
      address: student.address,
      photo_object_key: photoKey,
      program_id: programId,
      program_name: student.programName,
    },
    program: {
      id: programId,
      name: selectedCourse.name,
      duration: selectedCourse.duration,
      level: selectedCourse.level,
    },
    document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    joining_information: {
      joiningDate: '2026-02-01',
      classSchedule: 'Monday to Saturday',
      classTimings: '8:00 AM – 9:00 AM',
      venue: 'Davanagere Ram & Co Circle',
    },
  };
  const approvalResult = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: student.fullName,
      email: student.email,
      mobile: student.mobile,
      qualification: student.qualification,
      program_name: student.programName,
    },
    issuance: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: applicationId,
      application_reference: student.applicationNumber,
      snapshot,
      pdf_object_key: null,
      status: 'pending',
    },
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => key === photoKey
        ? {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/png' },
        }
        : null,
      put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }) => {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        uploaded.push({ key, bytes, contentType: options?.httpMetadata?.contentType });
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (request, url) => {
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      assert.equal(request.headers.get('Idempotency-Key'), `student-approval-${applicationId}`);
      emailPayloads.push(await request.json() as Record<string, unknown>);
      return Response.json({ id: 'resend-message-id' });
    }
    if (url.pathname === '/rest/v1/applications' && request.method === 'PATCH') {
      const updates = await request.json() as { joining_information: unknown };
      assert.deepEqual(updates.joining_information, snapshot.joining_information);
      return Response.json({
        id: applicationId,
        status: 'Pending',
        joining_information: snapshot.joining_information,
      });
    }
    if (url.pathname.endsWith('/rpc/approve_application_with_official_snapshot')) {
      const rpcPayload = await request.json() as Record<string, unknown>;
      assert.equal(rpcPayload.p_application_id, applicationId);
      assert.equal(rpcPayload.p_approver_id, userId);
      assert.equal(rpcPayload.p_approver_name, 'Test Admin');
      assert.deepEqual(rpcPayload.p_joining_information, snapshot.joining_information);
      return Response.json(approvalResult);
    }
    if (url.pathname.endsWith('/application_notifications')) {
      if (request.method === 'GET') return Response.json([]);
      notificationWrites.push(await request.json() as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/official_document_issuances')) {
      assert.equal(request.method, 'PATCH');
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/approve-application', 'POST', {
        application_id: applicationId,
        approved_by_name: 'Test Admin',
        joining_information: snapshot.joining_information,
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { student_id: string; pdf_attached: boolean };
    assert.equal(body.student_id, student.studentId);
    assert.equal(body.pdf_attached, true);
  });

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].key, `official-documents/${applicationId}/v1-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`);
  assert.equal(uploaded[0].contentType, 'application/pdf');
  assert.equal(new TextDecoder().decode(uploaded[0].bytes.slice(0, 5)), '%PDF-');
  assert.equal(notificationWrites.length, 1);
  assert.equal(notificationWrites[0].status, 'Sent');
  const emailPayload = emailPayloads[0];
  assert.ok(emailPayload);
  const attachments = emailPayload.attachments as Array<{ filename: string; content: string }>;
  assert.equal(attachments.length, 1);
  assert.match(attachments[0].filename, /UEA-APP-2026-0001/);
  const attachedPdf = new Uint8Array(Buffer.from(attachments[0].content, 'base64'));
  const attachedText = decodePdfText(attachedPdf);
  assert.match(attachedText, /IELTS Preparation/);
  assert.match(attachedText, /UEA-STU-2026-0001/);
  assert.doesNotMatch(attachedText, /\b(?:document\s*)?version\s*[:#-]?\s*\d+\b/i);
  assert.match(attachedText, /2026-02-01/);
  assert.match(attachedText, /Monday to Saturday/);
  assert.match(attachedText, /8:00 AM/);
  assert.match(attachedText, /Davanagere/);
  assert.doesNotMatch(attachedText, /PAYMENT PENDING|Total Paid|Outstanding Balance|Payment Mode|INR 0\.00/);
  assert.doesNotMatch(attachedText, /Other Course|Spoken English|Business English/);
});

test('approval records a failed delivery without exposing an automatic retry endpoint', async () => {
  const logoKey = 'official-document-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
  const uploadedPdfs: string[] = [];
  const assetReads: string[] = [];
  let storedPdf: Uint8Array | null = null;
  let notificationCount = 0;
  let deliveryStatus: 'Pending' | 'Failed' | 'Sent' | null = null;
  let emailAttempts = 0;
  let approvalCalls = 0;
  const resendPayloads: Record<string, unknown>[] = [];
  const snapshot = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: student.fullName,
      email: student.email,
      mobile: student.mobile,
      qualification: student.qualification,
      date_of_birth: student.dateOfBirth,
      address: student.address,
      photo_object_key: photoKey,
      program_id: programId,
      program_name: student.programName,
    },
    program: {
      id: programId,
      name: selectedCourse.name,
      duration: selectedCourse.duration,
      level: selectedCourse.level,
    },
    document_settings: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS, logoObjectKey: logoKey },
    joining_information: {
      joiningDate: '2026-02-01',
      classSchedule: 'Monday to Saturday',
      classTimings: '8:00 AM – 9:00 AM',
      venue: 'Davanagere Ram & Co Circle',
    },
  };
  const application = {
    id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    student_name: 'Editable Current Name',
    email: 'current-record@example.com',
    mobile: student.mobile,
    qualification: student.qualification,
    program_name: 'Current Editable Course',
  };
  const issuance: Record<string, any> = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    application_id: applicationId,
    application_reference: student.applicationNumber,
    snapshot,
    pdf_object_key: null as string | null,
    status: 'pending',
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        assetReads.push(key);
        const versionedPdfKey = `official-documents/${applicationId}/v1-${issuance.id}.pdf`;
        const bytes = key === photoKey || key === logoKey ? pngBytes : key === versionedPdfKey ? storedPdf : null;
        if (!bytes) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: key === photoKey || key === logoKey ? 'image/png' : 'application/pdf' },
        };
      },
      put: async (key: string, value: ArrayBuffer | ArrayBufferView) => {
        if (!key.startsWith('official-documents/')) throw new Error(`Unexpected R2 write: ${key}`);
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        storedPdf = bytes.slice();
        uploadedPdfs.push(key);
        issuance.pdf_object_key = key;
        issuance.status = 'ready';
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('super_admin', async (request, url) => {
    if (url.pathname.endsWith('/site_branding')) {
      return Response.json({
        academy_name: "Uptrend's English Academy",
        logo_url: 'https://assets.example/branding/saved-logo.png',
        primary_green: '#14532d',
        primary_orange: '#ea580c',
      });
    }
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      emailAttempts += 1;
      assert.equal(request.headers.get('Idempotency-Key'), `student-approval-${applicationId}`);
      resendPayloads.push(await request.json() as Record<string, unknown>);
      if (emailAttempts === 1) return Response.json({ message: 'Temporary provider failure.' }, { status: 503 });
      return Response.json({ id: 'resend-message-id' });
    }
    if (url.pathname.endsWith('/rpc/approve_application_with_official_snapshot')) {
      approvalCalls += 1;
      const requestBody = await request.json() as Record<string, unknown>;
      assert.equal(requestBody.p_application_id, applicationId);
      assert.equal(requestBody.p_approver_id, userId);
      assert.equal(requestBody.p_approver_name, 'Test Admin');
      assert.deepEqual(requestBody.p_joining_information, snapshot.joining_information);
      return Response.json({ application, issuance });
    }
    if (url.pathname.endsWith('/application_notifications')) {
      if (request.method === 'GET') {
        return Response.json(deliveryStatus ? [{
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          status: deliveryStatus,
        }] : []);
      }
      const body = await request.json() as { status: 'Pending' | 'Failed' | 'Sent' };
      deliveryStatus = body.status;
      if (request.method === 'POST') notificationCount += 1;
      return Response.json([{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: deliveryStatus }]);
    }
    if (url.pathname === '/rest/v1/applications' && request.method === 'PATCH') {
      return Response.json({
        id: applicationId,
        status: 'Pending',
        joining_information: snapshot.joining_information,
      });
    }
    if (url.pathname.endsWith('/applications')) return Response.json([application]);
    if (url.pathname.endsWith('/official_document_issuances')) return Response.json([issuance]);
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  }, async () => {
    const approvalRequest = () => handleApiRequest(
      authorizedRequest('/api/approve-application', 'POST', {
        application_id: applicationId,
        approved_by_name: 'Test Admin',
        joining_information: snapshot.joining_information,
      }),
      env,
    );

    const firstApproval = await approvalRequest();
    assert.equal(firstApproval.status, 200);
    const firstBody = await firstApproval.json() as { email_status: string; student_id: string };
    assert.match(firstBody.email_status, /^Failed:/);
    assert.equal(firstBody.student_id, student.studentId);
    assert.equal(deliveryStatus, 'Failed');

    const retry = await handleApiRequest(
      authorizedRequest('/api/retry-notification', 'POST', {
        notification_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
      env,
    );
    assert.equal(retry.status, 404);
  });

  assert.equal(approvalCalls, 1);
  assert.equal(emailAttempts, 1);
  assert.equal(resendPayloads.length, 1);
  assert.equal(resendPayloads[0].to, student.email);
  assert.match(String(resendPayloads[0].html), /src="https:\/\/assets\.example\/branding\/saved-logo\.png"/);
  assert.match(String(resendPayloads[0].html), /Test Learner/);
  assert.match(String(resendPayloads[0].html), /IELTS Preparation/);
  assert.match(String(resendPayloads[0].html), /official admission approval document attached/i);
  assert.doesNotMatch(String(resendPayloads[0].html), /fee|terms and conditions/i);
  assert.doesNotMatch(String(resendPayloads[0].html), /Editable Current Name|Current Editable Course|stale-notification/);
  const approvalAttachments = resendPayloads[0].attachments as Array<{ filename: string; content: string }>;
  assert.equal(approvalAttachments.length, 1);
  assert.match(approvalAttachments[0].filename, /^Official_Document_/);
  assert.ok(approvalAttachments[0].content.length > 0);
  assert.equal(notificationCount, 1);
  assert.deepEqual(uploadedPdfs, [`official-documents/${applicationId}/v1-${issuance.id}.pdf`]);
  assert.ok(assetReads.includes(logoKey));
  assert.equal(deliveryStatus, 'Failed');
  assert.ok(storedPdf);
  const savedPdfText = decodePdfText(storedPdf);
  assert.match(savedPdfText, /IELTS Preparation/);
  assert.match(savedPdfText, /UEA-STU-2026-0001/);
  assert.doesNotMatch(savedPdfText, /FEE BREAKDOWN|Net Payable Amount|TERMS & CONDITIONS/);
  assert.doesNotMatch(savedPdfText, /Current Editable Course|Other Course/);
});

test('authorized admins can list and download detached official-document history by application reference', async () => {
  const firstVersionKey = `official-documents/${applicationId}/v1-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
  const secondVersionKey = `official-documents/${applicationId}/v2-ffffffff-ffff-4fff-8fff-ffffffffffff.pdf`;
  const pdfBytes = await generateOfficialPdf({ settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS, student, course: selectedCourse });
  const versions = [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: null,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      version_number: 1,
      issuance_type: 'approval',
      status: 'ready',
      email_status: 'Sent',
      generated_at: '2026-10-30T10:00:00Z',
      created_at: '2026-10-30T09:00:00Z',
      pdf_object_key: firstVersionKey,
      snapshot: {
        application: {
          id: applicationId,
          student_name: student.fullName,
          student_id: student.studentId,
          application_reference: student.applicationNumber,
          qualification: student.qualification,
          program_name: student.programName,
          email: student.email,
          mobile: student.mobile,
          date_of_birth: student.dateOfBirth,
          address: student.address,
        },
        program: { name: selectedCourse.name, duration: selectedCourse.duration },
        payment_summary: { status: 'pending', total_paid: 98765, outstanding_balance: 13000 },
        document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      },
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      application_id: null,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      version_number: 2,
      issuance_type: 'payment_update',
      status: 'ready',
      email_status: 'Sent',
      generated_at: '2026-10-31T10:00:00Z',
      created_at: '2026-10-31T09:00:00Z',
      pdf_object_key: secondVersionKey,
      snapshot: { payment_summary: { status: 'partially_paid', total_paid: 4000, outstanding_balance: 9000 } },
    },
  ];
  let retrievedKey = '';
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        retrievedKey = key;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pdfBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'application/pdf' },
        };
      },
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (_request, url) => {
    if (!url.pathname.endsWith('/official_document_issuances')) throw new Error(`Unexpected request: ${url.pathname}`);
    if (url.searchParams.has('version_number')) return Response.json([versions[0]]);
    return Response.json(versions);
  }, async () => {
    const historyResponse = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/versions?application_reference=${student.applicationNumber}`),
      env,
    );
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as Array<Record<string, unknown>>;
    assert.equal(history.length, 2);
    assert.equal(history[0]?.version_number, 1);
    assert.equal(history[1]?.version_number, 2);
    assert.equal('pdf_object_key' in history[0]!, false);
    assert.equal('payment_status' in history[1]!, false);
    assert.equal('outstanding_balance' in history[1]!, false);
    assert.equal('total_paid' in history[1]!, false);
    assert.equal('payment_count' in history[1]!, false);

    const downloadResponse = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/issued?application_reference=${student.applicationNumber}&version=1`),
      env,
    );
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get('Content-Disposition') || '', /Issued_V1_/);
    const issuedText = decodePdfText(new Uint8Array(await downloadResponse.arrayBuffer()));
    assert.doesNotMatch(issuedText, /Total paid to date|UPI-7788|BANK-REF-22|INR 4,000\.00/);
  });

  assert.equal(retrievedKey, firstVersionKey);
  assert.notEqual(firstVersionKey, secondVersionKey);
});

test('official PDF settings require super-admin and store uploaded assets privately', async () => {
  const savedSettings: Record<string, unknown>[] = [];
  const savedSettingKeys: string[] = [];
  const uploadedKeys: string[] = [];
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      put: async (key: string) => { uploadedKeys.push(key); },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });
  const requestBody = {
    settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      heading: 'Updated Admission Confirmation',
      joiningInstructions: ['Bring the admission confirmation slip.'],
    },
    logo_file_base64: `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`,
  };

  await withAdminFetch('admin', async () => Response.json([]), async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document', 'PUT', requestBody),
      env,
    );
    assert.equal(response.status, 403);
  });

  await withAdminFetch('super_admin', async (request, url) => {
    if (!url.pathname.endsWith('/official_document_settings')) {
      throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    }
    if (request.method === 'GET') return Response.json([]);
    const body = await request.json() as { setting_key: string; document_data: Record<string, unknown> } | Array<{ setting_key: string; document_data: Record<string, unknown> }>;
    const row = Array.isArray(body) ? body[0] : body;
    savedSettingKeys.push(row.setting_key);
    savedSettings.push(row.document_data);
    return Response.json(row);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document', 'PUT', requestBody),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { settings: Record<string, unknown> };
    assert.equal(body.settings.heading, 'Updated Admission Confirmation');
    assert.deepEqual(body.settings.joiningInstructions, ['Bring the admission confirmation slip.']);
    assert.equal('terms' in body.settings, false);
    assert.match(String(body.settings.logoObjectKey), /^official-document-assets\/[0-9a-f-]+\.png$/i);
  });
  assert.equal(savedSettings[0]?.heading, 'Updated Admission Confirmation');
  assert.deepEqual(savedSettings[0]?.joiningInstructions, ['Bring the admission confirmation slip.']);
  assert.deepEqual(savedSettingKeys, ['admission_approval']);
  assert.equal(uploadedKeys.length, 1);
  assert.match(uploadedKeys[0], /^official-document-assets\/[0-9a-f-]+\.png$/i);
});

test('official PDF logo assets remain available while fee confirmation PDF is removed', async () => {
  const logoKey = 'official-document-assets/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png';
  let fetchedKey = '';
  const configuredSettings = { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS, logoObjectKey: logoKey };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        fetchedKey = key;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/png' },
        };
      },
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('staff', async (request, url) => {
    if (!url.pathname.endsWith('/official_document_settings')) {
      throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    }
    return Response.json([{ setting_key: 'admission_approval', document_data: configuredSettings }]);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document/assets?type=logo'),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pngBytes);
  });

  assert.equal(fetchedKey, logoKey);
  const adminPortal = await readFile(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8');
  assert.match(adminPortal, /api\/admin\/official-document\/assets/);
  assert.doesNotMatch(adminPortal, /generateStudentConfirmationPdf|Enrollment & Fee Confirmation|FEE SUMMARY/);
  assert.doesNotMatch(adminPortal, /const logoUrl = "https:\/\/gpnfznwqwaokfzmozpxo\.supabase\.co/);
});

test('program course mode is saved as a nullable admin-editable program field', async () => {
  let savedCourseMode: unknown = null;
  await withAdminFetch('admin', async (request, url) => {
    if (!url.pathname.endsWith('/programs')) throw new Error(`Unexpected request: ${url.pathname}`);
    if (request.method === 'GET') {
      return Response.json([{ id: programId, image_url: null, image_object_key: null }]);
    }
    assert.equal(request.method, 'PATCH');
    const body = await request.json() as Record<string, unknown>;
    savedCourseMode = body.course_mode;
    return Response.json({ id: programId, ...body });
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest(`/api/admin/programs/${programId}`, 'PUT', { course_mode: 'Regular classroom' }),
      makeWorkerEnv(),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { course_mode: string };
    assert.equal(body.course_mode, 'Regular classroom');
  });
  assert.equal(savedCourseMode, 'Regular classroom');
});

test('course fee configuration API is no longer active', async () => {
  const response = await handleApiRequest(
    authorizedRequest('/api/admin/program-fees'),
    makeWorkerEnv(),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'API route not found.' });
});

test('agreed-fee route is absent from both Worker and Express dispatch', async () => {
  const [worker, server] = await Promise.all([
    readFile(new URL('../worker-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(worker, /\(payments\|fee\)/);
  assert.doesNotMatch(server, /\/api\/admin\/applications\/:id\/fee/);
});

test('fee configuration removal migration preserves historical data and approval snapshots', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261101000005_remove_course_fee_configuration.sql', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/i);
  assert.doesNotMatch(migration, /CASCADE/i);
  assert.match(migration, /public\.program_fee_history/);
  assert.match(migration, /public\.program_fee_configurations,[\s\S]*public\.application_fee_agreements[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.build_official_document_snapshot/);
  assert.doesNotMatch(migration, /program_fee_configurations%ROWTYPE|FROM public\.program_fee_configurations/);
  assert.match(migration, /CHECK \(setting_key IN \('admission_approval', 'official_fee_structure'\)\)/);
  assert.doesNotMatch(migration, /agreed_total|total_payable|outstanding_balance|final_payable/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.build_official_document_snapshot\(uuid, jsonb\)[\s\S]*TO service_role/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
});

test('payment RPC migration preserves audited payment entry without agreed-fee dependencies', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261101000008_remove_fee_dependencies_from_payments.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_application_payment_idempotent/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_application_payment\(/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_application_payment/);
  assert.match(migration, /INSERT INTO public\.application_payment_audit/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /idempotency_key = p_idempotency_key/);
  assert.match(migration, /first_payment/);
  assert.match(migration, /second_payment/);
  assert.doesNotMatch(migration, /application_fee_agreements|agreed_total|remaining balance/i);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|CASCADE/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_application_payment_idempotent[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_application_payment_idempotent[\s\S]+TO service_role/);
});

test('lifecycle automation migration is valid and retains notification evidence', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261101000007_remove_lifecycle_automation.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /DO \$\$[\s\S]+END;\s*\$\$;/);
  assert.match(migration, /cron\.unschedule\(retention_job_id\)/);
  assert.match(migration, /DROP TABLE IF EXISTS public\.application_photo_cleanup_jobs/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*official_approval_email_state/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.official_approval_email_state TO service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.request_email_notifications TO service_role/);
  assert.doesNotMatch(migration, /CASCADE|DELETE FROM|TRUNCATE TABLE|DROP TABLE[^;]*application_notifications/i);
  assert.doesNotMatch(migration, /DROP TABLE[^;]*official_approval_email_state/i);
});

test('certificate email lifecycle removal preserves certificate records and files', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261101000009_remove_certificate_email_lifecycle.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.acquire_certificate_email_lease/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.reconcile_certificate_email_unknown/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.record_certificate_email_delivery/);
  assert.match(migration, /DROP TABLE IF EXISTS public\.certificate_email_rejection_evidence/);
  assert.match(migration, /DROP TABLE IF EXISTS public\.certificate_email_attempts/);
  assert.doesNotMatch(migration, /DROP TABLE[^;]*public\.certificates|DROP TABLE[^;]*public\.certificate_events/i);
  assert.doesNotMatch(migration, /CASCADE|DELETE FROM|TRUNCATE|R2/i);
});

test('database migration uses independent yearly sequences and atomic immutable fee snapshots', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261030000007_dynamic_official_documents_and_course_fees.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /v_prefix := 'application_number'/);
  assert.match(migration, /v_prefix := 'student_number'/);
  assert.match(migration, /CREATE SEQUENCE IF NOT EXISTS public\.%I/);
  assert.match(migration, /nextval\(%L::regclass\)/);
  assert.match(migration, /RETURN format\('UEA-%s-%s-%s'/);
  assert.match(migration, /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(v_sequence_name, 0\)/);
  assert.match(migration, /v_last_value > 9999 OR \(v_is_called AND v_last_value >= 9999\)/);
  assert.match(migration, /exhausted at 9999/);
  assert.match(migration, /v_number > 9999/);
  assert.match(migration, /regexp_match\(\s*application_reference,\s*'\^UEA-APP-/);
  assert.match(migration, /regexp_match\(\s*student_id,\s*'\^UEA-STU-/);
  assert.match(migration, /pg_catalog\.setval/);
  assert.match(migration, /NEW\.application_reference := OLD\.application_reference/);
  assert.match(migration, /NEW\.student_id := OLD\.student_id/);
  assert.match(migration, /IF NEW\.status <> 'Pending' THEN\s+RAISE EXCEPTION 'Applications must be submitted as pending\.'/);
  assert.match(migration, /CREATE POLICY "Public can submit applications" ON public\.applications\s+FOR INSERT WITH CHECK \(status = 'Pending'\)/);
  assert.match(migration, /NEW\.status = 'Accepted' AND NEW\.student_id IS NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_student_id_unique/);
  assert.match(migration, /FROM public\.applications\s+WHERE id = p_application_id\s+FOR UPDATE/);
  assert.match(migration, /'document_settings', COALESCE\(v_settings/);
  assert.match(migration, /'agreed_total', v_agreement\.agreed_total/);
  assert.match(migration, /ON CONFLICT \(application_id\) DO NOTHING/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.official_approval_email_state/);
  assert.match(migration, /claim_student_approval_notification/);
  assert.match(migration, /complete_student_approval_notification/);
  assert.match(migration, /FROM public\.application_notifications\s+WHERE notification_type = 'student_approval'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_student_approval_notification[\s\S]+TO service_role/);
  assert.match(migration, /ALTER TABLE public\.official_document_issuances ENABLE ROW LEVEL SECURITY/);
});

test('payment PDF version migration reuses existing ledgers, issuance, and notification tables', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261031000004_official_document_payment_versions.sql', import.meta.url),
    'utf8',
  );
  const recoveryMigration = await readFile(
    new URL('../supabase/migrations/20261031000005_payment_document_audit_recovery.sql', import.meta.url),
    'utf8',
  );
  const paymentFunctionsMigration = await readFile(
    new URL('../supabase/migrations/20261026000001_manual_payment_functions.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS course_mode text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS idempotency_key uuid/);
  assert.match(migration, /idx_application_payments_idempotency/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS official_document_issuances_application_id_key/);
  assert.match(migration, /WHEN application_id IS NULL THEN 'historical:' \|\| id::text/);
  assert.match(migration, /idx_official_document_issuances_application_version/);
  assert.match(migration, /build_official_document_snapshot/);
  assert.match(migration, /'qualification_category', v_application\.qualification_category/);
  assert.match(migration, /'parent_phone', v_application\.parent_phone/);
  assert.match(migration, /'parent_email', v_application\.parent_email/);
  assert.match(migration, /'mode', v_program\.course_mode/);
  assert.match(migration, /'payment_summary'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_official_document_payment_version/);
  assert.match(migration, /RETURNS uuid/);
  assert.doesNotMatch(migration, /CREATE TRIGGER trg_application_payments_official_document_version/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /'student_payment_update'/);
  assert.match(migration, /claim_official_document_issuance/);
  assert.match(migration, /complete_official_document_issuance/);
  assert.match(migration, /claim_official_document_notification/);
  assert.match(migration, /complete_official_document_notification/);
  assert.match(migration, /earlier\.email_status <> 'Sent'/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.application_notifications[\s\S]+TO service_role/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS public\.(application_payments|application_fee_agreements|official_document_issuances)/);
  assert.doesNotMatch(migration, /DELETE FROM public\.(application_payments|application_fee_agreements|official_document_issuances)/);
  assert.match(recoveryMigration, /application_payment_audit/);
  assert.doesNotMatch(recoveryMigration, /DROP CONSTRAINT IF EXISTS application_payment_audit_payment_id_fkey/);
  assert.match(recoveryMigration, /application_payment_audit_payment_id_fkey must reference application_payments\(id\) with ON DELETE SET NULL/);
  assert.match(recoveryMigration, /access_method\.amname = 'btree'/);
  assert.match(recoveryMigration, /index_info\.indisvalid/);
  assert.match(recoveryMigration, /index_info\.indisready/);
  assert.match(recoveryMigration, /index_info\.indnkeyatts = 1/);
  assert.match(recoveryMigration, /index_info\.indkey\[0\] = \([\s\S]+attname = 'event_sequence'/);
  assert.match(recoveryMigration, /pg_get_expr\(index_info\.indpred, index_info\.indrelid\) = '\(source_event_key IS NOT NULL\)'/);
  assert.match(recoveryMigration, /application_payment_historical_baseline_meta exists with an incompatible definition/);
  assert.match(recoveryMigration, /application_payment_historical_baseline exists with an incompatible definition/);
  assert.match(recoveryMigration, /attribute\.atttypid <> 'int8'::regtype/);
  assert.match(recoveryMigration, /format_type\(attribute\.atttypid, attribute\.atttypmod\) <> 'numeric\(12,2\)'/);
  assert.match(recoveryMigration, /REFERENCES public\.applications\(id\) ON DELETE CASCADE/);
  assert.match(recoveryMigration, /format_type\(attribute\.atttypid, attribute\.atttypmod\) = expected\.type_name/);
  for (const column of ['recorded_at', 'created_at', 'updated_at', 'captured_at']) {
    assert.match(recoveryMigration, new RegExp(`\\('${column}', 'timestamp with time zone', true\\)`));
  }
  assert.match(recoveryMigration, /attribute\.atttypid <> 'timestamptz'::regtype/);
  assert.match(recoveryMigration, /constraint_info\.confrelid = 'public\.applications'::regclass/);
  assert.match(recoveryMigration, /constraint_info\.confdeltype = 'c'/);
  assert.match(recoveryMigration, /constraint_info\.conkey = ARRAY\[local_column\.attnum\]::smallint\[\]/);
  assert.match(recoveryMigration, /constraint_info\.confkey = ARRAY\[referenced_column\.attnum\]::smallint\[\]/);
  assert.match(recoveryMigration, /v_payload_id !~\* '\^\[0-9a-f\]\{8\}/);
  assert.match(recoveryMigration, /v_payload_uuid <> v_audit\.payment_id/);
  assert.match(recoveryMigration, /payment-audit:/);
  assert.match(recoveryMigration, /p_event_key ~ '\^payment-audit:\[0-9a-f\]\{8\}/);
  assert.match(recoveryMigration, /substring\(p_event_key from 15\)::uuid/);
  assert.match(recoveryMigration, /SELECT count\(\*\) INTO v_candidate_count/);
  assert.doesNotMatch(recoveryMigration, /min\(id\)/);
  assert.match(
    recoveryMigration,
    /v_action = 'deleted' AND COALESCE\([\s\S]+before_data->>'created_at'\s*\)\s*=\s*v_event_timestamp\s*\)\s*;\s*IF v_candidate_count <> 1 THEN/,
  );
  assert.match(recoveryMigration, /IF v_candidate_count <> 1 THEN[\s\S]+SELECT id INTO v_audit_id/);
  assert.match(recoveryMigration, /IF v_candidate_count <> 1 THEN/);
  assert.match(recoveryMigration, /after_data->>'updated_at' = v_event_timestamp/);
  assert.match(recoveryMigration, /after_data->>'created_at' = v_event_timestamp/);
  assert.match(recoveryMigration, /COALESCE\(\s*payment_id,\s*CASE WHEN before_data->>'id' ~\* '\^\[0-9a-f\]\{8\}/);
  assert.match(recoveryMigration, /v_action = 'created' AND after_data->>'created_at' = v_event_timestamp/);
  assert.match(recoveryMigration, /v_action = 'updated' AND after_data->>'updated_at' = v_event_timestamp/);
  assert.match(recoveryMigration, /v_action = 'deleted' AND COALESCE\(\s*before_data->>'updated_at',\s*before_data->>'created_at'/);
  assert.match(recoveryMigration, /before_data->>'id' = v_payment_id::text/);
  assert.match(recoveryMigration, /before_data->>'id' = v_payment_id::text[\s\S]+v_event_timestamp IS NULL[\s\S]+before_data->>'created_at'/);
  assert.match(recoveryMigration, /action = v_action/);
  assert.match(recoveryMigration, /reconcile_payment_document_versions/);
  assert.match(recoveryMigration, /audit\.changed_at > application\.approved_at/);
  assert.match(recoveryMigration, /action IN \('created', 'updated', 'deleted'\)/);
  assert.match(recoveryMigration, /REVOKE ALL ON FUNCTION public\.reconcile_payment_document_versions/);
  assert.match(recoveryMigration, /build_official_document_snapshot_for_payment_event/);
  assert.match(recoveryMigration, /version_number = 1/);
  assert.match(recoveryMigration, /issuance_type = 'approval'/);
  assert.match(recoveryMigration, /CREATE TABLE IF NOT EXISTS public\.application_payment_historical_baseline/);
  assert.match(recoveryMigration, /payment_id uuid PRIMARY KEY/);
  assert.match(recoveryMigration, /payment_method text NOT NULL/);
  assert.match(recoveryMigration, /payment_stage text NOT NULL/);
  assert.match(recoveryMigration, /recorded_at timestamptz NOT NULL/);
  assert.match(recoveryMigration, /LOCK TABLE public\.applications, public\.application_payments\s+IN SHARE MODE/);
  assert.match(recoveryMigration, /LOCK TABLE public\.application_payment_audit\s+IN SHARE MODE/);
  assert.match(recoveryMigration, /LOCK TABLE public\.applications[\s\S]+ALTER TABLE public\.application_payment_audit/);
  assert.match(recoveryMigration, /ROW_NUMBER\(\) OVER \(ORDER BY changed_at ASC, id ASC\)/);
  assert.match(recoveryMigration, /SET event_sequence = ordered_audit\.sequence_value/);
  assert.match(recoveryMigration, /pg_get_serial_sequence/);
  assert.match(recoveryMigration, /setval\(v_sequence_name::regclass, v_max_sequence, true\)/);
  assert.match(recoveryMigration, /setval\(v_sequence_name::regclass, 1, false\)/);
  assert.match(recoveryMigration, /IF NOT EXISTS \([\s\S]+application_payment_historical_baseline_meta[\s\S]+WHERE singleton[\s\S]+ROW_NUMBER/);
  assert.match(recoveryMigration, /CREATE TABLE IF NOT EXISTS public\.application_payment_historical_baseline_meta/);
  assert.match(recoveryMigration, /event_sequence_watermark bigint NOT NULL/);
  assert.match(recoveryMigration, /COALESCE\(MAX\(event_sequence\), 0\), transaction_timestamp\(\)/);
  assert.match(recoveryMigration, /ON CONFLICT \(singleton\) DO NOTHING/);
  assert.doesNotMatch(recoveryMigration, /ON CONFLICT \(singleton\) DO UPDATE/);
  assert.match(recoveryMigration, /INSERT INTO public\.application_payment_historical_baseline/);
  assert.match(recoveryMigration, /transaction_timestamp\(\)/);
  assert.match(recoveryMigration, /v_event_sequence <= v_baseline_watermark/);
  assert.match(recoveryMigration, /v_event_sequence > v_baseline_watermark/);
  assert.match(recoveryMigration, /ORDER BY COALESCE\([\s\S]+event_sequence DESC,\s*id DESC/);
  assert.match(recoveryMigration, /latest_active_audit_payments/);
  assert.match(recoveryMigration, /eligible_baseline_payments/);
  assert.match(recoveryMigration, /event\.payment_id = baseline\.payment_id/);
  assert.match(recoveryMigration, /SELECT payment_data\s+FROM eligible_baseline_payments/);
  assert.match(recoveryMigration, /After the watermark, audited state supersedes baseline state/);
  assert.doesNotMatch(recoveryMigration, /baseline\.created_at <= v_event_changed_at/);
  assert.match(recoveryMigration, /NOT EXISTS \([\s\S]+application_payment_audit AS audit/);
  assert.match(recoveryMigration, /event\.payment_id = baseline\.payment_id/);
  assert.match(recoveryMigration, /ON CONFLICT \(payment_id\) DO NOTHING/);
  assert.doesNotMatch(recoveryMigration, /SELECT to_jsonb\(payment\)\s+FROM public\.application_payments/);
  assert.match(recoveryMigration, /event_sequence bigint GENERATED BY DEFAULT AS IDENTITY/);
  assert.match(recoveryMigration, /event_sequence <= v_event_sequence/);
  const paymentIdentityExpression =
    /COALESCE\(\s*payment_id,\s*CASE WHEN before_data->>'id' ~\* '\^\[0-9a-f\]\{8\}/g;
  assert.ok([...recoveryMigration.matchAll(paymentIdentityExpression)].length >= 1);
  assert.match(recoveryMigration, /FOR UPDATE/);
  assert.match(recoveryMigration, /DISTINCT ON \(\s*COALESCE\(\s*payment_id/);
  assert.match(recoveryMigration, /after_data/);
  assert.match(recoveryMigration, /Approval issuance snapshot not found/);
  assert.match(recoveryMigration, /v_approval_snapshot/);
  assert.match(recoveryMigration, /IF v_approval_snapshot IS NULL THEN/);
  assert.doesNotMatch(recoveryMigration, /v_snapshot := public\.build_official_document_snapshot\(p_application_id, NULL\)/);
  assert.match(paymentFunctionsMigration, /before_data/);
  assert.match(paymentFunctionsMigration, /after_data/);

  for (const source of [paymentFunctionsMigration, migration]) {
    const createStart = source.indexOf('CREATE OR REPLACE FUNCTION public.create_application_payment');
    const createEnd = source.indexOf('$$;', createStart);
    const createBody = source.slice(createStart, createEnd);
    assert.match(createBody, /FROM public\.applications[\s\S]+FOR UPDATE/);
    assert.match(createBody, /INSERT INTO public\.application_payments[\s\S]+INSERT INTO public\.application_payment_audit/);
  }
});

test('historical Version 1 recovery is isolated, idempotent, and uses strict payment evidence', async () => {
  const recoveryMigration = await readFile(
    new URL('../supabase/migrations/20261102000000_forward_historical_official_document_recovery.sql', import.meta.url),
    'utf8',
  );
  assert.match(recoveryMigration, /create_historical_official_document_version_one/);
  assert.match(recoveryMigration, /v_application\.status <> 'Accepted'/);
  assert.match(recoveryMigration, /v_application\.approved_at IS NULL/);
  assert.match(recoveryMigration, /FOR UPDATE/);
  assert.match(recoveryMigration, /audit\.changed_at <= v_application\.approved_at/);
  assert.match(recoveryMigration, /audit\.event_sequence DESC, audit\.id DESC/);
  assert.match(recoveryMigration, /access_method\.amname = 'btree'/);
  assert.match(recoveryMigration, /index_info\.indnkeyatts = 2/);
  assert.match(recoveryMigration, /Existing Version 1 issuance is anomalous and cannot be reused/);
  assert.match(recoveryMigration, /v_issuance\.application_reference IS DISTINCT FROM v_application\.application_reference/);
  assert.match(recoveryMigration, /v_issuance\.student_id IS DISTINCT FROM v_application\.student_id/);
  assert.match(recoveryMigration, /Existing Version 1 issuance identity does not match the application/);
  assert.match(recoveryMigration, /created_at <= v_application\.approved_at[\s\S]+updated_at <= v_application\.approved_at/);
  assert.match(recoveryMigration, /Approval-time fee evidence is contradictory/);
  assert.match(recoveryMigration, /ORDER BY audit\.event_sequence DESC, audit\.id DESC/);
  assert.match(recoveryMigration, /v_payload_id !~\* '\^\[0-9a-f\]\{8\}/);
  assert.match(recoveryMigration, /v_payload_uuid <> v_audit\.payment_id/);
  assert.match(recoveryMigration, /action IN \('created', 'updated', 'deleted'\)/);
  assert.match(recoveryMigration, /action = 'fee_updated'/);
  assert.match(recoveryMigration, /Payment audit coverage is incomplete/);
  assert.match(recoveryMigration, /A payment audit event has no recoverable payment identity/);
  assert.match(recoveryMigration, /'historical-recovery:approval:' \|\| p_application_id::text/);
  assert.match(recoveryMigration, /'approval_pdf_was_not_preserved', true/);
  assert.match(recoveryMigration, /'joining_information', 'unavailable'/);
  assert.match(recoveryMigration, /'document_settings', 'current_state_only'/);
  assert.match(recoveryMigration, /ON CONFLICT \(application_id, version_number\) DO NOTHING/);
  assert.doesNotMatch(recoveryMigration, /INSERT INTO public\.application_notifications/);
  assert.doesNotMatch(recoveryMigration, /UPDATE public\.applications/);
  assert.doesNotMatch(recoveryMigration, /INSERT INTO public\.application_payments/);
  assert.doesNotMatch(recoveryMigration, /UPDATE public\.application_fee_agreements/);
});

test('committed historical Version 1 recovery retains its original audit reconstruction behavior', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261031000006_historical_official_document_recovery.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /FROM public\.application_payments AS payment/);
  assert.match(migration, /payment\.created_at <= v_application\.approved_at/);
  assert.match(migration, /ROW_NUMBER\(\) OVER \([\s\S]+ORDER BY audit\.event_sequence DESC, audit\.id DESC/);
  assert.match(migration, /action <> 'deleted'/);
  assert.match(migration, /'historical-recovery:approval:' \|\| p_application_id::text/);
  assert.match(migration, /ON CONFLICT \(application_id, version_number\) DO NOTHING/);
  assert.doesNotMatch(migration, /UPDATE public\.applications|INSERT INTO public\.application_payments|DELETE FROM/);
});

test('historical recovery fixes are forward-only and preserve the committed migrations', async () => {
  const historicalMigration = await readFile(
    new URL('../supabase/migrations/20261031000006_historical_official_document_recovery.sql', import.meta.url),
    'utf8',
  );
  const forwardMigration = await readFile(
    new URL('../supabase/migrations/20261102000000_forward_historical_official_document_recovery.sql', import.meta.url),
    'utf8',
  );
  assert.match(historicalMigration, /create_historical_official_document_version_one/);
  assert.match(forwardMigration, /CREATE OR REPLACE FUNCTION public\.create_historical_official_document_version_one/);
  assert.match(forwardMigration, /FROM public\.application_payment_audit AS payment/);
  assert.match(forwardMigration, /Payment audit history contains duplicate creation events/);
  assert.match(forwardMigration, /Payment audit history contains an event after deletion/);
  assert.match(forwardMigration, /\[1-5\]\[0-9a-f\]\{3\}/);
  assert.match(forwardMigration, /REVOKE ALL ON FUNCTION public\.create_historical_official_document_version_one\(uuid\)/);
  assert.match(forwardMigration, /GRANT EXECUTE ON FUNCTION public\.create_historical_official_document_version_one\(uuid\)[\s\S]+TO service_role/);
  assert.match(forwardMigration, /BEGIN;[\s\S]+COMMIT;/);
  assert.doesNotMatch(forwardMigration, /CASCADE|DELETE FROM|TRUNCATE/);
});

test('payment audit baseline timestamp validation supports fresh and existing schemas', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261031000005_payment_document_audit_recovery.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /format_type\(attribute\.atttypid, attribute\.atttypmod\) = expected\.type_name/);
  assert.match(migration, /\('recorded_at', 'timestamp with time zone', true\)/);
  assert.match(migration, /\('created_at', 'timestamp with time zone', true\)/);
  assert.match(migration, /\('updated_at', 'timestamp with time zone', true\)/);
  assert.match(migration, /\('captured_at', 'timestamp with time zone', true\)/);
  assert.match(migration, /attribute\.atttypid <> 'timestamptz'::regtype/);
  assert.match(migration, /constraint_info\.confrelid = 'public\.applications'::regclass/);
  assert.match(migration, /constraint_info\.confdeltype = 'c'/);
  assert.match(migration, /constraint_info\.conkey = ARRAY\[local_column\.attnum\]::smallint\[\]/);
  assert.match(migration, /constraint_info\.confkey = ARRAY\[referenced_column\.attnum\]::smallint\[\]/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM public\.(applications|application_payments|application_payment_audit|official_document_issuances)|TRUNCATE/);
});

test('payment retirement migration conditionally revokes existing APIs without deleting retained records', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261105000004_disable_payment_operations.sql', import.meta.url),
    'utf8',
  );
  for (const signature of [
    'public.assert_payment_admin(uuid)',
    'public.create_application_payment(uuid,uuid,numeric,text,text,text,text)',
    'public.create_application_payment_idempotent(uuid,uuid,numeric,text,text,text,text,uuid)',
    'public.update_application_payment(uuid,uuid,numeric,text,text,text,text)',
    'public.delete_application_payment(uuid,uuid)',
    'public.enqueue_official_document_payment_version(uuid,text)',
    'public.build_official_document_snapshot_for_payment_event(uuid,uuid)',
    'public.create_historical_official_document_version_one(uuid)',
  ]) {
    assert.ok(migration.includes(`'${signature}'`));
  }
  for (const signature of [
    'public.set_application_agreed_fee(uuid,uuid,numeric,text)',
    'public.reconcile_payment_document_versions(uuid)',
    'public.snapshot_application_payment_identity()',
  ]) {
    assert.ok(migration.includes(`'${signature}'`));
  }
  assert.match(migration, /to_regprocedure\(function_signature\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /to_regclass\(format\('public\.%I', table_name\)\)/);
  assert.match(migration, /REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /application_fee_agreements/);
  assert.match(migration, /application_payment_audit/);
  assert.match(migration, /application_payment_historical_baseline/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /DROP|DELETE FROM|TRUNCATE|UPDATE public\./);
});

test('historical recovery logo loading rejects unsafe redirects and caps response bodies', async () => {
  const workerApi = await readFile(new URL('../worker-api.ts', import.meta.url), 'utf8');
  assert.match(workerApi, /redirect: 'manual'/);
  assert.match(workerApi, /isUnsafeHost/);
  assert.match(workerApi, /parsed\.protocol !== 'https:'/);
  assert.match(workerApi, /parsed\.username \|\| parsed\.password/);
  assert.match(workerApi, /getReader\(\)/);
  assert.match(workerApi, /total > 3 \* 1024 \* 1024/);
  assert.match(workerApi, /redirect <= 3/);
});

test('ready issuances reject missing PDF object keys without regeneration or mutation', async () => {
  const missingKeys = [
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'empty', value: '   ' },
  ];

  for (const { name, value } of missingKeys) {
    let r2Reads = 0;
    let r2Writes = 0;
    let databaseUpdates = 0;
    const issuance = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: applicationId,
      application_reference: student.applicationNumber,
      version_number: 1,
      status: 'ready',
      pdf_object_key: value,
      snapshot: { payment_summary: { status: 'pending', total_paid: 0, outstanding_balance: 13000 } },
    };
    const env = makeWorkerEnv({
      APPLICATION_MEDIA: {
        get: async () => {
          r2Reads += 1;
          return null;
        },
        put: async () => {
          r2Writes += 1;
        },
        delete: async () => undefined,
        list: async () => ({ objects: [] }),
      },
    });

    await withAdminFetch('admin', async (request, url) => {
      if (!url.pathname.endsWith('/official_document_issuances')) {
        throw new Error(`Unexpected request: ${url.pathname}`);
      }
      if (request.method === 'PATCH') databaseUpdates += 1;
      return Response.json([issuance]);
    }, async () => {
      const response = await handleApiRequest(
        authorizedRequest(`/api/admin/official-document/issued?application_id=${applicationId}&version=1`),
        env,
      );
      assert.equal(response.status, 500, name);
      assert.match(await response.text(), /marked ready.*missing or invalid/i, name);
    });

    assert.equal(r2Reads, 0, `${name}: R2 must not be read`);
    assert.equal(r2Writes, 0, `${name}: PDF generation must not write to R2`);
    assert.equal(databaseUpdates, 0, `${name}: issuance must not be updated`);
  }
});

test('regenerated issued PDFs omit the visible version label', async () => {
  const key = `official-documents/${applicationId}/v2-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
  let r2Writes = 0;
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async () => null,
      put: async () => {
        r2Writes += 1;
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });
  const issuance = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    application_id: applicationId,
    application_reference: student.applicationNumber,
    version_number: 2,
    issuance_type: 'approval',
    status: 'ready',
    pdf_object_key: key,
    snapshot: {
      version_number: 2,
      application: {
        id: applicationId,
        application_reference: student.applicationNumber,
        student_id: student.studentId,
        student_name: student.fullName,
        qualification: student.qualification,
        program_name: student.programName,
        email: student.email,
        mobile: student.mobile,
        date_of_birth: student.dateOfBirth,
        address: student.address,
      },
      program: { name: selectedCourse.name, duration: selectedCourse.duration },
      document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    },
  };

  await withAdminFetch('admin', async (_request, url) => {
    assert.ok(url.pathname.endsWith('/official_document_issuances'));
    return Response.json([issuance]);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/issued?application_id=${applicationId}&version=2`),
      env,
    );
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = decodePdfText(bytes);
    assert.match(text, /ADMISSION CONFIRMATION/);
    assert.match(text, /IELTS Preparation/);
    assert.doesNotMatch(text, /\b(?:document\s*)?version\s*[:#-]?\s*\d+\b/i);
  });

  assert.equal(r2Writes, 0);
});

test('ready issuance serves the immutable historical PDF from R2 without overwriting it', async () => {
  const key = `official-documents/${applicationId}/v1-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
  const storedPdf = Uint8Array.from(Buffer.from('%PDF-stored-immutable'));
  let r2Reads = 0;
  let r2Writes = 0;
  let databaseUpdates = 0;
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (requestedKey: string) => {
        assert.equal(requestedKey, key);
        r2Reads += 1;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(storedPdf);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'application/pdf' },
        };
      },
      put: async () => {
        r2Writes += 1;
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (request, url) => {
    if (!url.pathname.endsWith('/official_document_issuances')) {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
    if (request.method === 'PATCH') databaseUpdates += 1;
    return Response.json([{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: applicationId,
      application_reference: student.applicationNumber,
      version_number: 1,
      status: 'ready',
      pdf_object_key: key,
      snapshot: {
        application: {
          application_reference: student.applicationNumber,
          student_id: student.studentId,
          student_name: student.fullName,
          qualification: student.qualification,
          program_name: student.programName,
          email: student.email,
          mobile: student.mobile,
          date_of_birth: student.dateOfBirth,
          address: student.address,
        },
        program: { name: selectedCourse.name, duration: selectedCourse.duration },
        payment_summary: { total_paid: 98765, payments: [{ amount: 98765, reference_number: 'PRIVATE-REF' }] },
        document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      },
    }]);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/issued?application_id=${applicationId}&version=1`),
      env,
    );
    assert.equal(response.status, 200);
    const output = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(output, storedPdf);
  });

  assert.equal(r2Reads, 1);
  assert.equal(r2Writes, 0);
  assert.equal(databaseUpdates, 0);
});

test('missing historical payment-update PDFs fail visibly instead of regenerating a different document', async () => {
  const key = `official-documents/${applicationId}/v2-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
  let r2Reads = 0;
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async () => {
        r2Reads += 1;
        return null;
      },
      put: async () => assert.fail('historical payment document must not be overwritten'),
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (_request, url) => {
    if (!url.pathname.endsWith('/official_document_issuances')) {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return Response.json([{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: null,
      application_reference: student.applicationNumber,
      version_number: 2,
      issuance_type: 'payment_update',
      status: 'ready',
      pdf_object_key: key,
      snapshot: { application: { id: applicationId } },
    }]);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/issued?application_reference=${student.applicationNumber}&issuance_type=payment_update&version=2`),
      env,
    );
    assert.equal(response.status, 404);
    assert.match(await response.text(), /private file was not found/i);
  });

  assert.equal(r2Reads, 1);
});

test('historical payment fixtures preserve approval-time totals and exclude deleted FCF5 payments', () => {
  type AuditEvent = {
    paymentId: string;
    action: 'created' | 'updated' | 'deleted';
    amount?: number;
    sequence: number;
  };
  const reconstruct = (events: AuditEvent[]) => {
    const latest = new Map<string, AuditEvent>();
    for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
      latest.set(event.paymentId, event);
    }
    return [...latest.values()]
      .filter((event) => event.action !== 'deleted')
      .reduce((total, event) => total + (event.amount || 0), 0);
  };

  assert.equal(reconstruct([
    { paymentId: 'd622-cash', action: 'created', amount: 4000, sequence: 1 },
  ]), 4000);
  assert.equal(reconstruct([
    { paymentId: 'fcf5-upi-1', action: 'created', amount: 2000, sequence: 1 },
    { paymentId: 'fcf5-upi-1', action: 'updated', amount: 3000, sequence: 2 },
    { paymentId: 'fcf5-upi-1', action: 'deleted', sequence: 3 },
    { paymentId: 'fcf5-cash', action: 'created', amount: 5000, sequence: 4 },
  ]), 5000);
  assert.equal(10000 - 4000, 6000);
  assert.equal(10000 - 5000, 5000);
});

test('historical payment identity fixtures preserve null foreign keys and event semantics', async () => {
  const recoveryMigration = await readFile(
    new URL('../supabase/migrations/20261031000005_payment_document_audit_recovery.sql', import.meta.url),
    'utf8',
  );
  const historicalFixtures = [
    { application: 'UEA-2026-FCF5', action: 'created', paymentId: null, beforeData: null, afterDataId: 'payment-created' },
    { application: 'UEA-2026-FCF5', action: 'updated', paymentId: null, beforeData: null, afterDataId: 'payment-updated' },
    { application: 'UEA-2026-FCF5', action: 'deleted', paymentId: null, beforeData: 'payment-deleted', afterDataId: null },
    { application: 'UEA-2026-D622', action: 'created', paymentId: 'payment-one', beforeData: null, afterDataId: 'payment-one' },
    { application: 'UEA-2026-D622', action: 'created', paymentId: 'payment-two', beforeData: null, afterDataId: 'payment-two' },
  ];
  assert.equal(historicalFixtures.filter((event) => event.application === 'UEA-2026-FCF5').length, 3);
  assert.equal(historicalFixtures.filter((event) => event.application === 'UEA-2026-D622').length, 2);
  assert.equal(historicalFixtures.filter((event) => event.action === 'deleted').length, 1);
  assert.match(recoveryMigration, /action IN \('created', 'updated', 'deleted'\)/);
  assert.doesNotMatch(recoveryMigration, /action IN \('created', 'updated', 'deleted', 'fee_updated'\)/);
  assert.match(recoveryMigration, /WHERE action <> 'deleted'/);
  assert.match(recoveryMigration, /v_event_sequence <= v_baseline_watermark/);
  assert.match(recoveryMigration, /v_event_sequence > v_baseline_watermark/);
  assert.match(recoveryMigration, /latest_active_audit_payments/);
  assert.match(recoveryMigration, /eligible_baseline_payments/);
  assert.match(recoveryMigration, /event\.payment_id = baseline\.payment_id/);
});

test('historical payment event keys remain canonical and action-specific', async () => {
  const recoveryMigration = await readFile(
    new URL('../supabase/migrations/20261031000005_payment_document_audit_recovery.sql', import.meta.url),
    'utf8',
  );
  assert.match(recoveryMigration, /payment-audit:' \|\| v_audit_id::text/);
  assert.match(recoveryMigration, /v_action = 'created' AND after_data->>'created_at'/);
  assert.match(recoveryMigration, /v_action = 'updated' AND after_data->>'updated_at'/);
  assert.match(recoveryMigration, /v_action = 'deleted' AND COALESCE/);
  assert.match(recoveryMigration, /IF v_candidate_count <> 1 THEN/);
});

test('historical payment recovery preserves approval data and handles legacy, audited, and deleted payments', async () => {
  const recoveryMigration = await readFile(
    new URL('../supabase/migrations/20261031000005_payment_document_audit_recovery.sql', import.meta.url),
    'utf8',
  );
  const documentMigration = await readFile(
    new URL('../supabase/migrations/20261031000004_official_document_payment_versions.sql', import.meta.url),
    'utf8',
  );
  assert.match(recoveryMigration, /AND action IN \('created', 'updated', 'deleted'\)/);
  assert.match(recoveryMigration, /WHERE action <> 'deleted'/);
  assert.match(recoveryMigration, /v_total_payable_text := NULLIF\(v_snapshot->'payment_summary'->>'total_payable'/);
  assert.match(recoveryMigration, /Approval issuance snapshot contains an invalid payable amount/);
  assert.match(documentMigration, /v_total_payable := COALESCE\(v_agreement\.agreed_total, v_fee\.final_payable\)/);
  assert.match(documentMigration, /'agreed_total', v_agreement\.agreed_total/);
  assert.match(documentMigration, /'final_payable', v_fee\.final_payable/);
});

test('payment mutation RPCs lock the application before payment and audit writes', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261026000001_manual_payment_functions.sql', import.meta.url),
    'utf8',
  );
  const idempotentMigration = await readFile(
    new URL('../supabase/migrations/20261031000004_official_document_payment_versions.sql', import.meta.url),
    'utf8',
  );
  for (const functionName of [
    'update_application_payment',
    'delete_application_payment',
  ]) {
    const functionBody = migration.slice(
      migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`),
      migration.indexOf('$$;', migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`)),
    );
    assert.match(functionBody, /FROM public\.applications[\s\S]+FOR UPDATE/);
    assert.match(functionBody, /INSERT INTO public\.application_payment_audit/);
  }
  const idempotentCreateBody = idempotentMigration.slice(
    idempotentMigration.indexOf('CREATE OR REPLACE FUNCTION public.create_application_payment_idempotent'),
    idempotentMigration.indexOf('$$;', idempotentMigration.indexOf('CREATE OR REPLACE FUNCTION public.create_application_payment_idempotent')),
  );
  assert.match(idempotentCreateBody, /FROM public\.applications[\s\S]+FOR UPDATE/);
  assert.match(idempotentCreateBody, /INSERT INTO public\.application_payment_audit/);
});
