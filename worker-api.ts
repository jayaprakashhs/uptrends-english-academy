import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  generatePaymentReceiptPdf,
  generateOfficialPdf,
  isValidOfficialDocumentSettings,
  mergeOfficialDocumentSettings,
  type OfficialCourse,
  type OfficialDocumentSettings,
  type OfficialPaymentRecord,
} from './official-document';
import {
  legacyUploadFilenameFromMetadata,
  managedR2ObjectKeyFromMetadata,
  MAX_APPLICATION_PHOTO_BYTES,
} from './application-photo-storage';
import type { R2BucketBinding } from './worker-r2';
import { validateDemoClassRequest } from './demo-class-request';
import { getApplicationPrimaryContact, validateApplicationCategoryFields } from './application-request';
import {
  isValidContactEmail,
  normalizeContactEmail,
  normalizeIndianMobileNumber,
} from './contact-validation';
import { renderBrandedEmail, type EmailBranding, type EmailContent } from './email-template';

interface Env {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APPLICATION_MEDIA?: R2BucketBinding;
  PUBLIC_MEDIA?: R2BucketBinding;
  CLOUDFLARE_R2_PUBLIC_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  APPLICATION_NOTIFICATION_EMAIL?: string;
  ASSETS?: { fetch: typeof fetch };
}

interface AdminProfile {
  id: string;
  full_name: string;
  role: 'staff' | 'admin' | 'super_admin';
  is_active: boolean;
}

interface ImagePayload {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/x-icon';
}

const MAX_JSON_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_BRANDING_IMAGE_BYTES = 1024 * 1024;
const MAX_BRANDING_LOGO_HERO_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PASSPORT_BYTES = MAX_APPLICATION_PHOTO_BYTES;
const ROLE_RANK: Record<string, number> = { staff: 1, admin: 2, super_admin: 3 };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABOUT_US_OBJECT_KEY_PATTERN = /^about-us\/(?:instructors|video-posters)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });

const errorResponse = (error: string, status: number, headers: Record<string, string> = {}) =>
  json({ error }, status, headers);

const getSupabaseUrl = (env: Env): string => env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';

const logBindingPresence = (env: Env): void => {
  console.info(JSON.stringify({
    event: 'worker_binding_presence',
    bindings: {
      SUPABASE_URL: Boolean(env.SUPABASE_URL),
      VITE_SUPABASE_URL: Boolean(env.VITE_SUPABASE_URL),
      VITE_SUPABASE_ANON_KEY: Boolean(env.VITE_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
      RESEND_FROM_EMAIL: Boolean(env.RESEND_FROM_EMAIL),
      APPLICATION_MEDIA: Boolean(env.APPLICATION_MEDIA),
      PUBLIC_MEDIA: Boolean(env.PUBLIC_MEDIA),
      CLOUDFLARE_R2_PUBLIC_URL: Boolean(env.CLOUDFLARE_R2_PUBLIC_URL),
      ASSETS: Boolean(env.ASSETS),
    },
  }));
};

const logApiDiagnostic = (
  operation: string,
  errorCategory: string,
  bindingNames?: string[],
  bindingIssue: 'missing' | 'invalid' = 'missing',
): void => {
  console.error(JSON.stringify({
    event: 'api_diagnostic',
    operation,
    error_category: errorCategory,
    ...(bindingNames
      ? { [bindingIssue === 'missing' ? 'missing_bindings' : 'invalid_bindings']: bindingNames }
      : {}),
  }));
};

const getSupabaseClient = (
  env: Env,
  privileged = false,
  operation = 'supabase.request',
): SupabaseClient | null => {
  const url = getSupabaseUrl(env);
  const key = privileged ? env.SUPABASE_SERVICE_ROLE_KEY || '' : env.VITE_SUPABASE_ANON_KEY || '';
  const missingBindings: string[] = [];
  if (!url) {
    missingBindings.push('SUPABASE_URL', 'VITE_SUPABASE_URL');
  }
  if (!key) {
    missingBindings.push(privileged ? 'SUPABASE_SERVICE_ROLE_KEY' : 'VITE_SUPABASE_ANON_KEY');
  }
  if (missingBindings.length) {
    logApiDiagnostic(operation, 'missing_configuration', missingBindings);
    return null;
  }

  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    logApiDiagnostic(operation, 'invalid_configuration');
    return null;
  }
};

interface IntegrationHealth {
  configured: boolean;
  connected: boolean;
  error_category?: string | null;
}

const supabaseErrorCategory = (error: unknown): string => {
  const details = error as { code?: unknown; message?: unknown };
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';
  if (code === '42501') return 'permission_denied';
  if (code === 'PGRST301' || /invalid (api )?key|invalid jwt/i.test(message)) return 'authentication_failed';
  if (code === '42P01' || code === 'PGRST205') return 'schema_mismatch';
  return 'database_query_failed';
};

const checkSupabaseHealth = async (env: Env): Promise<IntegrationHealth> => {
  const configured = Boolean(getSupabaseUrl(env) && env.SUPABASE_SERVICE_ROLE_KEY);
  const client = getSupabaseClient(env, true, 'system_status.supabase');
  if (!client) return { configured, connected: false, error_category: configured ? 'invalid_configuration' : 'missing_configuration' };
  try {
    const { error } = await client.from('site_branding').select('id').limit(1).abortSignal(AbortSignal.timeout(5000));
    if (error) return { configured: true, connected: false, error_category: supabaseErrorCategory(error) };
    return { configured: true, connected: true, error_category: null };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'service_unreachable',
    };
  }
};

const checkResendHealth = async (env: Env): Promise<IntegrationHealth> => {
  if (!env.RESEND_API_KEY) {
    logApiDiagnostic('system_status.resend', 'missing_configuration', ['RESEND_API_KEY']);
    return { configured: false, connected: false, error_category: 'missing_configuration' };
  }
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return { configured: true, connected: true, error_category: null };
    return {
      configured: true,
      connected: false,
      error_category: response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'permission_denied' : 'service_error',
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'service_unreachable',
    };
  }
};

const checkR2Health = async (env: Env): Promise<IntegrationHealth> => {
  let publicUrlIsValid = false;
  try {
    publicUrlIsValid = new URL(env.CLOUDFLARE_R2_PUBLIC_URL || '').protocol === 'https:';
  } catch {
    publicUrlIsValid = false;
  }
  if (!env.APPLICATION_MEDIA || !env.PUBLIC_MEDIA || !publicUrlIsValid) {
    const missingBindings = [
      ...(!env.APPLICATION_MEDIA ? ['APPLICATION_MEDIA'] : []),
      ...(!env.PUBLIC_MEDIA ? ['PUBLIC_MEDIA'] : []),
      ...(!env.CLOUDFLARE_R2_PUBLIC_URL ? ['CLOUDFLARE_R2_PUBLIC_URL'] : []),
    ];
    const invalidBindings = [
      ...(env.CLOUDFLARE_R2_PUBLIC_URL && !publicUrlIsValid ? ['CLOUDFLARE_R2_PUBLIC_URL'] : []),
    ];
    logApiDiagnostic(
      'system_status.r2_storage',
      'missing_or_invalid_configuration',
      missingBindings.length ? missingBindings : invalidBindings.length ? invalidBindings : undefined,
      missingBindings.length ? 'missing' : 'invalid',
    );
    return { configured: false, connected: false, error_category: 'missing_or_invalid_configuration' };
  }
  try {
    await Promise.all([
      env.APPLICATION_MEDIA.list({ limit: 1 }),
      env.PUBLIC_MEDIA.list({ limit: 1 }),
    ]);
    return { configured: true, connected: true, error_category: null };
  } catch {
    return {
      configured: true,
      connected: false,
      error_category: 'storage_unreachable',
    };
  }
};

const getBearerToken = (request: Request): string | null => {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1]?.trim() || null;
};

const requireAdmin = async (
  request: Request,
  env: Env,
  minimumRole: AdminProfile['role'] = 'staff',
): Promise<{ profile: AdminProfile; supabase: SupabaseClient } | Response> => {
  const supabase = getSupabaseClient(env, true, 'admin.authentication');
  if (!supabase) return errorResponse('Admin APIs are unavailable because Supabase service credentials are not configured.', 503);

  const token = getBearerToken(request);
  if (!token) return errorResponse('Unauthorized: Session Bearer token required.', 401);

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized: Invalid or expired authentication session.', 401);

    const { data: profile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('id, full_name, role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) return errorResponse(`Unable to verify admin profile: ${profileError.message}`, 500);
    if (!profile) return errorResponse('Forbidden: No authorized admin profile linked to this user.', 403);
    if (!profile.is_active) return errorResponse('Forbidden: This admin account has been deactivated.', 403);
    if ((ROLE_RANK[profile.role] || 0) < ROLE_RANK[minimumRole]) {
      return errorResponse(`Forbidden: This operation requires '${minimumRole}' role privileges.`, 403);
    }

    return { profile: profile as AdminProfile, supabase };
  } catch (error) {
    return errorResponse(`Authentication verification error: ${messageOf(error)}`, 500);
  }
};

const messageOf = (error: unknown): string => error instanceof Error ? error.message : 'Unexpected server error.';

const parseJson = async (request: Request): Promise<Record<string, unknown> | Response> => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_JSON_BYTES) return errorResponse('Request body exceeds the 15 MB limit.', 413);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) return errorResponse('Request body exceeds the 15 MB limit.', 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse('A JSON object request body is required.', 400);
    return parsed as Record<string, unknown>;
  } catch {
    return errorResponse('Request body must contain valid JSON.', 400);
  }
};

const requiredString = (value: unknown, field: string, maxLength = 2000): string | Response => {
  if (typeof value !== 'string' || !value.trim()) return errorResponse(`${field} is required.`, 400);
  const result = value.trim();
  if (result.length > maxLength) return errorResponse(`${field} must be ${maxLength} characters or fewer.`, 400);
  return result;
};

const optionalString = (value: unknown, field: string, maxLength = 5000): string | null | Response => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return errorResponse(`${field} must be a string.`, 400);
  const result = value.trim();
  return result.length > maxLength ? errorResponse(`${field} must be ${maxLength} characters or fewer.`, 400) : result || null;
};

const isResponse = (value: unknown): value is Response => value instanceof Response;

const isAboutUsObjectKey = (value: unknown): value is string =>
  typeof value === 'string' && ABOUT_US_OBJECT_KEY_PATTERN.test(value);

const readAboutUsAsset = async (
  env: Env,
  objectKey: string,
  isPublic: boolean,
): Promise<Response> => {
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket?.get) return errorResponse('Private application R2 storage is not configured.', 503);

  if (isPublic) {
    const supabase = getSupabaseClient(env, false, 'public.about_us_asset.read');
    if (!supabase) return errorResponse('Supabase is not configured.', 503);
    const isInstructorPhoto = objectKey.startsWith('about-us/instructors/');
    const { data, error } = isInstructorPhoto
      ? await supabase
        .from('team_members')
        .select('id')
        .eq('photo_object_key', objectKey)
        .eq('is_published', true)
        .limit(1)
        .maybeSingle()
      : await supabase
        .from('about_us_video_configurations')
        .select('id')
        .eq('poster_object_key', objectKey)
        .eq('is_published', true)
        .limit(1)
        .maybeSingle();
    if (error) return errorResponse('Unable to verify published About Us image access.', 500);
    if (!data) return errorResponse('Image not found.', 404);
  }

  try {
    const object = await bucket.get(objectKey);
    if (!object?.body) return errorResponse('Image not found.', 404);
    const contentType = object.httpMetadata?.contentType;
    if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return errorResponse('Stored image has invalid content metadata.', 500);
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Unable to read About Us image from R2.', {
      operation: isPublic ? 'public.about_us_asset.read' : 'admin.about_us_asset.preview',
      error_category: 'r2_read_failed',
    });
    return errorResponse('Unable to read the image from R2.', 502);
  }
};

const uploadAboutUsAsset = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket) return errorResponse('Private application R2 storage is not configured.', 503);

  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.asset_type !== 'instructor' && body.asset_type !== 'poster') {
    return errorResponse('Asset type must be instructor or poster.', 400);
  }
  const image = decodeImage(body.image_file_base64, MAX_MEDIA_BYTES);
  if (isResponse(image)) return image;

  const folder = body.asset_type === 'instructor' ? 'instructors' : 'video-posters';
  const extension = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
  const objectKey = `about-us/${folder}/${crypto.randomUUID()}.${extension}`;
  try {
    await bucket.put(objectKey, image.bytes, { httpMetadata: { contentType: image.mime } });
  } catch {
    return errorResponse('R2 image upload failed.', 502);
  }
  return json({ object_key: objectKey, content_type: image.mime, size_bytes: image.bytes.byteLength });
};

const deleteAboutUsAsset = async (env: Env, supabase: SupabaseClient, objectKey: string): Promise<Response> => {
  const [instructorReference, videoReference] = await Promise.all([
    supabase.from('team_members').select('id').eq('photo_object_key', objectKey).limit(1),
    supabase.from('about_us_video_configurations').select('id').eq('poster_object_key', objectKey).limit(1),
  ]);
  if (instructorReference.error || videoReference.error) {
    return errorResponse('Unable to verify whether the image is still in use.', 500);
  }
  if ((instructorReference.data?.length || 0) > 0 || (videoReference.data?.length || 0) > 0) {
    return errorResponse('The image is still referenced by About Us content.', 409);
  }

  const bucket = env.APPLICATION_MEDIA;
  if (!bucket) return errorResponse('Private application R2 storage is not configured.', 503);
  try {
    await bucket.delete(objectKey);
    return json({ success: true });
  } catch {
    return errorResponse('R2 image deletion failed.', 502);
  }
};

const withApplicationErasureWriteLease = async <T>(
  supabase: SupabaseClient,
  applicationId: string,
  operation: () => Promise<T>,
): Promise<T | Response> => {
  const { data: leaseId, error: leaseError } = await supabase.rpc(
    'acquire_application_erasure_write_lease',
    { p_application_id: applicationId },
  );
  if (leaseError || typeof leaseId !== 'string') {
    if (leaseError?.message.includes('application_erasure_in_progress')) {
      return errorResponse('Application deletion is in progress; this operation is blocked.', 409);
    }
    if (leaseError?.message.includes('application_not_found')) {
      return errorResponse('Application not found.', 404);
    }
    return errorResponse('Unable to reserve the application for this document operation.', 503);
  }

  let result!: T;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  const { error: releaseError } = await supabase.rpc(
    'release_application_erasure_write_lease',
    { p_lease_id: leaseId },
  );
  if (releaseError) {
    console.error('Unable to release an application document write lease.', {
      operation: 'application_erasure.write_lease.release',
      error_code: releaseError.code || 'database_query_failed',
    });
    if (operationError) throw operationError;
    return errorResponse(
      'The document operation completed, but its storage lease could not be released. Retry after the lease expires.',
      503,
    );
  }
  if (operationError) throw operationError;
  return result;
};
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
const validId = (value: string) => UUID_PATTERN.test(value);

const contactAcknowledgement = () => json({
  success: true,
  message: 'We received your request. If it can be processed, the academy will contact you.',
}, 202);

const duplicateContactResponse = () => errorResponse('A request using this email or mobile already exists for this form.', 409);

const isDuplicateContactError = (
  error: { code?: string; message?: string } | null | undefined,
): boolean => error?.code === '23505' && error.message === 'duplicate_contact';

const checkContactDuplicates = async (
  supabase: SupabaseClient,
  sourceTable: 'applications' | 'demo_class_requests' | 'callback_requests',
  email: string | null,
  mobile: string | null,
): Promise<boolean | Response> => {
  try {
    const { data, error } = await supabase.rpc('check_application_contact_duplicate', {
      p_source_table: sourceTable,
      p_email: email,
      p_mobile: mobile,
    });
    if (!error && typeof data === 'boolean') return data;
    console.error('Unable to verify submitted contact information.', {
      operation: 'application_contact_duplicate_check',
      error_code: error?.code || 'invalid_response',
    });
  } catch {
    console.error('Unable to verify submitted contact information.', {
      operation: 'application_contact_duplicate_check',
      error_code: 'request_failed',
    });
  }
  return errorResponse('Contact verification is temporarily unavailable. Please try again.', 503);
};

const decodeImage = (
  value: unknown,
  maxBytes: number,
  allowIcon = false,
): ImagePayload | Response => {
  if (typeof value !== 'string') return errorResponse('An image data URL is required.', 400);
  const allowedTypes = allowIcon
    ? 'jpeg|png|webp|x-icon|vnd\\.microsoft\\.icon'
    : 'jpeg|png|webp';
  const match = new RegExp(
    `^data:(image/(?:${allowedTypes}));base64,([A-Za-z0-9+/]+={0,2})$`,
    'i',
  ).exec(value);
  if (!match) return errorResponse('Invalid image upload. Please use a supported image file.', 400);

  try {
    const binary = atob(match[2]);
    if (!binary.length) return errorResponse('The uploaded image is empty.', 400);
    if (binary.length > maxBytes) {
      const size = maxBytes === MAX_PASSPORT_BYTES ? `${(binary.length / 1024).toFixed(1)} KB` : `${(binary.length / (1024 * 1024)).toFixed(1)} MB`;
      return errorResponse(maxBytes === MAX_PASSPORT_BYTES
        ? `Passport photograph exceeds 300 KB limit (${size}). Please compress or choose a smaller image.`
        : maxBytes === MAX_BRANDING_IMAGE_BYTES || maxBytes === MAX_BRANDING_LOGO_HERO_IMAGE_BYTES
          ? `Branding images must be ${maxBytes / (1024 * 1024)} MB or smaller.`
          : 'Photo upload exceeds 5 MB limit.', 400);
    }

    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const detectedMime = match[1].toLowerCase();
    const mime: ImagePayload['mime'] =
      detectedMime === 'image/x-icon' || detectedMime === 'image/vnd.microsoft.icon'
        ? 'image/x-icon'
        : detectedMime as ImagePayload['mime'];
    const signatureIsValid = mime === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
      : mime === 'image/png'
        ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        : mime === 'image/x-icon'
          ? bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0
          : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    if (!signatureIsValid) return errorResponse('Image contents do not match the declared file type.', 400);
    return { bytes, mime };
  } catch {
    return errorResponse('The image data is not valid base64.', 400);
  }
};

const bucketForPrefix = (
  env: Env,
  prefix: 'applications' | 'branding' | 'demo-class-requests' | 'media' | 'programs' | 'official-document-assets' | 'official-documents',
): R2BucketBinding | undefined =>
  prefix === 'applications' ||
  prefix === 'demo-class-requests' ||
  prefix === 'official-document-assets' ||
  prefix === 'official-documents'
    ? env.APPLICATION_MEDIA
    : env.PUBLIC_MEDIA;

function uploadToR2(env: Env, image: ImagePayload, prefix: 'applications'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'demo-class-requests'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'official-document-assets'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'branding' | 'media' | 'programs'): Promise<{ key: string; url: string } | Response>;
async function uploadToR2(
  env: Env,
  image: ImagePayload,
  prefix: 'applications' | 'branding' | 'demo-class-requests' | 'media' | 'programs' | 'official-document-assets',
): Promise<{ key: string; url?: string } | Response> {
  const bucket = bucketForPrefix(env, prefix);
  const publicUrl = env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/, '');
  const isPrivatePrefix = prefix === 'applications' ||
    prefix === 'demo-class-requests' ||
    prefix === 'official-document-assets';

  if (!bucket) {
    return errorResponse(isPrivatePrefix
      ? 'Private application photo storage is not configured.'
      : 'Public R2 media storage is not configured.', 503);
  }

  if (
    !isPrivatePrefix &&
    (!publicUrl || !URL.canParse(publicUrl) || new URL(publicUrl).protocol !== 'https:')
  ) {
    return errorResponse('A valid HTTPS R2 public URL is not configured, so uploaded images cannot be served.', 503);
  }

  const extension = image.mime === 'image/png'
  ? 'png'
  : image.mime === 'image/webp'
    ? 'webp'
    : image.mime === 'image/x-icon'
      ? 'ico'
      : 'jpg';
  const key = `${prefix}/${crypto.randomUUID()}.${extension}`;

  try {
    await bucket.put(key, image.bytes, { httpMetadata: { contentType: image.mime } });
    return isPrivatePrefix
      ? { key }
      : { key, url: `${publicUrl}/${key}` };
  } catch (error) {
    return errorResponse(`R2 upload failed: ${messageOf(error)}`, 502);
  }
}

const deleteFromR2 = async (
  env: Env,
  key: string,
  prefix: 'applications' | 'branding' | 'media' | 'programs' | 'official-document-assets' | 'official-documents',
): Promise<void> => {
  const validPrivateKey = prefix === 'official-document-assets'
    ? /^official-document-assets\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)
    : prefix === 'official-documents'
      ? /^official-documents\/[0-9a-f-]+\.pdf$/i.test(key)
      : false;
  const validExistingKey = prefix !== 'official-document-assets' &&
    prefix !== 'official-documents' &&
    managedR2ObjectKeyFromMetadata(key, undefined, prefix) === key;
  if (!validPrivateKey && !validExistingKey) {
    throw new Error('R2 object key is invalid.');
  }
  const bucket = bucketForPrefix(env, prefix);
  if (!bucket) throw new Error('R2 storage is not configured.');
  await bucket.delete(key);
};

const objectKeyFromMetadata = (
  env: Env,
  value: unknown,
  expectedPrefix: 'applications' | 'branding' | 'media' | 'programs',
): string | null => {
  return managedR2ObjectKeyFromMetadata(value, env.CLOUDFLARE_R2_PUBLIC_URL, expectedPrefix);
};

const extractYouTubeVideoId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (!['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : ['embed', 'shorts', 'live', 'v'].includes(segments[0] || '') ? segments[1] : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
};

const safeYouTube = (value: unknown): { url: string; id: string } | null => {
  const id = extractYouTubeVideoId(value);
  return id ? { url: `https://www.youtube.com/watch?v=${id}`, id } : null;
};

interface EmailAttachment {
  filename: string;
  content: string;
}

interface ApprovalEmail {
  to: string;
  subject: string;
  content: EmailContent;
  attachments: EmailAttachment[];
}

const buildApprovalEmail = (
  snapshotValue: unknown,
  pdfBytes: Uint8Array,
): ApprovalEmail | Response => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || Array.isArray(snapshotValue)) {
    return errorResponse('The saved official document snapshot is invalid.', 500);
  }
  const snapshot = snapshotValue as Record<string, unknown>;
  const application = snapshot.application;
  if (!application || typeof application !== 'object' || Array.isArray(application)) {
    return errorResponse('The saved official document snapshot is missing student details.', 500);
  }
  const student = application as Record<string, unknown>;
  if (typeof student.email !== 'string' || !student.email.trim() ||
    typeof student.student_name !== 'string' || !student.student_name.trim() ||
    typeof student.program_name !== 'string' || !student.program_name.trim() ||
    typeof student.application_reference !== 'string' || !student.application_reference.trim() ||
    typeof student.student_id !== 'string' || !student.student_id.trim()) {
    return errorResponse('The saved official document snapshot is missing required approval email details.', 500);
  }

  return {
    to: student.email,
    subject: "Congratulations! Your Application Has Been Approved — Uptrend's English Academy",
    content: {
      title: 'Application Approved',
      greeting: student.student_name,
      paragraphs: [
        `Your application to Uptrend's English Academy for ${student.program_name} has been approved.`,
        'Please find your official admission approval document attached.',
      ],
      status: 'Approved',
      details: [
        { label: 'Application Number', value: student.application_reference },
        { label: 'Student ID', value: student.student_id },
        { label: 'Program', value: student.program_name },
      ],
    },
    attachments: [{
      filename: `Official_Document_${student.application_reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`,
      content: toBase64(pdfBytes),
    }],
  };
};

const buildPaymentUpdateEmail = (
  snapshotValue: unknown,
  pdfBytes: Uint8Array,
  versionNumber: number,
): ApprovalEmail | Response => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || Array.isArray(snapshotValue)) {
    return errorResponse('The saved payment document snapshot is invalid.', 500);
  }
  const snapshot = snapshotValue as Record<string, any>;
  const student = snapshot.application;
  const summary = snapshot.payment_summary;
  if (!student || typeof student !== 'object' ||
    typeof student.email !== 'string' || !student.email.trim() ||
    typeof student.student_name !== 'string' ||
    typeof student.application_reference !== 'string') {
    return errorResponse('The saved payment snapshot is missing the applicant email or reference.', 500);
  }
  if (!summary || typeof summary !== 'object') {
    return errorResponse('The saved payment snapshot is missing its payment summary.', 500);
  }
  const totalPaid = Number(summary.total_paid);
  if (!Number.isFinite(totalPaid) || totalPaid < 0) {
    return errorResponse('The saved payment snapshot has an invalid total.', 500);
  }
  const formattedTotalPaid = `INR ${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const reference = student.application_reference.replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    to: student.email,
    subject: `Payment record updated — Uptrend's English Academy`,
    content: {
      title: 'Payment Record Updated',
      greeting: student.student_name,
      paragraphs: [
        `Your payment record for application ${student.application_reference} has been updated.`,
        `Total recorded: ${formattedTotalPaid}.`,
        `The latest official document, Version ${versionNumber}, is attached.`,
      ],
      details: [{ label: 'Application Number', value: student.application_reference }],
    },
    attachments: [{
      filename: `Official_Document_V${versionNumber}_${reference}.pdf`,
      content: toBase64(pdfBytes),
    }],
  };
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const sendEmail = async (
  env: Env,
  message: {
    to: string;
    subject: string;
    content: EmailContent;
    attachments?: EmailAttachment[];
    idempotencyKey?: string;
  },
): Promise<{ success: boolean; error?: string; provider_message_id: string | null }> => {
  if (!env.RESEND_API_KEY) return { success: false, error: 'RESEND_API_KEY is not configured.', provider_message_id: null };

  try {
    const brandingClient = getSupabaseClient(env, true, 'email.branding.read');
    let branding: EmailBranding = { publicAssetBaseUrl: env.CLOUDFLARE_R2_PUBLIC_URL };
    if (brandingClient) {
      try {
        const { data, error } = await brandingClient
          .from('site_branding')
          .select('academy_name,logo_url,primary_green,primary_orange')
          .limit(1)
          .maybeSingle();
        if (error) {
          console.error('Email branding could not be loaded; using the academy name fallback.', {
            operation: 'email.branding.read',
            error_code: error.code || 'database_query_failed',
          });
        } else if (data) {
          branding = {
            academyName: data.academy_name,
            logoUrl: data.logo_url,
            primaryGreen: data.primary_green,
            primaryOrange: data.primary_orange,
            publicAssetBaseUrl: env.CLOUDFLARE_R2_PUBLIC_URL,
          };
        }
      } catch (error) {
        console.error('Email branding could not be loaded; using the academy name fallback.', {
          operation: 'email.branding.read',
          error: messageOf(error),
        });
      }
    }
    const rendered = renderBrandedEmail(message.content, branding);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'admissions@uptrendsacademy.com',
        to: message.to,
        subject: message.subject,
        html: rendered.html,
        text: rendered.text,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      }),
    });
    const data = await response.json() as { id?: string; message?: string; error?: { message?: string } };
    if (!response.ok) {
      return { success: false, error: data.message || data.error?.message || `Resend returned HTTP ${response.status}.`, provider_message_id: null };
    }
    return { success: true, provider_message_id: data.id || null };
  } catch (error) {
    return { success: false, error: messageOf(error), provider_message_id: null };
  }
};

interface RequestEmailMessage {
  notification_type: 'applicant_confirmation' | 'academy_notification';
  recipient_email: string;
  subject: string;
  content: EmailContent;
}

const sendRequestEmails = async (
  env: Env,
  messages: RequestEmailMessage[],
): Promise<void> => {
  await Promise.all(messages.map(async (message) => {
    const emailResult = await sendEmail(env, {
      to: message.recipient_email,
      subject: message.subject,
      content: message.content,
    });
    if (!emailResult.success) {
      console.error('Request email delivery failed.', {
        operation: `request.${message.notification_type}`,
        error: emailResult.error || 'Resend did not confirm delivery.',
      });
    }
  }));
};

type PrivateR2Object = {
  bytes: Uint8Array;
  mime: string;
};

const readPrivateR2Object = async (
  env: Env,
  key: string,
  expectedPrefix: 'applications' | 'official-document-assets' | 'official-documents',
): Promise<PrivateR2Object | Response> => {
  const validKey = expectedPrefix === 'applications'
    ? /^applications\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)
    : expectedPrefix === 'official-document-assets'
      ? /^official-document-assets\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)
      : /^official-documents\/(?:[0-9a-f-]+\.pdf|[0-9a-f-]+\/(?:v[0-9]+-[0-9a-f-]+|receipt(?:-v2)?-[0-9a-f-]+)\.pdf)$/i.test(key);
  if (!validKey) return errorResponse('Private document storage metadata is invalid.', 500);
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket?.get) return errorResponse('Private document storage is not configured.', 503);

  try {
    const object = await bucket.get(key);
    if (!object?.body) return errorResponse('The requested private file was not found.', 404);
    const mime = object.httpMetadata?.contentType || '';
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
      return errorResponse('The requested private file is empty or exceeds the size limit.', 502);
    }
    if (expectedPrefix === 'official-documents' && mime !== 'application/pdf') {
      return errorResponse('The stored official PDF has an invalid content type.', 502);
    }
    if (expectedPrefix !== 'official-documents' &&
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      return errorResponse('The stored image has an unsupported content type.', 502);
    }
    return { bytes, mime };
  } catch (error) {
    console.error('Unable to retrieve a private official document asset.', {
      operation: 'official_document.private_r2_read',
      error: messageOf(error),
    });
    return errorResponse('Unable to retrieve a private official document asset.', 502);
  }
};

const loadOfficialDocumentSettings = async (
  supabase: SupabaseClient,
): Promise<OfficialDocumentSettings | Response> => {
  const { data, error } = await supabase
    .from('official_document_settings')
    .select('document_data')
    .eq('setting_key', 'admission_approval')
    .maybeSingle();
  if (error) {
    console.error('Official document settings query failed.', {
      operation: 'official_document.settings.read',
      error_code: error.code || 'database_query_failed',
    });
    return errorResponse('Official document settings could not be loaded from Supabase.', 503);
  }
  const settings = mergeOfficialDocumentSettings(data?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('Saved official document settings are invalid. Review and save them in the admin panel.', 503);
  return settings;
};

const courseFromSnapshot = (snapshot: Record<string, any>): OfficialCourse | null => {
  const program = snapshot.program;
  if (!program || typeof program !== 'object' || !String(program.name || '').trim()) return null;
  return {
    name: String(program.name),
    duration: typeof program.duration === 'string' ? program.duration : null,
    mode: typeof program.mode === 'string' ? program.mode : null,
    level: typeof program.level === 'string' ? program.level : null,
  };
};

type PaymentReceiptContext = {
  application: Record<string, any>;
  payment: Record<string, any>;
  settings: OfficialDocumentSettings;
  course: OfficialCourse | null;
  logo?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
  totalPaid: number;
};

const loadPaymentReceiptContext = async (
  supabase: SupabaseClient,
  env: Env,
  paymentId: string,
): Promise<PaymentReceiptContext | Response> => {
  const { data: payment, error: paymentError } = await supabase
    .from('application_payments')
    .select('id,application_id,application_reference,student_id,student_name,student_email,student_mobile,student_qualification,student_qualification_category,student_parent_phone,student_parent_email,student_date_of_birth,student_address,student_school_name,student_college_name,student_occupation,student_place,student_city,program_name,course_duration,course_mode,course_level,receipt_object_key,amount,payment_method,payment_stage,recorded_at,reference_number,notes')
    .eq('id', paymentId)
    .maybeSingle();
  if (paymentError || !payment) return errorResponse('Payment record not found.', 404);

  if (payment.application_id) {
    const { data: activeApplication, error: applicationError } = await supabase
      .from('applications')
      .select('status')
      .eq('id', payment.application_id)
      .maybeSingle();
    if (applicationError) return errorResponse('Unable to verify the payment application status.', 500);
    if (activeApplication && activeApplication.status !== 'Accepted') {
      return errorResponse('Receipts are available only for approved students.', 409);
    }
    if (!activeApplication) return errorResponse('Payment application link is inconsistent.', 409);
  }
  const application = {
    id: payment.application_id,
    application_reference: payment.application_reference,
    student_id: payment.student_id,
    student_name: payment.student_name,
    email: payment.student_email,
    mobile: payment.student_mobile,
    qualification: payment.student_qualification,
    qualification_category: payment.student_qualification_category,
    parent_phone: payment.student_parent_phone,
    parent_email: payment.student_parent_email,
    date_of_birth: payment.student_date_of_birth,
    address: payment.student_address,
    school_name: payment.student_school_name,
    college_name: payment.student_college_name,
    occupation: payment.student_occupation,
    place: payment.student_place,
    city: payment.student_city,
    program_name: payment.program_name,
  };
  if (typeof application.application_reference !== 'string' ||
    typeof application.student_name !== 'string' ||
    typeof application.program_name !== 'string') {
    return errorResponse('The saved payment identity snapshot is incomplete.', 409);
  }

  const paymentGroupQuery = supabase
    .from('application_payments')
    .select('id,amount,payment_method,payment_stage,recorded_at,reference_number')
    .eq('application_reference', application.application_reference)
    .order('recorded_at', { ascending: true });
  const [paymentsResult, settingsResult] = await Promise.all([
    paymentGroupQuery,
    supabase.from('official_document_settings').select('document_data').eq('setting_key', 'admission_approval').maybeSingle(),
  ]);
  if (paymentsResult.error || settingsResult.error) {
    return errorResponse('Unable to load payment receipt details.', 500);
  }
  const settings = mergeOfficialDocumentSettings(settingsResult.data?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('Saved official document settings are invalid.', 503);
  const totalPaid = Math.round((paymentsResult.data || []).reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100;
  const course = courseFromSnapshot({
    program: {
      name: application.program_name,
      duration: payment.course_duration,
      mode: payment.course_mode,
      level: payment.course_level,
    },
  });
  let logo: PaymentReceiptContext['logo'];
  if (settings.logoObjectKey) {
    const storedLogo = await readPrivateR2Object(env, settings.logoObjectKey, 'official-document-assets');
    if (isResponse(storedLogo)) return storedLogo;
    if (storedLogo.mime === 'image/png' || storedLogo.mime === 'image/jpeg') {
      logo = { bytes: storedLogo.bytes, mime: storedLogo.mime };
    }
  }
  return {
    application,
    payment,
    settings,
    course,
    logo,
    totalPaid,
  };
};

const ensurePaymentReceiptPdf = async (
  supabase: SupabaseClient,
  env: Env,
  paymentId: string,
): Promise<{ bytes: Uint8Array; key: string; context: PaymentReceiptContext } | Response> => {
  const context = await loadPaymentReceiptContext(supabase, env, paymentId);
  if (isResponse(context)) return context;
  const key = typeof context.payment.receipt_object_key === 'string'
    ? context.payment.receipt_object_key
    : context.application.id
      ? `official-documents/${context.application.id}/receipt-v2-${paymentId}.pdf`
      : '';
  if (!/^official-documents\/[0-9a-f-]+\/receipt-v2-[0-9a-f-]+\.pdf$/i.test(key) ||
    !key.endsWith(`/receipt-v2-${paymentId}.pdf`)) {
    return errorResponse('The saved payment receipt storage reference is invalid.', 409);
  }
  const existing = await readPrivateR2Object(env, key, 'official-documents');
  if (!isResponse(existing)) return { bytes: existing.bytes, key, context };
  if (existing.status !== 404) return existing;
  const bytes = await generatePaymentReceiptPdf({
    settings: context.settings,
    logo: context.logo,
    student: {
      fullName: context.application.student_name,
      studentId: context.application.student_id,
      applicationNumber: context.application.application_reference,
      qualification: context.application.qualification || '',
      programName: context.application.program_name || '',
      email: context.application.email || '',
      mobile: context.application.mobile || '',
      dateOfBirth: context.application.date_of_birth || null,
      address: context.application.address || null,
    },
    course: context.course,
    payment: {
      id: context.payment.id,
      amount: Number(context.payment.amount),
      paymentMethod: context.payment.payment_method,
      paymentStage: context.payment.payment_stage,
      recordedAt: context.payment.recorded_at,
      referenceNumber: context.payment.reference_number,
    },
    totalPaid: context.totalPaid,
  });
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket) return errorResponse('Private receipt storage is not configured.', 503);
  const storeReceipt = async (): Promise<Response | null> => {
      try {
        await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
      } catch (error) {
        console.error('Unable to store payment receipt PDF.', { operation: 'payment.receipt.store', error: messageOf(error) });
        return errorResponse('The payment receipt could not be stored.', 502);
      }
      return null;
  };
  const storageResult = context.application.id
    ? await withApplicationErasureWriteLease(supabase, context.application.id, storeReceipt)
    : await storeReceipt();
  if (isResponse(storageResult)) return storageResult;
  return { bytes, key, context };
};

const loadCurrentBrandingLogo = async (
  env: Env,
): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' } | Response> => {
  const supabase = getSupabaseClient(env, true, 'official_document.historical_recovery.branding');
  if (!supabase) return errorResponse('Current academy branding is unavailable.', 503);
  const { data, error } = await supabase
    .from('site_branding')
    .select('logo_url')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('Historical recovery could not load the current academy logo.', {
      operation: 'official_document.historical_recovery.branding',
      error_code: error.code || 'database_query_failed',
    });
    return errorResponse('The current academy logo could not be loaded.', 503);
  }
  const logoUrl = typeof data?.logo_url === 'string' ? data.logo_url.trim() : '';
  if (!logoUrl) return errorResponse('Configure an academy logo before generating the recovery PDF.', 422);

  const isUnsafeHost = (hostname: string): boolean => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '0.0.0.0' ||
      host === '::' ||
      host === '::1' ||
      host === '127.0.0.1' ||
      host === '169.254.169.254'
    ) return true;
    const ipv4 = host.match(/^\d{1,3}(?:\.\d{1,3}){3}$/);
    if (!ipv4) return host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'));
    const octets = host.split('.').map(Number);
    return octets[0] === 10 ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  };
  const validateLogoUrl = (value: string): URL | null => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || isUnsafeHost(parsed.hostname)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  let parsedUrl = validateLogoUrl(logoUrl);
  if (!parsedUrl) return errorResponse('The configured academy logo URL is invalid or unsafe.', 422);

  let response: Response | null = null;
  const signal = AbortSignal.timeout(5000);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    try {
      response = await fetch(parsedUrl, { redirect: 'manual', signal });
    } catch (error) {
      console.error('Historical recovery could not fetch the current academy logo.', {
        operation: 'official_document.historical_recovery.branding_fetch',
        error: messageOf(error),
      });
      return errorResponse('The current academy logo could not be fetched.', 503);
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    let redirectedUrl: string | null = null;
    if (location) {
      try {
        redirectedUrl = new URL(location, parsedUrl).toString();
      } catch {
        redirectedUrl = null;
      }
    }
    parsedUrl = redirectedUrl ? validateLogoUrl(redirectedUrl) : null;
    if (!parsedUrl) return errorResponse('The configured academy logo redirects to an invalid or unsafe URL.', 422);
  }
  if (!response || !response.ok) return errorResponse('The current academy logo could not be fetched.', 503);
  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    return errorResponse('The configured academy logo must be a PNG or JPEG image.', 422);
  }
  if (!response.body) return errorResponse('The configured academy logo response was empty.', 503);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 3 * 1024 * 1024) {
        await reader.cancel();
        return errorResponse('The configured academy logo is too large.', 422);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    console.error('Historical recovery could not read the current academy logo.', {
      operation: 'official_document.historical_recovery.branding_read',
      error: messageOf(error),
    });
    return errorResponse('The current academy logo could not be read.', 503);
  }
  if (!total) return errorResponse('The configured academy logo is empty.', 422);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, mime };
};

const generatePdfFromSnapshot = async (
  env: Env,
  snapshotValue: unknown,
  versionNumberOverride?: number,
): Promise<Uint8Array | Response> => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || Array.isArray(snapshotValue)) {
    return errorResponse('The saved official document snapshot is invalid.', 500);
  }
  const snapshot = snapshotValue as Record<string, any>;
  const application = snapshot.application;
  if (!application || typeof application !== 'object' ||
    typeof application.student_name !== 'string' ||
    typeof application.application_reference !== 'string' ||
    typeof application.student_id !== 'string') {
    return errorResponse('The approved application is missing required official document details.', 500);
  }
  const settings = mergeOfficialDocumentSettings(snapshot.document_settings ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('The saved document settings in the official snapshot are invalid.', 500);

  const assets: Parameters<typeof generateOfficialPdf>[0]['assets'] = {};
  if (typeof application.photo_object_key === 'string' && application.photo_object_key) {
    const photo = await readPrivateR2Object(env, application.photo_object_key, 'applications');
    if (isResponse(photo)) return photo;
    if (photo.mime === 'image/webp') {
      return errorResponse('This applicant photo must be converted to JPEG or PNG before an official PDF can be generated.', 422);
    }
    assets.studentPhoto = { bytes: photo.bytes, mime: photo.mime as 'image/jpeg' | 'image/png' };
  }
  if (snapshot.historical_recovery?.is_historical_recovery === true) {
    const logo = await loadCurrentBrandingLogo(env);
    if (isResponse(logo)) return logo;
    assets.logo = logo;
  } else if (settings.logoObjectKey) {
    const logo = await readPrivateR2Object(env, settings.logoObjectKey, 'official-document-assets');
    if (isResponse(logo)) return logo;
    if (logo.mime === 'image/webp') {
      return errorResponse('The configured PDF logo must be JPEG or PNG.', 422);
    }
    assets.logo = { bytes: logo.bytes, mime: logo.mime as 'image/jpeg' | 'image/png' };
  }
  if (settings.graphicObjectKey) {
    const graphic = await readPrivateR2Object(env, settings.graphicObjectKey, 'official-document-assets');
    if (isResponse(graphic)) return graphic;
    if (graphic.mime === 'image/webp') return errorResponse('The configured PDF decorative graphic must be JPEG or PNG.', 422);
    assets.graphic = { bytes: graphic.bytes, mime: graphic.mime as 'image/jpeg' | 'image/png' };
  }

  const joining = snapshot.joining_information;
  const joiningInformation = joining && typeof joining === 'object'
    ? joining as {
      joiningDate: string;
      classSchedule: string;
      classTimings: string;
      venue: string;
    }
    : undefined;
  const course = courseFromSnapshot(snapshot);
  const allowedSections = ['student', 'course', 'joining'] as const;
  const pdfSettings = {
    ...settings,
    layout: {
      ...settings.layout,
      visibleSections: [...allowedSections],
      sectionOrder: [...allowedSections],
    },
  };
  try {
    const bytes = await generateOfficialPdf({
      settings: pdfSettings,
      student: {
        fullName: application.student_name,
        studentId: application.student_id,
        applicationNumber: application.application_reference,
        qualificationCategory: ['Student', 'Graduate', 'Working'].includes(application.qualification_category)
          ? application.qualification_category
          : null,
        qualification: application.qualification || '',
        programName: application.program_name || '',
        email: application.email || '',
        mobile: application.mobile || '',
        parentEmail: application.parent_email || null,
        parentPhone: application.parent_phone || null,
        dateOfBirth: application.date_of_birth || null,
        address: application.address || null,
        schoolName: application.school_name || null,
        collegeName: application.college_name || null,
        occupation: application.occupation || null,
        place: application.place || null,
        city: application.city || null,
      },
      course,
      joiningInformation,
      assets,
      versionNumber: versionNumberOverride ?? (Number.isInteger(snapshot.version_number) ? snapshot.version_number : undefined),
      previewOnly: snapshot.preview_only === true,
    });
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 ||
      new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
      return errorResponse('The generated official PDF is empty, too large, or invalid.', 500);
    }
    return bytes;
  } catch (error) {
    console.error('Official PDF generation failed.', {
      operation: 'official_document.pdf.generate',
      error: messageOf(error),
    });
    return errorResponse('The official PDF could not be generated. Check saved settings and Worker logs.', 503);
  }
};

const ensureIssuedOfficialPdf = async (
  supabase: SupabaseClient,
  env: Env,
  issuance: Record<string, any>,
  snapshot: unknown,
  applicationId: string,
): Promise<Uint8Array | Response> => {
  const versionNumber = Number.isInteger(issuance.version_number) ? issuance.version_number : 1;
  const storedKey = typeof issuance.pdf_object_key === 'string'
    ? issuance.pdf_object_key.trim()
    : '';
  if (issuance.status === 'ready' &&
    !new RegExp(`^official-documents/${applicationId}/v[0-9]+-[0-9a-f-]+\\.pdf$`, 'i').test(storedKey)) {
    return errorResponse('The issued official PDF is marked ready but its storage key is missing or invalid.', 500);
  }
  if (issuance.status === 'ready' || storedKey) {
    if (storedKey && !new RegExp(`^official-documents/${applicationId}/v[0-9]+-[0-9a-f-]+\\.pdf$`, 'i').test(storedKey)) {
      return errorResponse('The issued official PDF has a missing or invalid storage key.', 500);
    }
    if (storedKey) {
      const stored = await readPrivateR2Object(env, storedKey, 'official-documents');
      if (!isResponse(stored)) return stored.bytes;
      if (stored.status !== 404) return stored;
      if (issuance.issuance_type === 'payment_update') return stored;
    }
    return generatePdfFromSnapshot(env, snapshot, versionNumber);
  }

  const bytes = await generatePdfFromSnapshot(env, snapshot, versionNumber);
  if (isResponse(bytes)) return bytes;
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket) return errorResponse('Private official document storage is not configured.', 503);
  const key = `official-documents/${applicationId}/v${versionNumber}-${issuance.id}.pdf`;
  return withApplicationErasureWriteLease(supabase, applicationId, async () => {
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
    } catch (error) {
      console.error('Unable to store generated official PDF.', {
        operation: 'official_document.pdf.store',
        error: messageOf(error),
      });
      return errorResponse('The official PDF could not be stored in private R2 storage.', 502);
    }

    const { error } = await supabase
      .from('official_document_issuances')
      .update({ pdf_object_key: key, status: 'ready', generated_at: new Date().toISOString() })
      .eq('id', issuance.id);
    if (error) {
      console.error('Unable to record generated official PDF storage key.', {
        operation: 'official_document.issuance.update',
        error_code: error.code || 'database_query_failed',
      });
      return errorResponse('The official PDF was stored but its issuance record could not be updated.', 502);
    }
    return bytes;
  });
};

type PaymentDocumentDeliveryResult = {
  success: boolean;
  status: string;
  version_number?: number;
  pdf_ready?: boolean;
  error?: string;
};

const processPaymentDocumentIssuance = async (
  supabase: SupabaseClient,
  env: Env,
  issuanceId: string,
): Promise<PaymentDocumentDeliveryResult> => {
  const { data: loaded, error: loadError } = await supabase
    .from('official_document_issuances')
    .select('id,application_id,application_reference,student_id,version_number,issuance_type,snapshot,pdf_object_key,status')
    .eq('id', issuanceId)
    .maybeSingle();
  if (loadError || !loaded || !loaded.application_id) {
    return { success: false, status: 'failed', error: 'Unable to load the queued payment document.' };
  }
  if (loaded.issuance_type !== 'payment_update') {
    return { success: false, status: 'failed', error: 'The queued issuance is not a payment update.' };
  }

  let issuance: Record<string, any> = loaded;
  if (issuance.status !== 'ready') {
    if (issuance.status === 'failed' || issuance.status === 'processing') {
      return {
        success: false,
        status: issuance.status,
        version_number: issuance.version_number,
        error: 'This payment document is not automatically retried.',
      };
    }
    const bytes = await generatePdfFromSnapshot(env, issuance.snapshot, issuance.version_number);
    if (isResponse(bytes)) return { success: false, status: 'failed', version_number: issuance.version_number, error: 'The payment PDF could not be generated.' };

    const objectKey = `official-documents/${issuance.application_id}/v${issuance.version_number}-${issuance.id}.pdf`;
    const mediaBucket = env.APPLICATION_MEDIA;
    if (!mediaBucket?.put) {
      return { success: false, status: 'failed', version_number: issuance.version_number, error: 'Payment saved; private PDF storage is not configured.' };
    }
    const storageResult = await withApplicationErasureWriteLease(
      supabase,
      issuance.application_id,
      async () => {
        try {
          await mediaBucket.put(objectKey, bytes, { httpMetadata: { contentType: 'application/pdf' } });
        } catch (error) {
          console.error('Payment PDF storage failed after the payment was saved.', {
            operation: 'official_document.payment_version.store',
            error: messageOf(error),
          });
          return errorResponse('Payment saved; PDF storage failed.', 502);
        }

        const { error: updateError } = await supabase
          .from('official_document_issuances')
          .update({ pdf_object_key: objectKey, status: 'ready', generated_at: new Date().toISOString() })
          .eq('id', issuance.id);
        if (updateError) {
          console.error('Generated payment PDF could not be marked ready.', {
            operation: 'official_document.payment_version.complete',
            error_code: updateError.code || 'database_query_failed',
          });
          return errorResponse('Payment saved; its PDF record could not be updated.', 502);
        }
        return null;
      },
    );
    if (isResponse(storageResult)) {
      return {
        success: false,
        status: 'failed',
        version_number: issuance.version_number,
        error: 'Payment saved, but the application is being deleted or its PDF could not be stored.',
      };
    }
    issuance = { ...issuance, status: 'ready', pdf_object_key: objectKey };
  }

  const pdfBytes = await ensureIssuedOfficialPdf(
    supabase,
    env,
    issuance,
    issuance.snapshot,
    issuance.application_id,
  );
  if (isResponse(pdfBytes)) {
    return { success: false, status: 'failed', version_number: issuance.version_number, pdf_ready: true, error: 'The saved payment PDF could not be read for email delivery.' };
  }

  const { data: notification, error: notificationError } = await supabase
    .from('application_notifications')
    .select('id,recipient_email,status')
    .eq('official_document_issuance_id', issuance.id)
    .eq('notification_type', 'student_payment_update')
    .maybeSingle();
  if (notificationError || !notification) {
    return { success: false, status: 'failed', version_number: issuance.version_number, pdf_ready: true, error: 'The payment email record is unavailable.' };
  }
  if (notification.status === 'Sent') {
    return { success: true, status: 'Sent', version_number: issuance.version_number, pdf_ready: true };
  }

  const paymentEmail = buildPaymentUpdateEmail(issuance.snapshot, pdfBytes, issuance.version_number);
  if (isResponse(paymentEmail)) return { success: false, status: 'Failed', version_number: issuance.version_number, pdf_ready: true, error: 'Payment email could not be built.' };

  const notificationResult = await withApplicationErasureWriteLease(
    supabase,
    issuance.application_id,
    async () => {
      const emailResult = await sendEmail(env, {
        ...paymentEmail,
        idempotencyKey: `student-payment-update-${issuance.id}`,
      });
      const { error: updateNotificationError } = await supabase
        .from('application_notifications')
        .update({
          status: emailResult.success ? 'Sent' : 'Failed',
          provider_message_id: emailResult.provider_message_id,
          error_message: emailResult.error || null,
          sent_at: emailResult.success ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', notification.id);
      if (updateNotificationError) {
        return errorResponse('Email was processed, but its result could not be recorded.', 502);
      }
      return emailResult;
    },
  );
  if (isResponse(notificationResult)) {
    return {
      success: false,
      status: 'Failed',
      version_number: issuance.version_number,
      pdf_ready: true,
      error: notificationResult.status === 409
        ? 'Application deletion is in progress; the payment email was not sent.'
        : 'Payment email was processed, but its result could not be recorded.',
    };
  }
  if (!notificationResult) {
    return { success: false, status: 'Failed', version_number: issuance.version_number, pdf_ready: true, error: 'Email was processed, but its result could not be recorded.' };
  }
  return {
    success: notificationResult.success,
    status: notificationResult.success ? 'Sent' : 'Failed',
    version_number: issuance.version_number,
    ...(notificationResult.error ? { error: notificationResult.error } : {}),
  };
};

const enqueuePaymentDocumentVersion = async (
  supabase: SupabaseClient,
  applicationId: string,
  eventKey: string,
): Promise<string | null> => {
  try {
    const { data, error } = await supabase.rpc('enqueue_official_document_payment_version', {
      p_application_id: applicationId,
      p_event_key: eventKey,
    });
    const response = Array.isArray(data) ? data[0] : data;
    const issuanceId = typeof response === 'string'
      ? response
      : response && typeof response === 'object'
        ? Object.values(response as Record<string, unknown>).find((value): value is string => validId(String(value)))
        : null;
    if (!error && issuanceId && validId(issuanceId)) return issuanceId;

    console.error('Payment was saved, but its official PDF version could not be confirmed in the queue.', {
      operation: 'official_document.payment_version.enqueue',
      error_code: error?.code || (issuanceId ? 'invalid_response' : 'not_eligible_or_not_queued'),
    });
    return null;
  } catch (error) {
    console.error('Payment was saved, but its official PDF version could not be queued.', {
      operation: 'official_document.payment_version.enqueue',
      error_code: 'request_failed',
    });
    return null;
  }
};

const readTable = async (
  supabase: SupabaseClient,
  table: string,
  columns: string,
  options: { publishedColumn?: string; orderColumn: string; ascending?: boolean },
): Promise<Response> => {
  let query: any = supabase.from(table).select(columns);
  if (options.publishedColumn) query = query.eq(options.publishedColumn, true);
  const { data, error } = await query.order(options.orderColumn, { ascending: options.ascending ?? true });
  if (error) return errorResponse(`Unable to read ${table}: ${error.message}`, 500);
  return json(data || []);
};

const READ_COLUMNS = {
  programs: 'id,title,slug,short_description,description,duration,course_mode,level,target_audience,age_range,image_url,image_object_key,is_published,display_order,created_at,updated_at',
  announcements: 'id,content,is_active,display_order,button_action,created_at,updated_at',
  reviews: 'id,author_name,rating,review_text,source,is_published,created_at,updated_at',
  media: 'id,media_type,title,caption,r2_object_key,media_url,youtube_url,youtube_video_id,cover_image_url,alt_text,is_published,display_order,created_at,updated_at',
  faqs: 'id,question,answer,is_published,display_order,created_at,updated_at',
  applications: 'id,application_reference,student_id,student_name,mobile,email,qualification,qualification_category,parent_phone,parent_email,school_name,college_name,occupation,place,city,program_id,program_name,date_of_birth,address,photo_object_key,photo_data_url,message,status,approved_by_name,approved_at,archived_at,archived_by,created_at',
  demoClassRequests: 'id,full_name,mobile,email,qualification_category,parent_name,school_or_college_name,college_name,profession,educational_qualification,date_of_birth,address,city,additional_information,status,created_at',
  notifications: 'id,application_id,notification_type,recipient_email,status,provider_message_id,error_message,pdf_attached,sent_at,created_at,updated_at,official_document_issuance_id',
  callbacks: 'id,full_name,mobile,email,program_name,preferred_contact_time,message,consent,status,created_at,updated_at',
  profiles: 'id,email,full_name,role,is_active,created_at,updated_at',
} as const;

const adminTable = async (
  request: Request,
  env: Env,
  table: string,
  columns: string,
  orderColumn: string,
  ascending = false,
  minimumRole: AdminProfile['role'] = 'staff',
): Promise<Response> => {
  const auth = await requireAdmin(request, env, minimumRole);
  if (isResponse(auth)) return auth;
  return readTable(auth.supabase, table, columns, { orderColumn, ascending });
};

const getAdminApplications = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const archivedParam = new URL(request.url).searchParams.get('archived');
  if (archivedParam !== null && archivedParam !== 'true' && archivedParam !== 'false') {
    return errorResponse('archived must be true or false.', 400);
  }
  const archivedOnly = archivedParam === 'true';
  let query = auth.supabase
    .from('applications')
    .select(READ_COLUMNS.applications)
    .order('created_at', { ascending: false });
  query = archivedOnly ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query;
  if (error) return errorResponse(`Unable to read applications: ${error.message}`, 500);
  return json(data || []);
};

const createProgram = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const fields = ['title', 'short_description', 'description', 'target_audience'] as const;
  const validated: Record<string, string> = {};
  for (const field of fields) {
    const value = requiredString(body[field], field.replaceAll('_', ' '), field === 'description' ? 10000 : 500);
    if (isResponse(value)) return value;
    validated[field] = value;
  }

  const suppliedSlug = optionalString(body.slug, 'slug', 160);
  if (isResponse(suppliedSlug)) return suppliedSlug;
  const slug = (suppliedSlug || validated.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).toLowerCase();
  if (!slug) return errorResponse('A valid program slug is required.', 400);

  let displayOrder = 0;
  if (Number.isInteger(body.display_order)) {
    displayOrder = Number(body.display_order);
  } else {
    const { data: lastProgram, error: orderError } = await auth.supabase
      .from('programs').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    if (orderError) return errorResponse(`Unable to determine program display order: ${orderError.message}`, 500);
    displayOrder = (lastProgram?.display_order || 0) + 1;
  }

  const duration = optionalString(body.duration, 'duration', 200);
  const courseMode = optionalString(body.course_mode, 'course mode', 200);
  const level = optionalString(body.level, 'level', 200);
  const ageRange = optionalString(body.age_range, 'age range', 200);
  const suppliedImageUrl = optionalString(body.image_url, 'image URL', 2048);
  if (isResponse(duration)) return duration;
  if (isResponse(courseMode)) return courseMode;
  if (isResponse(level)) return level;
  if (isResponse(ageRange)) return ageRange;
  if (isResponse(suppliedImageUrl)) return suppliedImageUrl;

  let imageUrl = suppliedImageUrl || 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80';
  let imageObjectKey: string | null = null;

  if (body.image_file_base64 !== undefined) {
    const image = decodeImage(body.image_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;
    const upload = await uploadToR2(env, image, 'programs');
    if (isResponse(upload)) return upload;
    imageUrl = upload.url;
    imageObjectKey = upload.key;
  } else if (body.image_object_key !== undefined && body.image_object_key !== null && body.image_object_key !== '') {
    return errorResponse('An image object key can only be set by uploading a program image.', 400);
  }

  const row = {
    title: validated.title,
    slug,
    short_description: validated.short_description,
    description: validated.description,
    target_audience: validated.target_audience,
    duration,
    course_mode: courseMode,
    level,
    age_range: ageRange,
    image_url: imageUrl,
    image_object_key: imageObjectKey,
    is_published: body.is_published === true,
    display_order: displayOrder,
  };

  const { data, error } = await auth.supabase.from('programs').insert(row).select().single();
  if (error) {
    if (imageObjectKey) {
      try { await deleteFromR2(env, imageObjectKey, 'programs'); } catch {}
    }
    return errorResponse(`Failed to create program: ${error.message}`, 500);
  }
  return json(data, 201);
};

const updateProgram = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const { data: current, error: currentError } = await auth.supabase
    .from('programs')
    .select('id,image_url,image_object_key')
    .eq('id', id)
    .maybeSingle();
  if (currentError) return errorResponse(`Failed to load program: ${currentError.message}`, 500);
  if (!current) return errorResponse('Program not found.', 404);

  const updates: Record<string, unknown> = {};
  for (const field of ['title', 'slug', 'short_description', 'description', 'target_audience', 'duration', 'course_mode', 'level', 'age_range', 'image_url'] as const) {
    if (body[field] === undefined) continue;
    const value = field === 'duration' || field === 'course_mode' || field === 'level' || field === 'age_range' || field === 'image_url'
      ? optionalString(body[field], field.replaceAll('_', ' '), field === 'image_url' ? 2048 : 200)
      : requiredString(body[field], field.replaceAll('_', ' '), field === 'description' ? 10000 : 500);
    if (isResponse(value)) return value;
    updates[field] = value;
  }

  if (body.image_object_key !== undefined) {
    return errorResponse('An image object key can only be changed by uploading a program image.', 400);
  }

  let newImageObjectKey: string | null = null;
  if (body.image_file_base64 !== undefined) {
    const image = decodeImage(body.image_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;

    const upload = await uploadToR2(env, image, 'programs');
    if (isResponse(upload)) return upload;

    newImageObjectKey = upload.key;
    updates.image_url = upload.url;
    updates.image_object_key = upload.key;
  }

  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') {
      if (newImageObjectKey) {
        try { await deleteFromR2(env, newImageObjectKey, 'programs'); } catch {}
      }
      return errorResponse('is_published must be a boolean.', 400);
    }
    updates.is_published = body.is_published;
  }

  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) {
      if (newImageObjectKey) {
        try { await deleteFromR2(env, newImageObjectKey, 'programs'); } catch {}
      }
      return errorResponse('display_order must be an integer.', 400);
    }
    updates.display_order = body.display_order;
  }

  if (!Object.keys(updates).length) {
    return errorResponse('At least one editable program field is required.', 400);
  }

  const { data, error } = await auth.supabase
    .from('programs').update(updates).eq('id', id).select().maybeSingle();

  if (error || !data) {
    if (newImageObjectKey) {
      try { await deleteFromR2(env, newImageObjectKey, 'programs'); } catch {}
    }
    if (error) return errorResponse(`Failed to update program: ${error.message}`, 500);
    return errorResponse('Program not found.', 404);
  }

  if (newImageObjectKey) {
    const previousReference = current.image_object_key || current.image_url;
    const previousKey = objectKeyFromMetadata(env, previousReference, 'programs');
    if (previousKey && previousKey !== newImageObjectKey) {
      try {
        await deleteFromR2(env, previousKey, 'programs');
      } catch {
        // Preserve the successful program update if old-image cleanup fails.
      }
    }
  }

  return json(data);
};

const deleteRow = async (request: Request, env: Env, table: string, id: string, minimumRole: AdminProfile['role'], label: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, minimumRole);
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase.from(table).delete().eq('id', id).select('id').maybeSingle();
  if (error) return errorResponse(`Unable to delete ${label}: ${error.message}`, 500);
  if (!data) return errorResponse(`${label} not found.`, 404);
  return json({ success: true, message: `${label} deleted successfully.` });
};

const createAnnouncement = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const content = requiredString(body.content, 'content', 4000);
  if (isResponse(content)) return content;
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
  if (body.display_order !== undefined && !Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
  if (body.button_action !== undefined && body.button_action !== null &&
      body.button_action !== 'application' && body.button_action !== 'demo') {
    return errorResponse('button_action must be application, demo, or null.', 400);
  }
  let displayOrder = Number(body.display_order);
  if (!Number.isInteger(body.display_order)) {
    const { data: lastAnnouncement, error: orderError } = await auth.supabase
      .from('announcements').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    if (orderError) return errorResponse(`Unable to determine announcement display order: ${orderError.message}`, 500);
    displayOrder = (lastAnnouncement?.display_order || 0) + 1;
  }

  const { data, error } = await auth.supabase.from('announcements').insert({
    content,
    is_active: body.is_active !== false,
    display_order: displayOrder,
    button_action: body.button_action ?? null,
  }).select().single();
  if (error) return errorResponse(`Failed to create announcement: ${error.message}`, 500);
  return json(data, 201);
};

const updateAnnouncement = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) {
    const content = requiredString(body.content, 'content', 4000);
    if (isResponse(content)) return content;
    updates.content = content;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
    updates.is_active = body.is_active;
  }
  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
    updates.display_order = body.display_order;
  }
  if (body.button_action !== undefined) {
    if (body.button_action !== null && body.button_action !== 'application' && body.button_action !== 'demo') {
      return errorResponse('button_action must be application, demo, or null.', 400);
    }
    updates.button_action = body.button_action;
  }
  if (!Object.keys(updates).length) return errorResponse('At least one editable announcement field is required.', 400);
  const { data, error } = await auth.supabase.from('announcements').update(updates).eq('id', id).select().maybeSingle();
  if (error) return errorResponse(`Failed to update announcement: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Announcement not found.', 404);
};

const createFaq = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const question = requiredString(body.question, 'question', 1000);
  const answer = requiredString(body.answer, 'answer', 10000);
  if (isResponse(question)) return question;
  if (isResponse(answer)) return answer;
  if (body.is_published !== undefined && typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
  let displayOrder = Number(body.display_order);
  if (!Number.isInteger(body.display_order)) {
    const { data: lastFaq, error: orderError } = await auth.supabase
      .from('faqs').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    if (orderError) return errorResponse(`Unable to determine FAQ display order: ${orderError.message}`, 500);
    displayOrder = (lastFaq?.display_order || 0) + 1;
  }
  const { data, error } = await auth.supabase.from('faqs').insert({
    question, answer, is_published: body.is_published !== false,
    display_order: displayOrder,
  }).select().single();
  if (error) return errorResponse(`Failed to create FAQ: ${error.message}`, 500);
  return json(data, 201);
};

const validateReviewFields = (body: Record<string, unknown>, partial = false): Record<string, unknown> | Response => {
  const updates: Record<string, unknown> = {};
  for (const [field, maxLength] of [['author_name', 300], ['review_text', 10000], ['source', 300]] as const) {
    if (partial && body[field] === undefined) continue;
    if (field === 'source' && body[field] === undefined) continue;
    const value = field === 'source'
      ? optionalString(body[field], field, maxLength)
      : requiredString(body[field], field.replaceAll('_', ' '), maxLength);
    if (isResponse(value)) return value;
    updates[field] = value;
  }

  if (body.rating !== undefined || !partial) {
    if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5) {
      return errorResponse('rating must be an integer from 1 to 5.', 400);
    }
    updates.rating = body.rating;
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
    updates.is_published = body.is_published;
  }
  return updates;
};

const createReview = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const values = validateReviewFields(body);
  if (isResponse(values)) return values;
  const { data, error } = await auth.supabase.from('reviews').insert(values).select(READ_COLUMNS.reviews).single();
  if (error) return errorResponse(`Failed to create review: ${error.message}`, 500);
  return json(data, 201);
};

const updateReview = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const values = validateReviewFields(body, true);
  if (isResponse(values)) return values;
  if (!Object.keys(values).length) return errorResponse('At least one editable review field is required.', 400);
  const { data, error } = await auth.supabase.from('reviews').update(values).eq('id', id).select(READ_COLUMNS.reviews).maybeSingle();
  if (error) return errorResponse(`Failed to update review: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Review not found.', 404);
};

const updateFaq = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const updates: Record<string, unknown> = {};
  for (const field of ['question', 'answer'] as const) {
    if (body[field] === undefined) continue;
    const value = requiredString(body[field], field, field === 'answer' ? 10000 : 1000);
    if (isResponse(value)) return value;
    updates[field] = value;
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
    updates.is_published = body.is_published;
  }
  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
    updates.display_order = body.display_order;
  }
  if (!Object.keys(updates).length) return errorResponse('At least one editable FAQ field is required.', 400);
  const { data, error } = await auth.supabase.from('faqs').update(updates).eq('id', id).select().maybeSingle();
  if (error) return errorResponse(`Failed to update FAQ: ${error.message}`, 500);
  return data ? json(data) : errorResponse('FAQ not found.', 404);
};

const createMedia = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const title = requiredString(body.title, 'Media title', 300);
  if (isResponse(title)) return title;
  const mediaType = body.media_type === 'video' ? 'video' : body.media_type === undefined || body.media_type === 'photo' ? 'photo' : null;
  if (!mediaType) return errorResponse('media_type must be either photo or video.', 400);
  const caption = optionalString(body.caption, 'caption', 5000);
  const altText = optionalString(body.alt_text, 'alt_text', 1000);
  const coverImageUrl = optionalString(body.cover_image_url, 'cover_image_url', 2048);
  for (const value of [caption, altText, coverImageUrl]) if (isResponse(value)) return value;
  if (body.is_published !== undefined && typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
  if (body.display_order !== undefined && !Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
  const displayOrder = typeof body.display_order === 'number' && Number.isInteger(body.display_order)
    ? body.display_order
    : 0;
  const { data: matchingOrder, error: orderLookupError } = await auth.supabase.from('media_items')
    .select('id,title')
    .eq('display_order', displayOrder)
    .limit(1);
  if (orderLookupError) return errorResponse(`Unable to verify media display order: ${orderLookupError.message}`, 500);
  if (matchingOrder?.length) {
    return errorResponse(
      `This display order number is already taken by "${matchingOrder[0].title}". Please choose another number.`,
      409,
    );
  }

  let youtube: ReturnType<typeof safeYouTube> = null;
  if (mediaType === 'video') {
    youtube = safeYouTube(body.youtube_url);
    if (!youtube) return errorResponse('A valid YouTube URL is required for video entries.', 400);
  }

  let uploaded: { key: string; url: string } | null = null;
  let uploadedCover: { key: string; url: string } | null = null;
  let mediaUrl = optionalString(body.media_url, 'media_url', 2048);
  if (isResponse(mediaUrl)) return mediaUrl;
  if (mediaType === 'photo' && body.media_file_base64 !== undefined) {
    const image = decodeImage(body.media_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;
    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) return upload;
    uploaded = upload;
    mediaUrl = upload.url;
  }
  if (body.cover_file_base64 !== undefined) {
    const image = decodeImage(body.cover_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) {
      if (uploaded) {
        try { await deleteFromR2(env, uploaded.key, 'media'); } catch {}
      }
      return image;
    }
    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) {
      if (uploaded) {
        try { await deleteFromR2(env, uploaded.key, 'media'); } catch {}
      }
      return upload;
    }
    uploadedCover = upload;
  }

  const { data, error } = await auth.supabase.from('media_items').insert({
    media_type: mediaType,
    title,
    caption,
    r2_object_key: uploaded?.key || null,
    media_url: mediaType === 'video' ? null : mediaUrl,
    youtube_url: youtube?.url || null,
    youtube_video_id: youtube?.id || null,
    cover_image_url: uploadedCover?.url || coverImageUrl,
    alt_text: altText || title,
    is_published: body.is_published !== false,
    display_order: displayOrder,
  }).select().single();

  if (error) {
    const orphaned: string[] = [];
    for (const file of [uploaded, uploadedCover]) {
      if (!file) continue;
      try {
        await deleteFromR2(env, file.key, 'media');
      } catch {
        orphaned.push(file.key);
      }
    }
    if (orphaned.length) {
      return json({
        error: `Failed to create media item: ${error.message}`,
        orphaned_object_keys: orphaned,
      }, 502);
    }
    return errorResponse(`Failed to create media item: ${error.message}`, 500);
  }
  return json(data, 201);
};

const updateMedia = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const { data: current, error: readError } = await auth.supabase.from('media_items')
    .select('id,media_type,title,caption,r2_object_key,media_url,youtube_url,youtube_video_id,cover_image_url,alt_text,is_published,display_order')
    .eq('id', id).maybeSingle();
  if (readError) return errorResponse(`Unable to load media item: ${readError.message}`, 500);
  if (!current) return errorResponse('Media item not found.', 404);
  const requestedDisplayOrder = body.display_order === undefined ? current.display_order : body.display_order;
  if (typeof requestedDisplayOrder !== 'number' || !Number.isInteger(requestedDisplayOrder)) {
    return errorResponse('display_order must be an integer.', 400);
  }
  const displayOrder = requestedDisplayOrder;
  const { data: matchingOrder, error: orderLookupError } = await auth.supabase.from('media_items')
    .select('id,title')
    .eq('display_order', displayOrder)
    .neq('id', id)
    .limit(1);
  if (orderLookupError) return errorResponse(`Unable to verify media display order: ${orderLookupError.message}`, 500);
  if (matchingOrder?.length) {
    return errorResponse(
      `This display order number is already taken by "${matchingOrder[0].title}". Please choose another number.`,
      409,
    );
  }

  const mediaType = body.media_type === undefined ? current.media_type : body.media_type;
  if (mediaType !== 'photo' && mediaType !== 'video') return errorResponse('media_type must be either photo or video.', 400);
  const previousObjectKey = objectKeyFromMetadata(env, current.r2_object_key, 'media');
  const removingStoredPhoto = mediaType === 'video' || body.media_file_base64 !== undefined;
  if (current.r2_object_key && removingStoredPhoto && !previousObjectKey) {
    return errorResponse('Stored media R2 object key is invalid; refusing to update metadata without safe cleanup.', 500);
  }
  const updates: Record<string, unknown> = { media_type: mediaType };
  for (const [field, maxLength] of [['title', 300], ['caption', 5000], ['alt_text', 1000], ['cover_image_url', 2048]] as const) {
    if (body[field] === undefined) continue;
    const value = field === 'title' ? requiredString(body[field], field, maxLength) : optionalString(body[field], field, maxLength);
    if (isResponse(value)) return value;
    updates[field] = value;
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
    updates.is_published = body.is_published;
  }
  updates.display_order = displayOrder;

  let youtube: ReturnType<typeof safeYouTube> = null;
  if (mediaType === 'video') {
    youtube = safeYouTube(body.youtube_url === undefined ? current.youtube_url : body.youtube_url);
    if (!youtube) return errorResponse('A valid YouTube URL is required for video entries.', 400);
    updates.youtube_url = youtube.url;
    updates.youtube_video_id = youtube.id;
    updates.media_url = null;
    updates.r2_object_key = null;
  } else {
    updates.youtube_url = null;
    updates.youtube_video_id = null;
  }

  let newObjectKey: string | null = null;
  let newCoverObject: { key: string; url: string } | null = null;
  if (body.cover_file_base64 !== undefined) {
    const image = decodeImage(body.cover_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;
    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) return upload;
    newCoverObject = upload;
    updates.cover_image_url = upload.url;
  }

  if (mediaType === 'photo' && body.media_file_base64 !== undefined) {
    const image = decodeImage(body.media_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) {
      if (newCoverObject) {
        try { await deleteFromR2(env, newCoverObject.key, 'media'); } catch (cleanupError) {
          console.error('[Worker Media Cover Cleanup Error]', cleanupError);
        }
      }
      return image;
    }

    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) {
      if (newCoverObject) {
        try { await deleteFromR2(env, newCoverObject.key, 'media'); } catch (cleanupError) {
          console.error('[Worker Media Cover Cleanup Error]', cleanupError);
        }
      }
      return upload;
    }
    newObjectKey = upload.key;
    updates.r2_object_key = upload.key;
    updates.media_url = upload.url;
  } else if (mediaType === 'photo') {
    const mediaUrl = body.media_url === undefined ? current.media_url : optionalString(body.media_url, 'media_url', 2048);
    if (isResponse(mediaUrl)) {
      if (newCoverObject) {
        try { await deleteFromR2(env, newCoverObject.key, 'media'); } catch (cleanupError) {
          console.error('[Worker Media Cover Cleanup Error]', cleanupError);
        }
      }
      return mediaUrl;
    }
    updates.media_url = mediaUrl;
    updates.r2_object_key = current.media_type === 'photo' ? current.r2_object_key : null;
  }

  const { data: saved, error } = await auth.supabase.from('media_items').update(updates).eq('id', id).select().maybeSingle();
  if (error) {
    const orphaned: string[] = [];
    for (const fileKey of [newObjectKey, newCoverObject?.key || null]) {
      if (!fileKey) continue;
      try {
        await deleteFromR2(env, fileKey, 'media');
      } catch {
        orphaned.push(fileKey);
      }
    }
    if (orphaned.length) {
      return json({
        error: `Failed to update media item: ${error.message}`,
        orphaned_object_keys: orphaned,
      }, 502);
    }
    return errorResponse(`Failed to update media item: ${error.message}`, 500);
  }
  if (!saved) {
    const orphaned: string[] = [];
    for (const fileKey of [newObjectKey, newCoverObject?.key || null]) {
      if (!fileKey) continue;
      try {
        await deleteFromR2(env, fileKey, 'media');
      } catch {
        orphaned.push(fileKey);
      }
    }
    if (orphaned.length) {
      return json({
        error: 'Media item disappeared before its update completed.',
        orphaned_object_keys: orphaned,
      }, 502);
    }
    return errorResponse('Media item not found.', 404);
  }

  const previousKey = previousObjectKey;
  if (previousKey && previousKey !== newObjectKey && (mediaType === 'video' || newObjectKey)) {
    try {
      await deleteFromR2(env, previousKey, 'media');
    } catch (cleanupError) {
      return json({ error: 'Media metadata was updated, but its previous R2 object could not be removed.', storage_error: messageOf(cleanupError), orphaned_object_key: previousKey }, 502);
    }
  }
  return json(saved);
};

const deleteMedia = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data: item, error: readError } = await auth.supabase.from('media_items').select('id, r2_object_key').eq('id', id).maybeSingle();
  if (readError) return errorResponse(`Unable to load media item: ${readError.message}`, 500);
  if (!item) return errorResponse('Media item not found.', 404);
  const objectKey = item.r2_object_key ? objectKeyFromMetadata(env, item.r2_object_key, 'media') : null;
  if (item.r2_object_key && !objectKey) return errorResponse('Stored media R2 object key is invalid; refusing to delete the row.', 500);

  if (objectKey) {
    try {
      await deleteFromR2(env, objectKey, 'media');
    } catch (deleteError) {
      return json({ error: 'Unable to remove the media object; the media record was not deleted.', storage_error: messageOf(deleteError), object_key: objectKey }, 502);
    }
  }

  const { error } = await auth.supabase.from('media_items').delete().eq('id', id);
  if (error) {
    return json({
      error: objectKey
        ? `The media object was removed, but its record could not be deleted: ${error.message}`
        : `Unable to delete media item: ${error.message}`,
      photo_removed: Boolean(objectKey),
    }, 500);
  }
  return json({ success: true, message: 'Media item deleted.' });
};

const submitApplication = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const supabase = getSupabaseClient(env, true, 'applications.submit');
  if (!supabase) return errorResponse('Application submission is unavailable because Supabase is not configured.', 503);

  const requiredFields = ['student_name', 'program_name'] as const;
  const fields: Record<string, string> = {};
  for (const field of requiredFields) {
    const value = requiredString(body[field], field.replaceAll('_', ' '), field === 'program_name' ? 300 : 500);
    if (isResponse(value)) return value;
    fields[field] = value;
  }
  if (body.privacy_consent !== true) return errorResponse('Privacy consent is required to process your application.', 400);

  const categoryFields = validateApplicationCategoryFields(body);
  if (!categoryFields.valid) return errorResponse(categoryFields.error, 400);
  fields.qualification = categoryFields.value.qualification;

  let applicationEmail: string;
  let applicationMobile: string;
  if (categoryFields.value.qualification_category === 'Student') {
    const contact = getApplicationPrimaryContact(categoryFields.value, { mobile: '', email: '' });
    if (!contact) return errorResponse('Valid parent contact details are required for Student applications.', 400);
    applicationEmail = contact.email;
    applicationMobile = contact.mobile;
  } else {
    const email = requiredString(body.email, 'email', 500);
    if (isResponse(email)) return email;
    const mobile = requiredString(body.mobile, 'mobile', 500);
    if (isResponse(mobile)) return mobile;
    applicationEmail = email;
    applicationMobile = mobile;
  }
  fields.email = normalizeContactEmail(applicationEmail);
  if (!isValidContactEmail(fields.email)) return errorResponse('A valid email address is required.', 400);
  const normalizedMobile = normalizeIndianMobileNumber(applicationMobile);
  if (!normalizedMobile || applicationMobile.length > 30) return errorResponse('Please provide a valid Indian mobile number.', 400);
  fields.mobile = normalizedMobile;

  const duplicate = await checkContactDuplicates(supabase, 'applications', fields.email, fields.mobile);
  if (isResponse(duplicate)) return duplicate;
  if (duplicate) return duplicateContactResponse();

  const programId = body.program_id === undefined || body.program_id === null || body.program_id === '' ? null : body.program_id;
  if (programId !== null && (typeof programId !== 'string' || !validId(programId))) {
    return errorResponse('program_id must be a valid program ID.', 400);
  }
  const dateOfBirth = body.date_of_birth === undefined || body.date_of_birth === null || body.date_of_birth === '' ? null : body.date_of_birth;
  if (dateOfBirth !== null) {
    const parsedDate = typeof dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      ? Date.parse(`${dateOfBirth}T00:00:00.000Z`)
      : Number.NaN;
    if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== dateOfBirth) {
      return errorResponse('date_of_birth must be a valid date in YYYY-MM-DD format.', 400);
    }
  }
  const address = optionalString(body.address, 'address', 3000);
  const message = optionalString(body.message, 'message', 5000);
  if (isResponse(address)) return address;
  if (isResponse(message)) return message;

  const photo = decodeImage(body.photo_base64, MAX_PASSPORT_BYTES);
  if (isResponse(photo)) return photo;
  const declaredMime = body.photo_mime_type;
  if (declaredMime !== undefined && declaredMime !== photo.mime) return errorResponse('Photo MIME type does not match the uploaded image.', 400);
  const upload = await uploadToR2(env, photo, 'applications');
  if (isResponse(upload)) return upload;

  const applicationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const application = {
    id: applicationId,
    ...fields,
    ...categoryFields.value,
    program_id: programId,
    date_of_birth: dateOfBirth,
    address,
    photo_object_key: upload.key,
    photo_data_url: body.photo_base64,
    message,
    status: 'Pending',
    privacy_consent: true,
    created_at: now,
    updated_at: now,
  };

  const { data: insertedApplication, error: insertError } = await supabase
    .from('applications')
    .insert(application)
    .select('application_reference')
    .single();
  if (insertError || !insertedApplication) {
    if (isDuplicateContactError(insertError)) {
      try {
        await deleteFromR2(env, upload.key, 'applications');
      } catch (cleanupError) {
        console.error('Unable to clean up application photo after duplicate submission.', {
          operation: 'applications.submit.photo_cleanup',
          error: messageOf(cleanupError),
        });
      }
      return duplicateContactResponse();
    }
    try {
      await deleteFromR2(env, upload.key, 'applications');
    } catch (cleanupError) {
      return json({ error: `Failed to record application in database: ${insertError?.message || 'No inserted application was returned.'}`, cleanup_error: messageOf(cleanupError), orphaned_object_key: upload.key }, 502);
    }
    return errorResponse('Failed to record application in database. Please try again.', 500);
  }

  const applicationReference = insertedApplication.application_reference;
  const notificationRows = [
    {
      id: crypto.randomUUID(),
      application_id: applicationId,
      notification_type: 'student_confirmation',
      recipient_email: fields.email,
      status: 'Pending',
      created_at: now,
    },
    {
      id: crypto.randomUUID(),
      application_id: applicationId,
      notification_type: 'staff_notification',
      recipient_email: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
      status: 'Pending',
      created_at: now,
    },
  ];
  const notificationResult = await withApplicationErasureWriteLease(
    supabase,
    applicationId,
    async () => {
  let applicationNotificationQueueAvailable = false;
  let applicationNotificationQueueErrorCode: string | undefined;
  try {
    const { error } = await supabase.from('application_notifications').insert(notificationRows);
    applicationNotificationQueueAvailable = !error;
    applicationNotificationQueueErrorCode = error?.code;
  } catch {
    applicationNotificationQueueErrorCode = 'request_failed';
  }
  if (!applicationNotificationQueueAvailable) {
    console.error('Application was saved but notification tracking could not be queued.', {
      operation: 'applications.submit.notification_queue',
      error_code: applicationNotificationQueueErrorCode || 'database_query_failed',
    });
  }

  const [studentEmail, academyEmail] = await Promise.all([sendEmail(env, {
    to: fields.email,
    subject: "Application Received — Uptrend's English Academy",
    content: {
      title: 'Application Received',
      greeting: fields.student_name,
      paragraphs: [
        `Thank you for applying to Uptrend's English Academy for ${fields.program_name}.`,
        'Your application has been received and is awaiting review by our team.',
      ],
      status: 'Awaiting review',
      details: [{ label: 'Application Reference', value: applicationReference }],
    },
    idempotencyKey: `application-student-confirmation-${applicationId}`,
  }), sendEmail(env, {
    to: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Student Application — ${fields.student_name}`,
    content: {
      title: 'New Student Application Received',
      paragraphs: ['A new student application has been submitted for review.'],
      status: 'Pending',
      details: [
        { label: 'Student', value: fields.student_name },
        { label: 'Program', value: fields.program_name },
        { label: 'Mobile', value: fields.mobile },
        { label: 'Email', value: fields.email },
        { label: 'Qualification', value: fields.qualification },
        { label: 'Reference', value: applicationReference },
      ],
    },
    idempotencyKey: `application-staff-notification-${applicationId}`,
  })]);

  const emailResults = [studentEmail, academyEmail];
  for (const [index, result] of emailResults.entries()) {
    const row = notificationRows[index];
    if (!result.success) {
      console.error('Application notification delivery failed.', {
        operation: `applications.submit.${row.notification_type}`,
        error: result.error || 'Resend did not confirm delivery.',
      });
    }
    if (!applicationNotificationQueueAvailable) continue;
    try {
      const { error: updateError } = await supabase.from('application_notifications').update({
        status: result.success ? 'Sent' : 'Failed',
        provider_message_id: result.provider_message_id,
        error_message: result.error || null,
        sent_at: result.success ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (updateError) throw updateError;
    } catch (error) {
      console.error('Application notification result could not be recorded.', {
        operation: 'applications.submit.notification_update',
        notification_type: row.notification_type,
        error_code: (error as { code?: string }).code || 'request_failed',
      });
    }
  }
      return null;
    },
  );
  if (isResponse(notificationResult)) {
    console.error('Application emails were not sent because its deletion workflow is active.', {
      operation: 'applications.submit.erasure_guard',
      status: notificationResult.status,
    });
  }

  return contactAcknowledgement();
};

const submitDemoClassRequest = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const validation = validateDemoClassRequest(body);
  if (!validation.valid) return errorResponse(validation.error, 400);

  const supabase = getSupabaseClient(env, true, 'demo_class_requests.submit');
  if (!supabase) return errorResponse('Demo class requests are unavailable because Supabase is not configured.', 503);

  const requestRecord = {
    ...validation.value,
    email: normalizeContactEmail(validation.value.email),
    mobile: normalizeIndianMobileNumber(validation.value.mobile),
  };
  if (!requestRecord.mobile || !isValidContactEmail(requestRecord.email)) {
    return errorResponse('Enter a valid email address and Indian mobile number.', 400);
  }
  const duplicate = await checkContactDuplicates(supabase, 'demo_class_requests', requestRecord.email, requestRecord.mobile);
  if (isResponse(duplicate)) return duplicate;
  if (duplicate) return duplicateContactResponse();

  const { data: saved, error: insertError } = await supabase
    .from('demo_class_requests')
    .insert({
      ...requestRecord,
      status: 'Pending',
    })
    .select('id')
    .single();

  if (insertError || !saved) {
    if (insertError && isDuplicateContactError(insertError)) return duplicateContactResponse();
    return errorResponse('Unable to save the demo class request. Please try again.', 500);
  }

  const { full_name, email, mobile, qualification_category, educational_qualification, city } = requestRecord;
  const internalEmail = env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com';
  await sendRequestEmails(env, [
    {
      notification_type: 'applicant_confirmation',
      recipient_email: email,
      subject: "Demo Class Request Received — Uptrend's English Academy",
      content: {
        title: 'Free Demo Class Request Received',
        greeting: full_name,
        paragraphs: ['Thank you for requesting a free demo class at Uptrend\'s English Academy. Our team will contact you soon to discuss arrangements.'],
        status: 'Pending',
      },
    },
    {
      notification_type: 'academy_notification',
      recipient_email: internalEmail,
      subject: `New Demo Class Request — ${full_name}`,
      content: {
        title: 'New Free Demo Class Request',
        paragraphs: ['A new free demo class request has been received.'],
        status: 'Pending',
        details: [
          { label: 'Student', value: full_name },
          { label: 'Mobile', value: mobile },
          { label: 'Email', value: email },
          { label: 'Category', value: qualification_category },
          { label: 'Qualification / Course', value: educational_qualification },
          { label: 'City', value: city },
        ],
      },
    },
  ]);

  return contactAcknowledgement();
};

const submitCallback = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.consent !== true) return errorResponse('Consent is required to submit this request.', 400);
  const supabase = getSupabaseClient(env, true, 'callbacks.submit');
  if (!supabase) return errorResponse('Callback requests are unavailable because Supabase is not configured.', 503);

  const fullName = requiredString(body.full_name, 'Full name', 300);
  const mobile = requiredString(body.mobile, 'Mobile number', 30);
  const preferredTime = requiredString(body.preferred_contact_time, 'Preferred contact time', 20);
  if (isResponse(fullName)) return fullName;
  if (isResponse(mobile)) return mobile;
  if (isResponse(preferredTime)) return preferredTime;
  if (!['Morning', 'Afternoon', 'Evening'].includes(preferredTime)) return errorResponse('Preferred contact time must be Morning, Afternoon, or Evening.', 400);
  const normalizedMobile = normalizeIndianMobileNumber(mobile);
  if (!normalizedMobile) return errorResponse('Please provide a valid Indian mobile number.', 400);
  const email = optionalString(body.email, 'email', 320);
  const programName = optionalString(body.program_name, 'program name', 300);
  const message = optionalString(body.message, 'message', 5000);
  if (isResponse(email)) return email;
  if (isResponse(programName)) return programName;
  if (isResponse(message)) return message;
  if (email && !isValidContactEmail(email)) return errorResponse('Please provide a valid email address.', 400);
  const normalizedEmail = email ? normalizeContactEmail(email) : null;

  const record = {
    full_name: fullName,
    mobile: normalizedMobile,
    email: normalizedEmail,
    program_name: programName || 'General Inquiry',
    preferred_contact_time: preferredTime,
    message,
    consent: true,
    status: 'Pending',
  };
  const duplicate = await checkContactDuplicates(supabase, 'callback_requests', record.email, record.mobile);
  if (isResponse(duplicate)) return duplicate;
  if (duplicate) return duplicateContactResponse();
  const { data: saved, error } = await supabase
    .from('callback_requests')
    .insert(record)
    .select('id')
    .single();
  if (error || !saved) {
    if (isDuplicateContactError(error)) return duplicateContactResponse();
    return errorResponse('Failed to record callback request. Please try again.', 500);
  }

  await sendRequestEmails(env, [{
    notification_type: 'academy_notification',
    recipient_email: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Callback Request — ${fullName} (${preferredTime})`,
    content: {
      title: 'New Callback Request',
      paragraphs: ['A new callback request has been received.'],
      status: 'Pending',
      details: [
        { label: 'Applicant', value: fullName },
        { label: 'Mobile', value: normalizedMobile },
        { label: 'Email', value: normalizedEmail || 'Not provided' },
        { label: 'Program', value: programName || 'General Inquiry' },
        { label: 'Preferred Time', value: preferredTime },
        { label: 'Message', value: message || 'None' },
      ],
    },
  }]);
  return contactAcknowledgement();
};

const approveApplication = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const applicationId = requiredString(body.application_id, 'Application ID', 64);
  if (isResponse(applicationId)) return applicationId;
  if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);

  const approverName = optionalString(body.approved_by_name, 'approved_by_name', 300);
  if (isResponse(approverName)) return approverName;
  if (!body.joining_information || typeof body.joining_information !== 'object' ||
    Array.isArray(body.joining_information)) {
    return errorResponse('Joining information is required to approve an application.', 400);
  }
  const joiningBody = body.joining_information as Record<string, unknown>;
  const joiningInformation = {
    joiningDate: requiredString(joiningBody.joiningDate, 'Joining date', 100),
    classSchedule: requiredString(joiningBody.classSchedule, 'Class schedule', 200),
    classTimings: requiredString(joiningBody.classTimings, 'Class timings', 200),
    venue: requiredString(joiningBody.venue, 'Venue', 500),
  };
  for (const value of Object.values(joiningInformation)) {
    if (isResponse(value)) return value;
    if (value.toLowerCase() === 'to be confirmed') {
      return errorResponse('Replace every unconfirmed joining detail before approving.', 400);
    }
  }
  const { data: approvalResult, error: approvalError } = await auth.supabase.rpc(
    'approve_application_with_official_snapshot',
    {
      p_application_id: applicationId,
      p_approver_id: auth.profile.id,
      p_approver_name: approverName || auth.profile.full_name || 'Authorized Staff',
      p_joining_information: joiningInformation,
    },
  );
  if (approvalError || !approvalResult || typeof approvalResult !== 'object') {
    console.error('Unable to atomically approve application and snapshot its document.', {
      operation: 'applications.approve.official_snapshot',
      error_code: approvalError?.code || 'invalid_response',
    });
    return errorResponse('The application could not be approved and its official document snapshot was not created.', 500);
  }
  const result = approvalResult as {
    application?: Record<string, unknown>;
    issuance?: Record<string, unknown>;
  };
  const application = result.application;
  const issuance = result.issuance;
  if (!application || !issuance ||
    typeof application.student_name !== 'string' ||
    typeof application.email !== 'string' ||
    typeof application.application_reference !== 'string' ||
    typeof application.student_id !== 'string' ||
    typeof issuance.id !== 'string' ||
    typeof issuance.snapshot !== 'object' ||
    issuance.snapshot === null) {
    return errorResponse('The official document snapshot returned incomplete application data.', 500);
  }
  const pdfBytes = await ensureIssuedOfficialPdf(
    auth.supabase,
    env,
    issuance,
    issuance.snapshot,
    applicationId,
  );
  if (isResponse(pdfBytes)) return pdfBytes;
  const approvalEmail = buildApprovalEmail(issuance.snapshot, pdfBytes);
  if (isResponse(approvalEmail)) return approvalEmail;
  const approvalDelivery = await withApplicationErasureWriteLease(
    auth.supabase,
    applicationId,
    async () => {
  const { data: previousNotification, error: previousNotificationError } = await auth.supabase
    .from('application_notifications')
    .select('id,status')
    .eq('application_id', applicationId)
    .eq('notification_type', 'student_approval')
    .maybeSingle();
  if (previousNotificationError) {
    return errorResponse('Unable to verify the previous approval email result.', 500);
  }
  if (previousNotification?.status === 'Sent') {
    return json({
      success: true,
      message: 'Application approved successfully.',
      email_status: 'Already sent',
      pdf_attached: true,
      application_reference: application.application_reference,
      student_id: application.student_id,
    });
  }
  const emailResult = await sendEmail(env, {
    ...approvalEmail,
    idempotencyKey: `student-approval-${applicationId}`,
  });
  const notificationUpdate = {
    status: emailResult.success ? 'Sent' : 'Failed',
    provider_message_id: emailResult.provider_message_id,
    error_message: emailResult.error || null,
    sent_at: emailResult.success ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const notificationWrite = previousNotification?.id
    ? await auth.supabase.from('application_notifications')
      .update(notificationUpdate)
      .eq('id', previousNotification.id)
    : await auth.supabase.from('application_notifications').insert({
      application_id: applicationId,
      notification_type: 'student_approval',
      recipient_email: approvalEmail.to,
      ...notificationUpdate,
    });
  if (notificationWrite.error) {
    console.error('Approval email delivery result could not be recorded.', {
      operation: 'applications.approve.email_result',
      error_code: notificationWrite.error.code || 'database_query_failed',
    });
    return errorResponse('The approval email was processed, but its delivery result could not be recorded.', 500);
  }

  return json({
    success: true,
    message: 'Application approved successfully.',
    email_status: emailResult.success
      ? 'Sent with official PDF attachment'
      : `Failed: ${emailResult.error || 'Email provider did not confirm delivery.'}`,
    pdf_attached: true,
    application_reference: application.application_reference,
    student_id: application.student_id,
  });
    },
  );
  if (isResponse(approvalDelivery)) return approvalDelivery;
  return approvalDelivery;
};

const recoverHistoricalOfficialDocument = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const applicationId = requiredString(body.application_id, 'Application ID', 64);
  if (isResponse(applicationId)) return applicationId;
  if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);

  const { data: recoveryResult, error: recoveryError } = await auth.supabase.rpc(
    'create_historical_official_document_version_one',
    { p_application_id: applicationId },
  );
  if (recoveryError || !recoveryResult || typeof recoveryResult !== 'object' ||
    !recoveryResult.issuance || typeof recoveryResult.issuance !== 'object') {
    console.error('Historical official document recovery was refused or failed.', {
      operation: 'official_document.historical_recovery.create',
      error_code: recoveryError?.code || 'invalid_response',
    });
    return errorResponse(
      recoveryError?.message || 'Historical Version 1 recovery could not be completed because the evidence was incomplete.',
      recoveryError ? 409 : 500,
    );
  }

  const issuance = recoveryResult.issuance as Record<string, any>;
  const pdfBytes = await ensureIssuedOfficialPdf(
    auth.supabase,
    env,
    issuance,
    issuance.snapshot,
    applicationId,
  );
  if (isResponse(pdfBytes)) return pdfBytes;

  return json({
    success: true,
    created: recoveryResult.created === true,
    email_sent: false,
    issuance_id: issuance.id,
    version_number: issuance.version_number,
    status: 'ready',
    message: recoveryResult.created === true
      ? 'Historical Version 1 was recovered and stored without sending an approval email.'
      : 'The existing historical Version 1 was reused without sending an approval email.',
  });
};

const updateProfile = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const updates: Record<string, unknown> = {};
  if (body.role !== undefined) {
    if (!['staff', 'admin', 'super_admin'].includes(String(body.role))) return errorResponse('role must be staff, admin, or super_admin.', 400);
    updates.role = body.role;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
    updates.is_active = body.is_active;
  }
  if (!Object.keys(updates).length) return errorResponse('role or is_active is required.', 400);
  if (id === auth.profile.id && updates.is_active === false) return errorResponse('Cannot deactivate your own super admin account.', 400);

  const { data, error } = await auth.supabase.from('admin_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select(READ_COLUMNS.profiles).maybeSingle();
  if (error) return errorResponse(`Failed to update admin profile: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Admin profile not found.', 404);
};

const archiveApplication = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data: existing, error: readError } = await auth.supabase
    .from('applications')
    .select('id,archived_at,archived_by')
    .eq('id', id)
    .maybeSingle();
  if (readError) return errorResponse('Unable to load application for archiving.', 500);
  if (!existing) return errorResponse('Application not found.', 404);
  if (existing.archived_at) return json(existing);

  const { data, error } = await auth.supabase
    .from('applications')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: auth.profile.id,
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('id,archived_at,archived_by')
    .maybeSingle();
  if (error) return errorResponse('Unable to archive application.', 500);
  if (data) return json(data);

  const { data: archived, error: archiveReadError } = await auth.supabase
    .from('applications')
    .select('id,archived_at,archived_by')
    .eq('id', id)
    .maybeSingle();
  if (archiveReadError) return errorResponse('Unable to verify application archive status.', 500);
  return archived ? json(archived) : errorResponse('Application not found.', 404);
};

const restoreApplication = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data: existing, error: readError } = await auth.supabase
    .from('applications')
    .select('id,archived_at,archived_by')
    .eq('id', id)
    .maybeSingle();
  if (readError) return errorResponse('Unable to load application for restoration.', 500);
  if (!existing) return errorResponse('Application not found.', 404);
  if (!existing.archived_at) return json(existing);

  const { data, error } = await auth.supabase
    .from('applications')
    .update({ archived_at: null, archived_by: null })
    .eq('id', id)
    .not('archived_at', 'is', null)
    .select('id,archived_at,archived_by')
    .maybeSingle();
  if (error) return errorResponse('Unable to restore application.', 500);
  if (data) return json(data);

  const { data: restored, error: restoreReadError } = await auth.supabase
    .from('applications')
    .select('id,archived_at,archived_by')
    .eq('id', id)
    .maybeSingle();
  if (restoreReadError) return errorResponse('Unable to verify application restoration status.', 500);
  return restored ? json(restored) : errorResponse('Application not found.', 404);
};

type ApplicationErasureJob = {
  job_id: string;
  application_id: string;
  status: 'storage_pending' | 'storage_failed' | 'database_failed' | 'completed';
  object_keys: string[];
};

const isApplicationErasureObjectKey = (applicationId: string, key: string): boolean => {
  return /^applications\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(key) &&
    validId(applicationId);
};

const recordApplicationErasureFailure = async (
  supabase: SupabaseClient,
  jobId: string,
  errorCode: 'storage_listing_failed' | 'storage_cleanup_failed' | 'object_key_unverified' | 'database_finalize_failed',
  status: 'storage_failed' | 'database_failed',
): Promise<void> => {
  const { error } = await supabase.rpc('fail_application_erasure', {
    p_job_id: jobId,
    p_error_code: errorCode,
    p_status: status,
  });
  if (error) {
    console.error('Unable to persist application erasure failure state.', {
      operation: 'admin.applications.delete.failure_state',
      error_code: error.code || 'database_query_failed',
    });
  }
};

const deleteApplicationErasureObjects = async (
  bucket: NonNullable<Env['APPLICATION_MEDIA']>,
  applicationId: string,
  keys: string[],
): Promise<boolean> => {
  if (!bucket.get) return false;
  for (const key of keys) {
    if (!isApplicationErasureObjectKey(applicationId, key)) return false;
    try {
      const existing = await bucket.get(key);
      if (existing) {
        if (existing.body) await existing.body.cancel();
        await bucket.delete(key);
      }
      const remaining = await bucket.get(key);
      if (remaining) {
        if (remaining.body) await remaining.body.cancel();
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
};

const deleteApplication = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.confirmation !== 'DELETE') {
    return errorResponse('Type DELETE to confirm permanent application erasure.', 400);
  }

  const { data: preservationReady, error: preservationError } = await auth.supabase.rpc(
    'application_erasure_document_preservation_ready',
  );
  if (preservationError || preservationReady !== true) {
    console.error('Application erasure is disabled because official-document preservation is not confirmed.', {
      operation: 'admin.applications.delete.document_preservation_gate',
      error_code: preservationError?.code || 'preservation_gate_unavailable',
    });
    return errorResponse(
      'Permanent application erasure is unavailable until the official-document preservation migration is applied.',
      503,
    );
  }

  const { data: started, error: startError } = await auth.supabase.rpc(
    'begin_application_erasure',
    { p_application_id: id, p_deleted_by: auth.profile.id },
  );
  if (startError) {
    if (startError.message.includes('application_erasure_dependency_conflict')) {
      return errorResponse(
        'Deletion is blocked because application history contains a cross-application reference. No files or records were deleted.',
        409,
      );
    }
    if (startError.message.includes('application_erasure_photo_not_exclusive')) {
      return errorResponse(
        'The application photo cannot be verified as exclusive to this application. No files or records were deleted.',
        409,
      );
    }
    if (startError.message.includes('application_erasure_policy_not_approved')) {
      return errorResponse(
        'Permanent erasure is disabled until legal/accounting approval is recorded and R2 versioning and retention settings are verified in the database policy.',
        409,
      );
    }
    if (startError.message.includes('application_erasure_writes_active')) {
      return errorResponse('An application payment or document operation is still in progress. Retry deletion shortly.', 409);
    }
    if (startError.message.includes('application_erasure_in_progress')) {
      return errorResponse('Application deletion is already in progress. Retry to resume its cleanup.', 409);
    }
    console.error('Unable to start application erasure.', {
      operation: 'admin.applications.delete.begin',
      error_code: startError.code || 'database_query_failed',
    });
    return errorResponse('Unable to start permanent application erasure.', 500);
  }

  const startedJob = Array.isArray(started) ? started[0] as ApplicationErasureJob | undefined : undefined;
  if (!startedJob) return errorResponse('Application not found.', 404);
  if (!validId(startedJob.job_id)) {
    return errorResponse('The application cleanup job returned an invalid identifier.', 500);
  }
  if (!validId(startedJob.application_id) ||
    !['storage_pending', 'storage_failed', 'database_failed'].includes(startedJob.status) ||
    !Array.isArray(startedJob.object_keys) ||
    startedJob.object_keys.some((key) => typeof key !== 'string' ||
      !isApplicationErasureObjectKey(startedJob.application_id, key))) {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'object_key_unverified',
      'storage_failed',
    );
    return json({
      job_id: startedJob.job_id,
      status: 'storage_failed',
      error: 'A stored application file reference could not be verified. No database records were deleted.',
    }, 202);
  }

  const bucket = env.APPLICATION_MEDIA;
  if (!bucket?.get || !bucket.delete) {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'storage_cleanup_failed',
      'storage_failed',
    );
    return json({
      job_id: startedJob.job_id,
      status: 'storage_failed',
      error: 'Private R2 storage is unavailable. The application and database records remain pending cleanup.',
    }, 202);
  }

  const requestedKeys = [...new Set(startedJob.object_keys)].sort();
  const { data: recorded, error: recordError } = await auth.supabase.rpc(
    'record_application_erasure_objects',
    { p_job_id: startedJob.job_id, p_object_keys: requestedKeys },
  );
  if (recordError) {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'object_key_unverified',
      'storage_failed',
    );
    return json({
      job_id: startedJob.job_id,
      status: 'storage_failed',
      error: 'Application-owned storage references could not be safely recorded. No files or database rows were deleted.',
    }, 202);
  }

  const recordedJob = Array.isArray(recorded) ? recorded[0] as ApplicationErasureJob | undefined : undefined;
  if (!recordedJob ||
    recordedJob.job_id !== startedJob.job_id ||
    recordedJob.application_id !== startedJob.application_id ||
    !Array.isArray(recordedJob.object_keys) ||
    recordedJob.object_keys.some((key) => typeof key !== 'string' ||
      !isApplicationErasureObjectKey(startedJob.application_id, key))) {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'object_key_unverified',
      'storage_failed',
    );
    return json({
      job_id: startedJob.job_id,
      status: 'storage_failed',
      error: 'The saved storage inventory could not be verified. No database rows were deleted.',
    }, 202);
  }

  const verifiedKeys = [...new Set(recordedJob.object_keys)].sort();
  if (!await deleteApplicationErasureObjects(bucket, startedJob.application_id, verifiedKeys)) {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'storage_cleanup_failed',
      'storage_failed',
    );
    return json({
      job_id: startedJob.job_id,
      status: 'storage_failed',
      error: 'Some application-owned files remain or could not be verified. Retry deletion to resume cleanup; database records remain intact.',
    }, 202);
  }

  const { data: completed, error: completeError } = await auth.supabase.rpc(
    'complete_application_erasure',
    { p_job_id: startedJob.job_id, p_verified_object_keys: verifiedKeys },
  );
  if (completeError) {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'database_finalize_failed',
      'database_failed',
    );
    console.error('Application storage cleanup completed but database erasure did not.', {
      operation: 'admin.applications.delete.database_finalize',
      error_code: completeError.code || 'database_query_failed',
    });
    return json({
      job_id: startedJob.job_id,
      status: 'database_failed',
      error: 'Storage cleanup is verified, but the database transaction failed and was rolled back. Retry deletion to finish.',
    }, 202);
  }

  const completedJob = Array.isArray(completed) ? completed[0] as {
    job_id?: string;
    status?: string;
    deleted_counts?: Record<string, number>;
  } | undefined : undefined;
  if (completedJob?.job_id !== startedJob.job_id || completedJob.status !== 'completed') {
    await recordApplicationErasureFailure(
      auth.supabase,
      startedJob.job_id,
      'database_finalize_failed',
      'database_failed',
    );
    return json({
      job_id: startedJob.job_id,
      status: 'database_failed',
      error: 'The database did not confirm completion. Retry deletion to verify and finish cleanup.',
    }, 202);
  }
  return json({
    job_id: startedJob.job_id,
    status: 'completed',
    deleted_counts: completedJob.deleted_counts || {},
  });
};

const getApplicationErasureJob = async (
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase.rpc(
    'get_application_erasure_job',
    { p_job_id: jobId },
  );
  if (error) return errorResponse('Unable to load application cleanup status.', 500);
  const job = Array.isArray(data) ? data[0] : null;
  if (!job) return errorResponse('Application cleanup job not found.', 404);
  return json(job);
};

const updateApplicationStatus = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.status !== 'Pending') {
    return errorResponse('Applications can only be returned to Pending here; use the approval action to accept an application.', 400);
  }

  const { data, error } = await auth.supabase.from('applications')
    .update({
      status: 'Pending',
      approved_by_user_id: null,
      approved_by_name: null,
      approved_at: null,
    })
    .eq('id', id)
    .select(READ_COLUMNS.applications)
    .maybeSingle();
  if (error) return errorResponse(`Unable to update application status: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Application record not found.', 404);
};

const updateRequestStatus = async (
  request: Request,
  env: Env,
  table: 'callback_requests',
  id: string,
  allowedStatuses: readonly string[],
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (typeof body.status !== 'string' || !allowedStatuses.includes(body.status)) {
    return errorResponse(`status must be one of: ${allowedStatuses.join(', ')}.`, 400);
  }

  const { data, error } = await auth.supabase.from(table)
    .update({ status: body.status })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return errorResponse(`Unable to update request status: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Request record not found.', 404);
};

const DEMO_CLASS_STATUSES = ['Pending', 'Contacted', 'Scheduled', 'Completed', 'Cancelled'] as const;

const updateDemoClassRequestStatus = async (
  request: Request,
  env: Env,
  id: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (typeof body.status !== 'string' || !DEMO_CLASS_STATUSES.includes(body.status as typeof DEMO_CLASS_STATUSES[number])) {
    return errorResponse(`status must be one of: ${DEMO_CLASS_STATUSES.join(', ')}.`, 400);
  }

  const { data, error } = await auth.supabase
    .from('demo_class_requests')
    .update({ status: body.status, updated_by_user_id: auth.profile.id })
    .eq('id', id)
    .select('id,full_name,mobile,email,qualification_category,parent_name,school_or_college_name,college_name,profession,educational_qualification,date_of_birth,address,city,additional_information,status,created_at')
    .maybeSingle();
  if (error) return errorResponse(`Unable to update demo request status: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Demo class request not found.', 404);
};

const getDemoClassRequestPhoto = async (
  request: Request,
  env: Env,
  id: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase
    .from('demo_class_requests')
    .select('photo_object_key')
    .eq('id', id)
    .maybeSingle();
  if (error) return errorResponse(`Unable to load applicant photo record: ${error.message}`, 500);
  if (!data) return errorResponse('Demo class request not found.', 404);

  const key = data.photo_object_key;
  if (typeof key !== 'string' || !/^demo-class-requests\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)) {
    return errorResponse('Applicant photo storage metadata is invalid.', 500);
  }
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket?.get) return errorResponse('Private applicant photo storage is not configured.', 503);

  try {
    const object = await bucket.get(key);
    if (!object?.body) return errorResponse('Applicant photo was not found in private storage.', 404);
    const contentType = object.httpMetadata?.contentType;
    if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return errorResponse('Applicant photo has an unsupported stored content type.', 500);
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (photoError) {
    console.error('Unable to retrieve private demo applicant photo.', {
      error: messageOf(photoError),
    });
    return errorResponse('Unable to retrieve applicant photo from private storage.', 502);
  }
};

const validateOfficialDocumentSettings = (
  value: unknown,
): OfficialDocumentSettings | Response => {
  const settings = mergeOfficialDocumentSettings(value);
  if (!settings || !isValidOfficialDocumentSettings(settings)) {
    return errorResponse('Document settings contain invalid fields.', 400);
  }
  const textFields: Array<[string, string, number]> = [
    ['academyName', settings.academyName, 200],
    ['address', settings.address, 1000],
    ['phone', settings.phone, 100],
    ['email', settings.email, 320],
    ['hours', settings.hours, 200],
    ['heading', settings.heading, 200],
    ['subtitle', settings.subtitle, 300],
    ['approvalMessage', settings.approvalMessage, 200],
    ['welcomeMessage', settings.welcomeMessage, 3000],
    ['footerText', settings.footerText, 300],
    ['motivationalTagline', settings.motivationalTagline, 300],
  ];
  for (const [field, text, limit] of textFields) {
    if (text.length > limit) return errorResponse(`${field} must be ${limit} characters or fewer.`, 400);
  }
  if (!settings.academyName.trim() || !settings.heading.trim() || !settings.approvalMessage.trim()) {
    return errorResponse('Academy name, heading, and approval message are required.', 400);
  }
  if (settings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) {
    return errorResponse('Please enter a valid academy email address.', 400);
  }
  if ((settings.joiningInstructions || []).length > 30 ||
    (settings.joiningInstructions || []).some((instruction) => !instruction.trim() || instruction.length > 500)) {
    return errorResponse('Provide up to 30 non-empty joining instructions, each no longer than 500 characters.', 400);
  }
  if (Object.values(settings.sectionHeadings).some((heading) => !heading.trim() || heading.length > 100)) {
    return errorResponse('Section headings must be non-empty and no longer than 100 characters.', 400);
  }
  if (new Set(settings.layout.sectionOrder).size !== settings.layout.sectionOrder.length) {
    return errorResponse('Each PDF section must appear once in the section order.', 400);
  }
  if (settings.typography.titleSize < 12 || settings.typography.titleSize > 24 ||
    settings.typography.headingSize < 8 || settings.typography.headingSize > 16 ||
    settings.typography.bodySize < 7 || settings.typography.bodySize > 14 ||
    settings.layout.spacing < 0.75 || settings.layout.spacing > 1.75) {
    return errorResponse('Typography sizes or document spacing are outside supported limits.', 400);
  }
  const validAssetKey = (key: string | null) =>
    key === null || /^official-document-assets\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
  if (!validAssetKey(settings.logoObjectKey) || !validAssetKey(settings.graphicObjectKey)) {
    return errorResponse('Uploaded PDF asset references are invalid.', 400);
  }
  return settings;
};

const getOfficialDocumentSettings = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;

  const { data, error } = await auth.supabase
    .from('official_document_settings')
    .select('document_data, updated_at, updated_by')
    .eq('setting_key', 'admission_approval')
    .maybeSingle();

  if (error) {
    return errorResponse(
      `Unable to load official document settings: ${error.message}`,
      500,
    );
  }

  const settings = mergeOfficialDocumentSettings(data?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('Saved official document settings are invalid.', 500);
  return json({
    settings,
    updated_at: data?.updated_at ?? null,
    updated_by: data?.updated_by ?? null,
  });
};

const saveOfficialDocumentSettings = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    return errorResponse('Document settings must be a JSON object.', 400);
  }
  const { data: currentData, error: currentError } = await auth.supabase
    .from('official_document_settings')
    .select('document_data')
    .eq('setting_key', 'admission_approval')
    .maybeSingle();
  if (currentError) return errorResponse('Unable to load current official document settings.', 500);
  const currentSettings = mergeOfficialDocumentSettings(currentData?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!currentSettings) return errorResponse('Saved official document settings are invalid.', 500);
  const supplied = body.settings as Record<string, unknown>;
  const candidate = {
    ...currentSettings,
    ...supplied,
    sectionHeadings: {
      ...currentSettings.sectionHeadings,
      ...(supplied.sectionHeadings && typeof supplied.sectionHeadings === 'object' ? supplied.sectionHeadings : {}),
    },
    colors: {
      ...currentSettings.colors,
      ...(supplied.colors && typeof supplied.colors === 'object' ? supplied.colors : {}),
    },
    typography: {
      ...currentSettings.typography,
      ...(supplied.typography && typeof supplied.typography === 'object' ? supplied.typography : {}),
    },
    layout: {
      ...currentSettings.layout,
      ...(supplied.layout && typeof supplied.layout === 'object' ? supplied.layout : {}),
    },
  };

  const uploadedAssets: Array<{ key: string; field: 'logoObjectKey' | 'graphicObjectKey' }> = [];
  for (const [field, settingField] of [
    ['logo_file_base64', 'logoObjectKey'],
    ['graphic_file_base64', 'graphicObjectKey'],
  ] as const) {
    if (body[field] === undefined) continue;
    const image = decodeImage(body[field], MAX_BRANDING_LOGO_HERO_IMAGE_BYTES);
    if (isResponse(image)) return image;
    if (image.mime !== 'image/png' && image.mime !== 'image/jpeg') {
      return errorResponse('Official PDF logos and graphics must be JPEG or PNG images.', 400);
    }
    const upload = await uploadToR2(env, image, 'official-document-assets');
    if (isResponse(upload)) {
      for (const asset of uploadedAssets) {
        try { await deleteFromR2(env, asset.key, 'official-document-assets'); } catch (cleanupError) {
          console.error('Unable to clean up an unused official document image.', { error: messageOf(cleanupError) });
        }
      }
      return upload;
    }
    uploadedAssets.push({ key: upload.key, field: settingField });
    candidate[settingField] = upload.key;
  }

  const validated = validateOfficialDocumentSettings(candidate);
  if (isResponse(validated)) {
    for (const asset of uploadedAssets) {
      try { await deleteFromR2(env, asset.key, 'official-document-assets'); } catch (cleanupError) {
        console.error('Unable to clean up an invalid official document image.', { error: messageOf(cleanupError) });
      }
    }
    return validated;
  }

  const { data, error } = await auth.supabase
    .from('official_document_settings')
    .upsert(
      {
        setting_key: 'admission_approval',
        document_data: validated,
        updated_at: new Date().toISOString(),
        updated_by: auth.profile.id,
      },
      { onConflict: 'setting_key' },
    )
    .select('document_data, updated_at, updated_by')
    .single();

  if (error) {
    for (const asset of uploadedAssets) {
      try { await deleteFromR2(env, asset.key, 'official-document-assets'); } catch (cleanupError) {
        console.error('Unable to clean up an unsaved official document image.', { error: messageOf(cleanupError) });
      }
    }
    return errorResponse(
      `Unable to save official document settings: ${error.message}`,
      500,
    );
  }

  return json({
    settings: data.document_data,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
  });
};

const responseWithPdf = (bytes: Uint8Array, filename: string, disposition: 'inline' | 'attachment'): Response => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

const previewOfficialDocument = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const applicationId = typeof body.application_id === 'string' ? body.application_id : '';
  if (!validId(applicationId)) return errorResponse('Select an approved application to preview its admission document.', 400);
  const { data: application, error: applicationError } = await auth.supabase
    .from('applications')
    .select('id,status,student_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) return errorResponse('Unable to load the selected application for preview.', 503);
  if (!application || application.status !== 'Accepted' || !application.student_id) {
    return errorResponse('Preview is available only for an approved application with a Student ID.', 409);
  }

  const { data: saved, error: settingsError } = await auth.supabase
    .from('official_document_settings')
    .select('document_data')
    .eq('setting_key', 'admission_approval')
    .maybeSingle();
  if (settingsError) return errorResponse('Unable to load official document settings.', 503);
  const baseSettings = mergeOfficialDocumentSettings(saved?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!baseSettings) return errorResponse('Saved official document settings are invalid.', 503);
  const settings = body.settings === undefined
    ? baseSettings
    : validateOfficialDocumentSettings({
      ...baseSettings,
      ...(body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
        ? body.settings as Record<string, unknown>
        : {}),
      sectionHeadings: {
        ...baseSettings.sectionHeadings,
        ...((body.settings as Record<string, unknown> | undefined)?.sectionHeadings as Record<string, unknown> || {}),
      },
      colors: {
        ...baseSettings.colors,
        ...((body.settings as Record<string, unknown> | undefined)?.colors as Record<string, unknown> || {}),
      },
      typography: {
        ...baseSettings.typography,
        ...((body.settings as Record<string, unknown> | undefined)?.typography as Record<string, unknown> || {}),
      },
      layout: {
        ...baseSettings.layout,
        ...((body.settings as Record<string, unknown> | undefined)?.layout as Record<string, unknown> || {}),
      },
    });
  if (isResponse(settings)) return settings;

  const { data: savedSnapshot, error: snapshotError } = await auth.supabase.rpc(
    'build_official_document_snapshot',
    { p_application_id: applicationId, p_joining_information: null },
  );
  if (snapshotError || !savedSnapshot || typeof savedSnapshot !== 'object' || Array.isArray(savedSnapshot)) {
    return errorResponse('Unable to build a preview from the selected application.', 503);
  }
  const snapshot = {
    ...(savedSnapshot as Record<string, unknown>),
    document_settings: settings,
    preview_only: true,
  };
  const bytes = await generatePdfFromSnapshot(env, snapshot);
  if (isResponse(bytes)) return bytes;
  return responseWithPdf(bytes, 'Official_Document_PREVIEW.pdf', body.download === true ? 'attachment' : 'inline');
};

const getOfficialDocumentVersions = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const applicationId = url.searchParams.get('application_id') || '';
  const applicationReference = url.searchParams.get('application_reference') || '';
  if ((!validId(applicationId) && !/^UEA-APP-[0-9]{4}-[0-9]+$/.test(applicationReference)) ||
    (applicationId && applicationReference)) {
    return errorResponse('A valid application_id or application_reference is required.', 400);
  }
  const issuanceType = url.searchParams.get('issuance_type') || 'approval';
  if (issuanceType !== 'approval' && issuanceType !== 'payment_update') {
    return errorResponse('issuance_type must be approval or payment_update.', 400);
  }
  let query = auth.supabase
    .from('official_document_issuances')
    .select('version_number,issuance_type,status,email_status,generated_at,created_at,snapshot')
    .eq('issuance_type', issuanceType)
    .order('version_number', { ascending: false });
  query = validId(applicationId)
    ? query.eq('application_id', applicationId)
    : query.eq('application_reference', applicationReference);
  const { data, error } = await query;
  if (error) return errorResponse('Unable to load official document version history.', 500);
  const versions = (data || []).map((issuance: Record<string, any>) => ({
    version_number: issuance.version_number,
    issuance_type: issuance.issuance_type,
    status: issuance.status,
    email_status: issuance.email_status,
    generated_at: issuance.generated_at,
    created_at: issuance.created_at,
  }));
  return json(versions);
};

const getIssuedOfficialDocument = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const applicationId = url.searchParams.get('application_id') || '';
  const applicationReference = url.searchParams.get('application_reference') || '';
  if ((!validId(applicationId) && !/^UEA-APP-[0-9]{4}-[0-9]+$/.test(applicationReference)) ||
    (applicationId && applicationReference)) {
    return errorResponse('A valid application_id or application_reference is required.', 400);
  }
  const issuanceType = url.searchParams.get('issuance_type') || 'approval';
  if (issuanceType !== 'approval' && issuanceType !== 'payment_update') {
    return errorResponse('issuance_type must be approval or payment_update.', 400);
  }
  const requestedVersion = url.searchParams.get('version');
  if (requestedVersion !== null && (!/^\d+$/.test(requestedVersion) || Number(requestedVersion) < 1)) {
    return errorResponse('version must be a positive integer.', 400);
  }
  let issuanceQuery = auth.supabase
    .from('official_document_issuances')
    .select('id,application_id,application_reference,version_number,issuance_type,snapshot,pdf_object_key,status')
    .eq('issuance_type', issuanceType);
  issuanceQuery = validId(applicationId)
    ? issuanceQuery.eq('application_id', applicationId)
    : issuanceQuery.eq('application_reference', applicationReference);
  if (requestedVersion !== null) {
    issuanceQuery = issuanceQuery.eq('version_number', Number(requestedVersion));
  } else {
    issuanceQuery = issuanceQuery.eq('status', 'ready').order('version_number', { ascending: false }).limit(1);
  }
  const { data: issuance, error } = await issuanceQuery.maybeSingle();
  if (error) return errorResponse('Unable to load the issued official document.', 500);
  if (!issuance) return errorResponse('No official document has been issued for this application.', 404);
  if (issuance.status !== 'ready') return errorResponse('This document version is not ready for download.', 409);
  const documentApplicationId = typeof issuance.application_id === 'string'
    ? issuance.application_id
    : typeof issuance.snapshot?.application?.id === 'string'
      ? issuance.snapshot.application.id
      : '';
  if (!validId(documentApplicationId)) {
    return errorResponse('The saved document is missing its original application identifier.', 409);
  }
  const bytes = await ensureIssuedOfficialPdf(
    auth.supabase,
    env,
    issuance,
    issuance.snapshot,
    documentApplicationId,
  );
  if (isResponse(bytes)) return bytes;
  return responseWithPdf(
    bytes,
    `Issued_V${issuance.version_number}_${issuance.application_reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`,
    'attachment',
  );
};

const getOfficialDocumentAsset = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const assetType = new URL(request.url).searchParams.get('type');
  if (assetType !== 'logo' && assetType !== 'graphic') return errorResponse('Asset type must be logo or graphic.', 400);
  const auth = await requireAdmin(request, env, assetType === 'logo' ? 'staff' : 'admin');
  if (isResponse(auth)) return auth;
  const settings = await loadOfficialDocumentSettings(auth.supabase);
  if (isResponse(settings)) return settings;
  const key = assetType === 'logo' ? settings.logoObjectKey : settings.graphicObjectKey;
  if (!key) return errorResponse('This PDF image has not been configured.', 404);
  const asset = await readPrivateR2Object(env, key, 'official-document-assets');
  if (isResponse(asset)) return asset;
  const buffer = new ArrayBuffer(asset.bytes.byteLength);
  new Uint8Array(buffer).set(asset.bytes);
  return new Response(buffer, {
    headers: {
      'Content-Type': asset.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

const updateBranding = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (auth.profile.role !== 'super_admin') {
    const allowedFields = new Set(['hero_photo_file_base64', 'hero_photo_url']);
    if (
      Object.keys(body).some((field) => !allowedFields.has(field)) ||
      (body.hero_photo_file_base64 === undefined && body.hero_photo_url !== null) ||
      (body.hero_photo_url !== undefined && body.hero_photo_url !== null)
    ) {
      return errorResponse('Admins may only upload a new hero photo or remove the current hero photo.', 403);
    }
  }
  const normalizedBody = { ...body };
  if (body.main_logo_alt !== undefined) normalizedBody.logo_alt = body.main_logo_alt;
  if (body.primary_color !== undefined) normalizedBody.primary_orange = body.primary_color;
  if (body.secondary_color !== undefined) normalizedBody.primary_green = body.secondary_color;
  const columns = [
    'academy_name', 'tagline', 'logo_url', 'logo_alt', 'favicon_url',
    'footer_logo_url', 'hero_photo_url', 'primary_orange', 'primary_green',
  ] as const;
  const imageColumns = ['logo_url', 'favicon_url', 'footer_logo_url', 'hero_photo_url'] as const;
  const updates: Record<string, unknown> = {};
  const uploadedImages: Array<{ column: (typeof imageColumns)[number]; key: string; url: string }> = [];
  const imageFields = [
    { field: 'logo_file_base64', column: 'logo_url' },
    { field: 'favicon_file_base64', column: 'favicon_url' },
    { field: 'footer_logo_file_base64', column: 'footer_logo_url' },
    { field: 'hero_photo_file_base64', column: 'hero_photo_url' },
  ] as const;
  const cleanupUploadedImages = async () => {
    for (const image of uploadedImages) {
      try {
        await deleteFromR2(env, image.key, 'branding');
      } catch (error) {
        console.error('[branding_upload_cleanup_failed]', {
          key: image.key,
          error: messageOf(error),
        });
      }
    }
  };

  for (const { field, column } of imageFields) {
    if (body[field] === undefined) continue;
    const image = decodeImage(
      body[field],
      field === 'favicon_file_base64' ? MAX_BRANDING_IMAGE_BYTES : MAX_BRANDING_LOGO_HERO_IMAGE_BYTES,
      field === 'favicon_file_base64',
    );
    if (isResponse(image)) {
      await cleanupUploadedImages();
      return image;
    }
    const upload = await uploadToR2(env, image, 'branding');
    if (isResponse(upload)) {
      await cleanupUploadedImages();
      return upload;
    }
    uploadedImages.push({ column, key: upload.key, url: upload.url });
    updates[column] = upload.url;
  }

  for (const column of columns) {
    if (column === 'hero_photo_url' && body.hero_photo_file_base64 !== undefined) continue;
    if (normalizedBody[column] === undefined) continue;
    if (['academy_name', 'tagline', 'logo_alt'].includes(column)) {
      const value = optionalString(normalizedBody[column], column, 500);
      if (isResponse(value)) {
        await cleanupUploadedImages();
        return value;
      }
      updates[column] = value;
    } else {
      const value = optionalString(normalizedBody[column], column, 2048);
      if (isResponse(value)) {
        await cleanupUploadedImages();
        return value;
      }
      if (
        (column === 'primary_orange' || column === 'primary_green') &&
        value !== null &&
        !/^#[0-9a-f]{6}$/i.test(value)
      ) {
        await cleanupUploadedImages();
        return errorResponse(`${column} must be a six-digit hexadecimal color.`, 400);
      }
      updates[column] = value;
    }
  }
  if (!Object.keys(updates).length) {
    await cleanupUploadedImages();
    return errorResponse('At least one branding field is required.', 400);
  }
  if (updates.academy_name === null) updates.academy_name = "Uptrend's English Academy";
  if (updates.tagline === null) updates.tagline = 'Professional Spoken English & Communication Skills';
  if (updates.logo_alt === null) updates.logo_alt = "Uptrend's English Academy Davangere Logo";
  if (updates.favicon_url === null) updates.favicon_url = '/favicon.ico';
  if (updates.primary_orange === null) updates.primary_orange = '#ea580c';
  if (updates.primary_green === null) updates.primary_green = '#16a34a';
  updates.updated_at = new Date().toISOString();

  const { data: existing, error: readError } = await auth.supabase
    .from('site_branding')
    .select('id,logo_url,favicon_url,footer_logo_url,hero_photo_url')
    .limit(1)
    .maybeSingle();
  if (readError) {
    await cleanupUploadedImages();
    return errorResponse(`Unable to load site branding: ${readError.message}`, 500);
  }
  const result = existing?.id
    ? await auth.supabase.from('site_branding').update(updates).eq('id', existing.id).select().single()
    : await auth.supabase.from('site_branding').insert({
      id: crypto.randomUUID(),
      academy_name: "Uptrend's English Academy",
      tagline: 'Professional Spoken English & Communication Skills',
      logo_alt: "Uptrend's English Academy Davangere Logo",
      favicon_url: '/favicon.ico',
      primary_orange: '#ea580c',
      primary_green: '#16a34a',
      ...updates,
    }).select().single();
  if (result.error) {
    await cleanupUploadedImages();
    return errorResponse(`Failed to update site branding: ${result.error.message}`, 500);
  }

  for (const column of imageColumns) {
    if (updates[column] === undefined) continue;
    const previousKey = objectKeyFromMetadata(env, existing?.[column], 'branding');
    const replacementKey = uploadedImages.find((image) => image.column === column)?.key;
    if (!previousKey || previousKey === replacementKey) continue;
    try {
      await deleteFromR2(env, previousKey, 'branding');
    } catch (error) {
      console.error('[branding_old_asset_cleanup_failed]', {
        key: previousKey,
        error: messageOf(error),
      });
    }
  }

  return json(result.data);
};

const methodNotAllowed = (methods: string[]) => json({ error: 'Method not allowed for this API route.' }, 405, { Allow: methods.join(', ') });

/*
Manual Payment Register handler blueprint.
Integrate these handlers into worker-api.ts, where the existing
Env, requireAdmin, parseJson, validId, isResponse, json, and
errorResponse helpers are available.
*/

type PaymentStage =
  | 'first_payment'
  | 'second_payment'
  | 'installment'
  | 'final_payment';

type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'bank_transfer'
  | 'card'
  | 'cheque'
  | 'other';

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other',
];

const PAYMENT_STAGES: PaymentStage[] = [
  'first_payment', 'second_payment', 'installment', 'final_payment',
];

const paymentAmount = (value: unknown): number | Response => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-8
  ) {
    return errorResponse(
      'Amount must be a positive number with at most two decimal places.',
      400,
    );
  }
  return value;
};

const paymentMethod = (value: unknown): PaymentMethod | Response => {
  if (
    typeof value !== 'string' ||
    !PAYMENT_METHODS.includes(value as PaymentMethod)
  ) {
    return errorResponse('Invalid payment method.', 400);
  }
  return value as PaymentMethod;
};

const paymentStage = (value: unknown): PaymentStage | Response => {
  if (
    typeof value !== 'string' ||
    !PAYMENT_STAGES.includes(value as PaymentStage)
  ) {
    return errorResponse('Invalid payment stage.', 400);
  }
  return value as PaymentStage;
};

const paymentApplicationExists = async (
  supabase: SupabaseClient,
  applicationId: string,
) => supabase
  .from('applications')
  .select('id,application_reference,student_name,program_name,status')
  .eq('id', applicationId)
  .maybeSingle();

const getApplicationPayments = async (
  request: Request,
  env: Env,
  applicationId: string,
): Promise<Response> => {
  if (!validId(applicationId)) {
    return errorResponse('Application ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;

  const { data: application, error: appError } =
    await paymentApplicationExists(auth.supabase, applicationId);

  if (appError) {
    return errorResponse('Unable to load the application.', 500);
  }
  if (!application) {
    return errorResponse('Application not found.', 404);
  }
  if (application.status !== 'Accepted') {
    return errorResponse('Payment records are available only for approved students.', 409);
  }

  const { data: payments, error: paymentsError } = await auth.supabase
    .from('application_payments')
    .select('id,application_id,application_reference,student_id,student_name,student_email,student_mobile,program_name,receipt_object_key,amount,payment_method,payment_stage,recorded_at,reference_number,notes,recorded_by,updated_by,created_at,updated_at')
    .eq('application_id', applicationId)
    .order('recorded_at', { ascending: false });

  if (paymentsError) {
    return errorResponse('Unable to load payment records.', 500);
  }

  const paymentRecords = payments || [];
  const totalPaid = paymentRecords.reduce(
    (sum, item) => sum + Number(item.amount),
    0,
  );

  return json({
    payments: paymentRecords,
    totalPaid: Math.round(totalPaid * 100) / 100,
  });
};

const getAdminPayments = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const rawSearch = new URL(request.url).searchParams.get('search')?.trim() || '';
  if (rawSearch.length > 100 || !/^[A-Za-z0-9 _.-]*$/.test(rawSearch)) {
    return errorResponse('Payment search may contain only letters, numbers, spaces, periods, underscores, and hyphens.', 400);
  }
  let query = auth.supabase
    .from('application_payments')
    .select('id,application_id,application_reference,student_id,student_name,student_email,student_mobile,program_name,receipt_object_key,amount,payment_method,payment_stage,recorded_at,reference_number,notes,recorded_by,updated_by,created_at,updated_at')
    .order('recorded_at', { ascending: false });
  if (rawSearch) {
    const pattern = `%${rawSearch}%`;
    query = query.or([
      `student_name.ilike.${pattern}`,
      `application_reference.ilike.${pattern}`,
      `student_id.ilike.${pattern}`,
      `program_name.ilike.${pattern}`,
      `reference_number.ilike.${pattern}`,
    ].join(','));
  }
  const { data, error } = await query.limit(1000);
  if (error) return errorResponse('Unable to load payment records.', 500);
  const payments = data || [];
  const totalPaid = Math.round(payments.reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100;
  return json({ payments, totalPaid, truncated: payments.length === 1000 });
};

const createApplicationPayment = async (
  request: Request,
  env: Env,
  applicationId: string,
): Promise<Response> => {
  if (!validId(applicationId)) {
    return errorResponse('Application ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey || !validId(idempotencyKey)) {
    return errorResponse('A valid Idempotency-Key header is required to record a payment.', 400);
  }

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const amount = paymentAmount(body.amount);
  if (isResponse(amount)) return amount;

  const method = paymentMethod(body.payment_method);
  if (isResponse(method)) return method;

  const stage = paymentStage(body.payment_stage);
  if (isResponse(stage)) return stage;

  const reference = body.reference_number === undefined
    ? null
    : body.reference_number;
  const notes = body.notes === undefined ? null : body.notes;

  if (reference !== null && typeof reference !== 'string') {
    return errorResponse('Reference number must be text.', 400);
  }
  if (notes !== null && typeof notes !== 'string') {
    return errorResponse('Notes must be text.', 400);
  }
  if (
    typeof reference === 'string' && reference.length > 200 ||
    typeof notes === 'string' && notes.length > 2000
  ) {
    return errorResponse('Reference or notes exceed the allowed length.', 400);
  }

  const { data, error } = await auth.supabase.rpc(
    'create_application_payment_idempotent',
    {
      p_application_id: applicationId,
      p_actor: auth.profile.id,
      p_amount: amount,
      p_method: method,
      p_stage: stage,
      p_reference: reference,
      p_notes: notes,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (error) {
    return errorResponse('Unable to record payment.', 400);
  }

  const savedPayment = data as Record<string, unknown> | null;
  const paymentId = typeof savedPayment?.id === 'string' ? savedPayment.id : '';
  const paymentTimestamp = typeof savedPayment?.updated_at === 'string'
    ? savedPayment.updated_at
    : typeof savedPayment?.created_at === 'string' ? savedPayment.created_at : '';
  const issuanceId = paymentId
    ? await enqueuePaymentDocumentVersion(
      auth.supabase,
      applicationId,
      `payment:${paymentId}:created${paymentTimestamp ? `:${paymentTimestamp}` : ''}`,
    )
    : null;
  const documentUpdate = issuanceId
    ? await processPaymentDocumentIssuance(auth.supabase, env, issuanceId)
    : { success: false, status: 'failed', error: 'Payment was saved, but its PDF version could not be created.' };
  return json({ payment: data, document_update: documentUpdate }, 201);
};

const updateApplicationPayment = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  if (!validId(paymentId)) {
    return errorResponse('Payment ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const amount = paymentAmount(body.amount);
  if (isResponse(amount)) return amount;

  const method = paymentMethod(body.payment_method);
  if (isResponse(method)) return method;

  const stage = paymentStage(body.payment_stage);
  if (isResponse(stage)) return stage;

  const reference = body.reference_number === undefined
    ? null
    : body.reference_number;
  const notes = body.notes === undefined ? null : body.notes;

  if (reference !== null && typeof reference !== 'string') {
    return errorResponse('Reference number must be text.', 400);
  }
  if (notes !== null && typeof notes !== 'string') {
    return errorResponse('Notes must be text.', 400);
  }
  if (
    typeof reference === 'string' && reference.length > 200 ||
    typeof notes === 'string' && notes.length > 2000
  ) {
    return errorResponse('Reference or notes exceed the allowed length.', 400);
  }

  const { data, error } = await auth.supabase.rpc(
    'update_application_payment',
    {
      p_payment_id: paymentId,
      p_actor: auth.profile.id,
      p_amount: amount,
      p_method: method,
      p_stage: stage,
      p_reference: reference,
      p_notes: notes,
    },
  );

  if (error) {
    return errorResponse('Unable to update payment.', 400);
  }

  const updatedPayment = data as Record<string, unknown> | null;
  const applicationId = typeof updatedPayment?.application_id === 'string' ? updatedPayment.application_id : '';
  if (!applicationId) {
    return json({
      payment: data,
      document_update: { success: true, status: 'not_applicable' },
    });
  }
  const paymentTimestamp = typeof updatedPayment?.updated_at === 'string' ? updatedPayment.updated_at : '';
  const issuanceId = updatedPayment?.id
    ? await enqueuePaymentDocumentVersion(
      auth.supabase,
      applicationId,
      `payment:${String(updatedPayment.id)}:updated${paymentTimestamp ? `:${paymentTimestamp}` : ''}`,
    )
    : null;
  const documentUpdate = issuanceId
    ? await processPaymentDocumentIssuance(auth.supabase, env, issuanceId)
    : { success: false, status: 'failed', error: 'Payment was saved, but its PDF version could not be created.' };
  return json({ payment: data, document_update: documentUpdate });
};

const deleteApplicationPayment = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  if (!validId(paymentId)) {
    return errorResponse('Payment ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const { data, error } = await auth.supabase.rpc(
    'delete_application_payment',
    {
      p_payment_id: paymentId,
      p_actor: auth.profile.id,
    },
  );

  if (error) {
    return errorResponse('Unable to delete payment.', 400);
  }

  const deletedPayment = data as Record<string, unknown> | null;
  const applicationId = typeof deletedPayment?.application_id === 'string' ? deletedPayment.application_id : '';
  if (!applicationId) return json({ result: data });
  const deletedPaymentId = typeof deletedPayment?.payment_id === 'string' ? deletedPayment.payment_id : paymentId;
  const issuanceId = await enqueuePaymentDocumentVersion(
    auth.supabase,
    applicationId,
    `payment:${deletedPaymentId}:deleted`,
  );
  const documentUpdate = issuanceId
    ? await processPaymentDocumentIssuance(auth.supabase, env, issuanceId)
    : { success: false, status: 'failed', error: 'Payment was deleted, but its document update could not be created.' };
  return json({ result: data, document_update: documentUpdate });
};

const generatePaymentReceipt = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const receipt = await ensurePaymentReceiptPdf(auth.supabase, env, paymentId);
  if (isResponse(receipt)) return receipt;
  return json({
    success: true,
    status: 'ready',
    payment_id: paymentId,
    receipt_url: `/api/admin/payments/${paymentId}/receipt/file`,
  });
};

const downloadPaymentReceipt = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const receipt = await ensurePaymentReceiptPdf(auth.supabase, env, paymentId);
  if (isResponse(receipt)) return receipt;
  return responseWithPdf(
    receipt.bytes,
    `Payment_Receipt_${paymentId}.pdf`,
    'attachment',
  );
};

const emailPaymentReceipt = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const receipt = await ensurePaymentReceiptPdf(auth.supabase, env, paymentId);
  if (isResponse(receipt)) return receipt;
  const email = typeof receipt.context.application.email === 'string'
    ? receipt.context.application.email.trim()
    : '';
  if (!email) return errorResponse('The retained payment has no student email address.', 422);
  const reference = String(receipt.context.application.application_reference || paymentId)
    .replace(/[^A-Za-z0-9_-]/g, '_');
  const sendReceiptEmail = async () => {
      const emailResult = await sendEmail(env, {
        to: email,
        subject: `Payment receipt — ${receipt.context.application.application_reference}`,
        content: {
          title: 'Payment Receipt',
          greeting: receipt.context.application.student_name,
          paragraphs: ['Please find your payment receipt attached.'],
          details: [{
            label: 'Application Reference',
            value: receipt.context.application.application_reference,
          }],
        },
        attachments: [{ filename: `Payment_Receipt_${reference}.pdf`, content: toBase64(receipt.bytes) }],
        idempotencyKey: `payment-receipt-v2-${paymentId}`,
      });
      if (!emailResult.success) {
        return errorResponse(emailResult.error || 'The payment receipt email could not be sent.', 502);
      }
      return json({ success: true, status: 'sent' });
  };
  const result = receipt.context.application.id
    ? await withApplicationErasureWriteLease(
      auth.supabase,
      String(receipt.context.application.id),
      sendReceiptEmail,
    )
    : await sendReceiptEmail();
  return isResponse(result) ? result : errorResponse('The payment receipt email result is invalid.', 500);
};


export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  try {
    const origin = request.headers.get('origin');
    if (origin) {
      let requestOrigin: string;
      try {
        requestOrigin = new URL(origin).origin;
      } catch {
        return errorResponse('Invalid Origin header.', 400);
      }
      if (requestOrigin !== new URL(request.url).origin) {
        return errorResponse('Cross-origin API requests are not allowed.', 403);
      }
    }

    if (pathname === '/api/system-status' && method === 'GET') {
      logBindingPresence(env);
      const [supabaseHealth, resendHealth, r2Health] = await Promise.all([
        checkSupabaseHealth(env),
        checkResendHealth(env),
        checkR2Health(env),
      ]);
      return json({
        supabase: supabaseHealth,
        resend: resendHealth,
        r2_storage: r2Health,
        server_time: new Date().toISOString(),
      });
    }

    if (pathname === '/api/programs' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.programs.read');
      return supabase ? readTable(supabase, 'programs', READ_COLUMNS.programs, { publishedColumn: 'is_published', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/announcements' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.announcements.read');
      return supabase ? readTable(supabase, 'announcements', READ_COLUMNS.announcements, { publishedColumn: 'is_active', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/media' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.media.read');
      return supabase ? readTable(supabase, 'media_items', READ_COLUMNS.media, { publishedColumn: 'is_published', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/faqs' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.faqs.read');
      return supabase ? readTable(supabase, 'faqs', READ_COLUMNS.faqs, { publishedColumn: 'is_published', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/branding' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.branding.read');
      if (!supabase) return errorResponse('Supabase is not configured.', 503);
      const { data, error } = await supabase.from('site_branding').select('id,academy_name,tagline,logo_url,logo_alt,favicon_url,footer_logo_url,hero_photo_url,primary_orange,primary_green,updated_at').limit(1).maybeSingle();
      if (error) return errorResponse(`Unable to read branding: ${error.message}`, 500);
      return json(data || {});
    }
    if (pathname === '/api/about-us/assets') {
      if (method !== 'GET') return methodNotAllowed(['GET']);
      const objectKey = new URL(request.url).searchParams.get('key');
      if (!isAboutUsObjectKey(objectKey)) return errorResponse('Invalid About Us image key.', 400);
      return readAboutUsAsset(env, objectKey, true);
    }
    if (pathname === '/api/admin/about-us/assets') {
      if (method === 'POST') return uploadAboutUsAsset(request, env);
      if (method === 'GET' || method === 'DELETE') {
        const auth = await requireAdmin(request, env, 'super_admin');
        if (isResponse(auth)) return auth;
        const objectKey = new URL(request.url).searchParams.get('key');
        if (!isAboutUsObjectKey(objectKey)) return errorResponse('Invalid About Us image key.', 400);
        if (method === 'GET') return readAboutUsAsset(env, objectKey, false);
        return deleteAboutUsAsset(env, auth.supabase, objectKey);
      }
      return methodNotAllowed(['GET', 'POST', 'DELETE']);
    }

    if (pathname === '/api/apply' && method === 'POST') return submitApplication(request, env);
    if (pathname === '/api/demo-class-requests' && method === 'POST') return submitDemoClassRequest(request, env);
    if (pathname === '/api/callback-request' && method === 'POST') return submitCallback(request, env);
    if (pathname === '/api/approve-application' && method === 'POST') return approveApplication(request, env);

    if (pathname === '/api/admin/programs') {
      if (method === 'GET') return adminTable(request, env, 'programs', READ_COLUMNS.programs, 'display_order', true, 'admin');
      if (method === 'POST') return createProgram(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/announcements') {
      if (method === 'GET') return adminTable(request, env, 'announcements', READ_COLUMNS.announcements, 'display_order', true, 'admin');
      if (method === 'POST') return createAnnouncement(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/faqs') {
      if (method === 'GET') return adminTable(request, env, 'faqs', READ_COLUMNS.faqs, 'display_order', true, 'super_admin');
      if (method === 'POST') return createFaq(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/reviews') {
      if (method === 'GET') return adminTable(request, env, 'reviews', READ_COLUMNS.reviews, 'created_at', false, 'staff');
      if (method === 'POST') return createReview(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/media') {
      if (method === 'GET') return adminTable(request, env, 'media_items', READ_COLUMNS.media, 'display_order', true, 'admin');
      if (method === 'POST') return createMedia(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }

    const applicationErasureJobRoute = pathname.match(
      /^\/api\/admin\/application-erasure-jobs\/([^/]+)$/,
    );
    if (applicationErasureJobRoute) {
      let jobId: string;
      try { jobId = decodeURIComponent(applicationErasureJobRoute[1]); } catch {
        return errorResponse('Invalid application cleanup job ID.', 400);
      }
      if (!validId(jobId)) return errorResponse('Application cleanup job ID must be a valid UUID.', 400);
      if (method === 'GET') return getApplicationErasureJob(request, env, jobId);
      return methodNotAllowed(['GET']);
    }

    // Manual Payment Register routes; independent of application approval.
    const applicationPaymentRoute = pathname.match(
      /^\/api\/admin\/applications\/([^/]+)\/payments$/
    );
    if (applicationPaymentRoute) {
      let applicationId: string;
      try {
        applicationId = decodeURIComponent(applicationPaymentRoute[1]);
      } catch {
        return errorResponse('Invalid application ID.', 400);
      }
      if (!validId(applicationId)) {
        return errorResponse('Application ID must be a valid UUID.', 400);
      }

      if (method === 'GET') return getApplicationPayments(request, env, applicationId);
      if (method === 'POST') return createApplicationPayment(request, env, applicationId);
      return methodNotAllowed(['GET', 'POST']);
    }

    const paymentIdRoute = pathname.match(/^\/api\/admin\/payments\/([^/]+)$/);
    if (paymentIdRoute) {
      let paymentId: string;
      try {
        paymentId = decodeURIComponent(paymentIdRoute[1]);
      } catch {
        return errorResponse('Invalid payment ID.', 400);
      }
      if (!validId(paymentId)) {
        return errorResponse('Payment ID must be a valid UUID.', 400);
      }
      if (method === 'PUT') return updateApplicationPayment(request, env, paymentId);
      if (method === 'DELETE') return deleteApplicationPayment(request, env, paymentId);
      return methodNotAllowed(['PUT', 'DELETE']);
    }

    const paymentReceiptRoute = pathname.match(/^\/api\/admin\/payments\/([^/]+)\/receipt(?:\/(file|email))?$/);
    if (paymentReceiptRoute) {
      let paymentId: string;
      try {
        paymentId = decodeURIComponent(paymentReceiptRoute[1]);
      } catch {
        return errorResponse('Invalid payment ID.', 400);
      }
      if (!validId(paymentId)) return errorResponse('Payment ID must be a valid UUID.', 400);
      const action = paymentReceiptRoute[2] || 'generate';
      if (action === 'generate' && method === 'POST') return generatePaymentReceipt(request, env, paymentId);
      if (action === 'file' && method === 'GET') return downloadPaymentReceipt(request, env, paymentId);
      if (action === 'email' && method === 'POST') return emailPaymentReceipt(request, env, paymentId);
      return methodNotAllowed([action === 'file' ? 'GET' : 'POST']);
    }

    const demoPhotoRoute = pathname.match(/^\/api\/admin\/demo-class-requests\/([^/]+)\/photo$/);
    if (demoPhotoRoute) {
      let requestId: string;
      try { requestId = decodeURIComponent(demoPhotoRoute[1]); } catch {
        return errorResponse('Invalid demo class request ID.', 400);
      }
      if (!validId(requestId)) return errorResponse('Demo class request ID must be a valid UUID.', 400);
      if (method === 'GET') return getDemoClassRequestPhoto(request, env, requestId);
      return methodNotAllowed(['GET']);
    }

    const applicationArchiveRoute = pathname.match(/^\/api\/admin\/applications\/([^/]+)\/archive$/);
    if (applicationArchiveRoute) {
      let applicationId: string;
      try { applicationId = decodeURIComponent(applicationArchiveRoute[1]); } catch {
        return errorResponse('Invalid application ID.', 400);
      }
      if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);
      if (method === 'POST') return archiveApplication(request, env, applicationId);
      return methodNotAllowed(['POST']);
    }

    const applicationRestoreRoute = pathname.match(/^\/api\/admin\/applications\/([^/]+)\/restore$/);
    if (applicationRestoreRoute) {
      let applicationId: string;
      try { applicationId = decodeURIComponent(applicationRestoreRoute[1]); } catch {
        return errorResponse('Invalid application ID.', 400);
      }
      if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);
      if (method === 'POST') return restoreApplication(request, env, applicationId);
      return methodNotAllowed(['POST']);
    }

    const idRoute = pathname.match(/^\/api\/admin\/(programs|announcements|reviews|faqs|media|applications|demo-class-requests|callbacks|profiles)\/([^/]+)$/);
    if (idRoute) {
      let id: string;
      try { id = decodeURIComponent(idRoute[2]); } catch { return errorResponse('Invalid resource ID.', 400); }
      if (!validId(id)) return errorResponse('Resource ID must be a valid UUID.', 400);
      const resource = idRoute[1];
      if (resource === 'programs') {
        if (method === 'PUT') return updateProgram(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'programs', id, 'admin', 'Program');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'announcements') {
        if (method === 'PUT') return updateAnnouncement(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'announcements', id, 'admin', 'Announcement');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'faqs') {
        if (method === 'PUT') return updateFaq(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'faqs', id, 'super_admin', 'FAQ');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'reviews') {
        if (method === 'PUT') return updateReview(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'reviews', id, 'staff', 'Review');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'media') {
        if (method === 'PUT') return updateMedia(request, env, id);
        if (method === 'DELETE') return deleteMedia(request, env, id);
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'applications') {
        if (method === 'PUT') return updateApplicationStatus(request, env, id);
        if (method === 'DELETE') return deleteApplication(request, env, id);
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'demo-class-requests') {
        if (method === 'PUT') return updateDemoClassRequestStatus(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'demo_class_requests', id, 'admin', 'Demo class request');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'callbacks') {
        if (method === 'PUT') return updateRequestStatus(request, env, 'callback_requests', id, ['Pending', 'Contacted', 'Completed']);
        if (method === 'DELETE') return deleteRow(request, env, 'callback_requests', id, 'staff', 'Callback request');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'profiles' && method === 'PUT') return updateProfile(request, env, id);
      return methodNotAllowed(resource === 'profiles' ? ['PUT'] : ['PUT', 'DELETE']);
    }

    if (pathname === '/api/admin/applications' && method === 'GET') return getAdminApplications(request, env);
    if (pathname === '/api/admin/payments') {
      if (method === 'GET') return getAdminPayments(request, env);
      return methodNotAllowed(['GET']);
    }
    if (pathname === '/api/admin/demo-class-requests' && method === 'GET') return adminTable(request, env, 'demo_class_requests', READ_COLUMNS.demoClassRequests, 'created_at');
    if (pathname === '/api/admin/notifications' && method === 'GET') return adminTable(request, env, 'application_notifications', READ_COLUMNS.notifications, 'created_at', false, 'super_admin');
    if (pathname === '/api/admin/callbacks' && method === 'GET') return adminTable(request, env, 'callback_requests', READ_COLUMNS.callbacks, 'created_at');
    if (pathname === '/api/admin/profiles' && method === 'GET') return adminTable(request, env, 'admin_profiles', READ_COLUMNS.profiles, 'created_at', true, 'super_admin');
    if (pathname === '/api/admin/branding' && method === 'PUT') return updateBranding(request, env);
    if (pathname === '/api/admin/official-document' && method === 'GET') {
      return getOfficialDocumentSettings(request, env);
    }
    if (pathname === '/api/admin/official-document' && method === 'PUT') {
      return saveOfficialDocumentSettings(request, env);
    }
    if (pathname === '/api/admin/official-document/preview') {
      if (method === 'POST') return previewOfficialDocument(request, env);
      return methodNotAllowed(['POST']);
    }
    if (pathname === '/api/admin/official-document/historical-recovery' && method === 'POST') {
      return recoverHistoricalOfficialDocument(request, env);
    }
    if (pathname === '/api/admin/official-document/versions') {
      if (method === 'GET') return getOfficialDocumentVersions(request, env);
      return methodNotAllowed(['GET']);
    }
    if (pathname === '/api/admin/official-document/issued') {
      if (method === 'GET') return getIssuedOfficialDocument(request, env);
      return methodNotAllowed(['GET']);
    }
    if (pathname === '/api/admin/official-document/assets') {
      if (method === 'GET') return getOfficialDocumentAsset(request, env);
      return methodNotAllowed(['GET']);
    }

    if (pathname.startsWith('/api/')) {
      const allowedMethods: Record<string, string[]> = {
        '/api/system-status': ['GET'],
        '/api/programs': ['GET'],
        '/api/announcements': ['GET'],
        '/api/media': ['GET'],
        '/api/faqs': ['GET'],
        '/api/branding': ['GET'],
        '/api/about-us/assets': ['GET'],
        '/api/admin/about-us/assets': ['GET', 'POST', 'DELETE'],
        '/api/apply': ['POST'],
        '/api/demo-class-requests': ['POST'],
        '/api/callback-request': ['POST'],
        '/api/approve-application': ['POST'],
        '/api/admin/applications': ['GET'],
        '/api/admin/demo-class-requests': ['GET'],
        '/api/admin/notifications': ['GET'],
        '/api/admin/callbacks': ['GET'],
        '/api/admin/profiles': ['GET'],
        '/api/admin/branding': ['PUT'],
        '/api/admin/official-document': ['GET', 'PUT'],
        '/api/admin/programs': ['GET', 'POST'],
        '/api/admin/announcements': ['GET', 'POST'],
        '/api/admin/faqs': ['GET', 'POST'],
        '/api/admin/reviews': ['GET', 'POST'],
        '/api/admin/media': ['GET', 'POST'],
      };
      const allowed = allowedMethods[pathname];
      if (allowed) return methodNotAllowed(allowed);
      return errorResponse('API route not found.', 404);
    }
    return errorResponse('Not an API request.', 404);
  } catch (error) {
    const resource = pathname.match(/^\/api\/admin\/(programs|announcements|reviews|faqs|media|applications|demo-class-requests|callbacks|profiles)(?:\/|$)/)?.[1];
    const operation = pathname === '/api/system-status'
      ? 'system_status'
      : pathname.startsWith('/api/admin/')
        ? `admin.${resource || 'request'}`
        : pathname.startsWith('/api/')
          ? `public.${pathname.slice('/api/'.length).split('/')[0] || 'request'}`
          : 'api.request';
    logApiDiagnostic(operation, 'unhandled_exception');
    return errorResponse('The API request could not be completed.', 500);
  }
}
