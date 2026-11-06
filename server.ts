import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { legacyUploadFilenameFromMetadata, managedR2ObjectKeyFromMetadata } from './application-photo-storage';
import { handleApiRequest } from './worker-api';
import type { R2BucketBinding } from './worker-r2';
import {
  isValidContactEmail,
  normalizeContactEmail,
  normalizeIndianMobileNumber,
} from './contact-validation';
import { renderBrandedEmail, type EmailBranding } from './email-template';
import {
  applyEmailTemplate,
  DEFAULT_EMAIL_SETTINGS,
  normalizeEmailSettings,
} from './email-settings';
import { isAudienceTag } from './audience-tags';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_UPLOADS_DIRECTORY = path.resolve(__dirname, 'public/uploads');

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '.dev.vars') });

const app = express();
const PORT = process.env.PORT || 3000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

// -------------------------------------------------------------
// ENVIRONMENT VARIABLES & CLIENT INITIALIZATION
// -------------------------------------------------------------
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'admissions@uptrendsacademy.com';
const APPLICATION_NOTIFICATION_EMAIL = process.env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com';

// Initialize Supabase if keys exist
export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

const contactAcknowledgement = {
  success: true,
  message: 'We received your request. If it can be processed, the academy will contact you.',
};

// Initialize Resend if key exists
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Initialize Cloudflare R2 client (S3-compatible)
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'uptrends-academy-media';
const R2_PUBLIC_BUCKET = process.env.CLOUDFLARE_R2_PUBLIC_BUCKET_NAME || 'uptrends-academy-public';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL || '';

const r2Client = (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const createR2BucketBinding = (bucketName: string): R2BucketBinding | undefined =>
  r2Client
  ? {
      put: async (key, value, options) => {
        const body = value instanceof ArrayBuffer
          ? Buffer.from(value)
          : Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        await r2Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: options?.httpMetadata?.contentType,
        }));
      },
      delete: async (key) => {
        await r2Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      },
      get: async (key) => {
        let object;
        try {
          object = await r2Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        } catch (error) {
          const errorName = error instanceof Error ? error.name : '';
          const metadata = typeof error === 'object' && error !== null && '$metadata' in error
            ? error.$metadata
            : null;
          const statusCode = typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata
            ? metadata.httpStatusCode
            : null;
          if (errorName === 'NoSuchKey' || errorName === 'NotFound' || statusCode === 404) return null;
          throw error;
        }
        if (!object.Body) return null;
        const bytes = await object.Body.transformToByteArray();
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes));
              controller.close();
            },
          }),
          httpMetadata: { contentType: object.ContentType },
        };
      },
      list: async (options) => {
        const page = await r2Client.send(new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: options?.prefix,
          ContinuationToken: options?.cursor,
          MaxKeys: options?.limit,
        }));
        return {
          objects: (page.Contents || []).flatMap((object) =>
            object.Key ? [{ key: object.Key }] : [],
          ),
          truncated: page.IsTruncated,
          cursor: page.NextContinuationToken,
        };
      },
    }
  : undefined;

const applicationMedia = createR2BucketBinding(R2_BUCKET);
const publicMedia = createR2BucketBinding(R2_PUBLIC_BUCKET);

async function dispatchWorkerApi(req: express.Request, res: express.Response) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(', '));
    }

    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
    const requestBody = hasBody ? JSON.stringify(req.body ?? {}) : undefined;
    if (requestBody !== undefined) {
      headers.delete('content-length');
      headers.set('content-type', 'application/json');
    }

    const workerResponse = await handleApiRequest(
      new Request(url, {
        method: req.method,
        headers,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
      }),
      {
        SUPABASE_URL: process.env.SUPABASE_URL || SUPABASE_URL,
        VITE_SUPABASE_URL: SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
        SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY,
        APPLICATION_MEDIA: applicationMedia,
        PUBLIC_MEDIA: publicMedia,
        CLOUDFLARE_R2_PUBLIC_URL: R2_PUBLIC_URL,
        ASSETS: {
          fetch: async (assetInput: RequestInfo | URL, init?: RequestInit) => {
            const assetRequest = new Request(assetInput, init);
            const filename = legacyUploadFilenameFromMetadata(new URL(assetRequest.url).pathname);
            if (!filename) return new Response(null, { status: 404 });
            try {
              await fs.promises.access(path.join(LOCAL_UPLOADS_DIRECTORY, filename));
              return new Response(null, { status: 200 });
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return new Response(null, { status: 404 });
              }
              throw error;
            }
          },
        },
        RESEND_API_KEY,
        RESEND_FROM_EMAIL,
        APPLICATION_NOTIFICATION_EMAIL,
      },
    );
    res.status(workerResponse.status);
    workerResponse.headers.forEach((value, key) => res.setHeader(key, value));
    return res.send(Buffer.from(await workerResponse.arrayBuffer()));
  } catch (error) {
    console.error('Worker API bridge failed.', error);
    return res.status(500).json({ error: 'Unable to process this request.' });
  }
}

// -------------------------------------------------------------
// SERVER-SIDE AUTHENTICATION & ROLE-BASED ACCESS CONTROL
// -------------------------------------------------------------
async function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  minRole: 'staff' | 'admin' | 'super_admin' = 'staff'
): Promise<any | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  // Fail closed when Supabase is not configured.
  if (!supabase) {
    res.status(503).json({
      error: 'Admin authentication is unavailable because Supabase is not configured.',
    });
    return null;
  }

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Session Bearer token required.' });
    return null;
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication session.' });
      return null;
    }

    const { data: profile, error: profError } = await supabase
      .from('admin_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profError || !profile) {
      res.status(403).json({ error: 'Forbidden: No authorized admin profile linked to this user.' });
      return null;
    }

    if (!profile.is_active) {
      res.status(403).json({ error: 'Forbidden: This admin account has been deactivated.' });
      return null;
    }

    const roleRank: Record<string, number> = { staff: 1, admin: 2, super_admin: 3 };
    const userRank = roleRank[profile.role] || 0;
    const requiredRank = roleRank[minRole] || 1;

    if (userRank < requiredRank) {
      res.status(403).json({
        error: `Forbidden: This operation requires '${minRole}' role privileges. Your current role is '${profile.role}'.`,
      });
      return null;
    }

    return profile;
  } catch (err: any) {
    res.status(500).json({ error: 'Authentication verification error: ' + err.message });
    return null;
  }
}

// -------------------------------------------------------------
// IN-MEMORY FALLBACK STORE (Active only when external Supabase is unconfigured)
// -------------------------------------------------------------
interface MemoryStore {
  applications: any[];
  notifications: any[];
  callbacks: any[];
  programs: any[];
  announcements: any[];
  reviews: any[];
  media: any[];
  faqs: any[];
  branding: any;
  admin_profiles: any[];
}

const memoryStore: MemoryStore = {
  applications: [],
  notifications: [],
  callbacks: [],
  admin_profiles: [
    {
      id: '59bbb687-4e0d-47f7-b458-5a91955f915d',
      email: 'uptrendsinstitute@gmail.com',
      full_name: 'Academy Super Admin',
      role: 'super_admin',
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ],
  programs: [
    {
      id: '11111111-1111-1111-1111-111111111101',
      title: 'Spoken English Course — Beginner to Advanced',
      slug: 'spoken-english-course-beginner-to-advanced',
      short_description: 'Comprehensive conversational training designed to build fluency, vocabulary, and day-to-day spoken confidence.',
      description: 'A complete program tailored to eliminate hesitation, master correct pronunciation, and build natural fluency in everyday conversations, meetings, and presentations.',
      duration: '2–3 months',
      level: 'Foundation to Advanced',
      target_audience: 'Students, job seekers, professionals, and homemakers',
      age_range: null,
      image_url: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 1,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111102',
      title: 'Basic English Grammar & Vocabulary',
      slug: 'basic-english-grammar-and-vocabulary',
      short_description: 'Strengthen sentence construction, grammatical accuracy, and functional vocabulary.',
      description: 'Focuses on essential tenses, parts of speech, syntax, sentence structuring, and expanding daily vocabulary for clear written and spoken expression.',
      duration: '2 months',
      level: 'Foundation',
      target_audience: 'Beginners, school students, and college students',
      age_range: null,
      image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 2,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111103',
      title: 'Kids English Course',
      slug: 'kids-english-course',
      short_description: 'Interactive spoken English, storytelling, and phonics for young learners.',
      description: 'Engaging communication activities, pronunciation practice, and vocabulary building designed specifically for children.',
      duration: 'Ongoing',
      level: 'Beginner',
      target_audience: 'Children',
      age_range: 'Requires confirmation (Reference conflict: 5–12 vs 8–15)',
      image_url: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 3,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111104',
      title: 'Advanced English & Interview Preparation',
      slug: 'advanced-english-and-interview-preparation',
      short_description: 'Focused training in professional communication, group discussions, and job interview readiness.',
      description: 'Intensive module covering corporate communication, resume presentation, spontaneous answering techniques, personal interview practice, and body language.',
      duration: '1 month',
      level: 'Advanced',
      target_audience: 'Graduates, job seekers, and final-year students',
      age_range: null,
      image_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 4,
      created_at: new Date().toISOString()
    }
  ],
  announcements: [
    {
      id: '22222222-2222-2222-2222-222222222201',
      content: "Welcome to Uptrend's English Academy, Davangere! Admissions are open for English communication and spoken English training.",
      is_active: true,
      display_order: 1
    },
    {
      id: '22222222-2222-2222-2222-222222222202',
      content: "Visit our campus at Ram And Co Circle, Devi Building, 2nd Floor, Davangere or call +91 900 8000 211.",
      is_active: true,
      display_order: 2
    },
    {
      id: '22222222-2222-2222-2222-222222222203',
      content: "Practical conversation practice and grammar fundamentals tailored for students, professionals, and homemakers.",
      is_active: true,
      display_order: 3
    }
  ],
  reviews: [
    {
      id: '44444444-4444-4444-4444-444444444401',
      author_name: 'Vinay Kumar',
      rating: 5,
      review_text: 'The spoken English classes helped me overcome my stage fear and speaking hesitation. The interactive conversation practice at Ram and Co Circle center made a big difference.',
      source: 'Verified Student',
      is_published: true,
      created_at: '2026-09-15T10:00:00Z'
    },
    {
      id: '44444444-4444-4444-4444-444444444402',
      author_name: 'Pooja Patil',
      rating: 5,
      review_text: 'Grammar fundamentals and vocabulary sessions were explained in a very easy-to-understand manner. Great environment for anyone looking to improve in Davangere.',
      source: 'Verified Student',
      is_published: true,
      created_at: '2026-10-02T14:30:00Z'
    },
    {
      id: '44444444-4444-4444-4444-444444444403',
      author_name: 'Ramesh Nayak',
      rating: 5,
      review_text: 'The interview preparation session gave me the confidence to attend campus interviews with positive body language and structured communication.',
      source: 'Verified Graduate',
      is_published: true,
      created_at: '2026-10-18T09:15:00Z'
    }
  ],
  media: [
    {
      id: '55555555-5555-5555-5555-555555555501',
      media_type: 'video',
      title: 'Academy Introduction — Our Team Talk',
      caption: 'Learn about our practical communication approach and training environment in Davangere.',
      youtube_url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
      youtube_video_id: 'ScMzIvxBSi4',
      cover_image_url: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=80',
      alt_text: "Uptrend's English Academy Introduction Video Cover",
      is_published: true,
      display_order: 1
    },
    {
      id: '55555555-5555-5555-5555-555555555502',
      media_type: 'video',
      title: 'Hear from Our Recent Batch',
      caption: 'Feedback and spoken English journey shared by recent batch learners.',
      youtube_url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
      youtube_video_id: 'ScMzIvxBSi4',
      cover_image_url: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=1200&q=80',
      alt_text: 'Recent Batch Testimonial Video Cover',
      is_published: true,
      display_order: 2
    },
    {
      id: '55555555-5555-5555-5555-555555555503',
      media_type: 'photo',
      title: 'Classroom Interaction & Speaking Practice',
      caption: 'Interactive spoken English session at our Davangere learning center.',
      youtube_url: null,
      youtube_video_id: null,
      cover_image_url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80',
      alt_text: "Classroom conversation practice at Uptrend's English Academy",
      is_published: true,
      display_order: 3
    }
  ],
  faqs: [
    {
      id: '33333333-3333-3333-3333-333333333301',
      question: "Where is Uptrend's English Academy located in Davangere?",
      answer: "We are located at #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India.",
      is_published: true,
      display_order: 1
    },
    {
      id: '33333333-3333-3333-3333-333333333302',
      question: 'What are the regular business hours?',
      answer: 'Our regular business hours are Monday to Saturday, 8:00 AM to 8:30 PM. We are closed on Sundays.',
      is_published: true,
      display_order: 2
    },
    {
      id: '33333333-3333-3333-3333-333333333303',
      question: 'How do I apply for an English program?',
      answer: 'You can submit an online application via our Apply Now page with your contact details, qualification, selected program, and a passport-size photograph (under 300 KB). Our staff will review your application and notify you.',
      is_published: true,
      display_order: 3
    },
    {
      id: '33333333-3333-3333-3333-333333333304',
      question: 'Who can join the Spoken English course?',
      answer: 'Our courses are designed for students, job seekers preparing for interviews, working professionals, and homemakers who wish to build spoken English confidence and fluency.',
      is_published: true,
      display_order: 4
    },
    {
      id: '33333333-3333-3333-3333-333333333305',
      question: 'Can I request a callback before applying?',
      answer: 'Yes! Simply click "Request a Call" on any program card or the navigation bar to select your preferred contact time (Morning, Afternoon, or Evening) and our team will get in touch.',
      is_published: true,
      display_order: 5
    }
  ],
  branding: {
    id: '66666666-6666-6666-6666-666666666601',
    academy_name: "Uptrend's English Academy",
    tagline: 'Professional Spoken English & Communication Skills',
    logo_url: null,
    main_logo_alt: "Uptrend's English Academy Davangere Logo",
    logo_alt: "Uptrend's English Academy Davangere Logo",
    favicon_url: '/favicon.ico',
    footer_logo_url: null,
    hero_photo_url: null,
    primary_orange: '#ea580c',
    primary_green: '#16a34a',
  }
};

// -------------------------------------------------------------
// HELPER: R2 UPLOAD
// -------------------------------------------------------------
async function uploadToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  if (!r2Client) {
    if (!fs.existsSync(LOCAL_UPLOADS_DIRECTORY)) {
      fs.mkdirSync(LOCAL_UPLOADS_DIRECTORY, { recursive: true });
    }
    const safeFilename = path.basename(key);
    fs.writeFileSync(path.join(LOCAL_UPLOADS_DIRECTORY, safeFilename), buffer);
    return `/uploads/${safeFilename}`;
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
}

function getManagedR2Key(value: unknown, prefix: 'applications' | 'media'): string | null {
  return managedR2ObjectKeyFromMetadata(value, R2_PUBLIC_URL, prefix);
}

function hasValidR2PublicUrl(): boolean {
  try {
    return new URL(R2_PUBLIC_URL).protocol === 'https:';
  } catch {
    return false;
  }
}

async function uploadMediaToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  if (!r2Client) throw new Error('Cloudflare R2 storage is not configured. Media photos cannot be uploaded.');
  let publicUrl: URL;
  try {
    publicUrl = new URL(R2_PUBLIC_URL);
  } catch {
    throw new Error('A valid HTTPS Cloudflare R2 public URL is required to serve uploaded media.');
  }
  if (publicUrl.protocol !== 'https:') {
    throw new Error('A valid HTTPS Cloudflare R2 public URL is required to serve uploaded media.');
  }
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${publicUrl.toString().replace(/\/+$/, '')}/${key}`;
}

async function deleteManagedR2Object(key: string): Promise<void> {
  if (!r2Client) throw new Error('Cloudflare R2 storage is not configured.');
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

function toSafeYouTubeUrl(url?: string | null): string | null {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

function extractYouTubeVideoId(url?: string | null): string | null {
  if (!url) return null;
  const value = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be'
      ? segments[0]
      : ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)
        ? parsed.pathname === '/watch'
          ? parsed.searchParams.get('v')
          : ['embed', 'shorts', 'live', 'v'].includes(segments[0] || '') ? segments[1] : null
        : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// HELPER: RESEND TRANSACTIONAL EMAIL SENDER
// -------------------------------------------------------------
async function sendEmailViaResend({
  to,
  subject,
  html,
  text,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content?: Buffer; path?: string }>;
}) {
  if (!resend) {
    console.warn(`[Resend Disabled] Email would have been sent to ${to}: ${subject}`);
    return {
      success: false,
      error: 'RESEND_API_KEY is not configured in environment variables. Email logged locally.',
      provider_message_id: null,
    };
  }

  try {
    const payload: any = {
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    };

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error('[Resend Error]', error);
      return { success: false, error: error.message, provider_message_id: null };
    }

    return { success: true, provider_message_id: data?.id || null };
  } catch (err: any) {
    console.error('[Resend Exception]', err);
    return { success: false, error: err.message || 'Unknown Resend error', provider_message_id: null };
  }
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

type IntegrationHealth = {
  configured: boolean;
  connected: boolean;
  error_category?: string;
};

function supabaseErrorCategory(error: unknown): string {
  const details = error as { code?: unknown; message?: unknown };
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';
  if (code === '42501') return 'permission_denied';
  if (code === 'PGRST301' || /invalid (api )?key|invalid jwt/i.test(message)) return 'authentication_failed';
  if (code === '42P01' || code === 'PGRST205') return 'schema_mismatch';
  return 'database_query_failed';
}

async function checkSupabaseHealth(): Promise<IntegrationHealth> {
  const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  if (!supabase) return { configured, connected: false, error_category: configured ? 'invalid_configuration' : 'missing_configuration' };
  try {
    const { error } = await supabase.from('site_branding').select('id').limit(1).abortSignal(AbortSignal.timeout(5000));
    if (error) return { configured: true, connected: false, error_category: supabaseErrorCategory(error) };
    return { configured: true, connected: true };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'service_unreachable',
    };
  }
}

async function checkResendHealth(): Promise<IntegrationHealth> {
  if (!RESEND_API_KEY) return { configured: false, connected: false, error_category: 'missing_configuration' };
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return { configured: true, connected: true };
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
}

async function checkR2Health(): Promise<IntegrationHealth> {
  const configured = Boolean(r2Client && hasValidR2PublicUrl());
  if (!r2Client || !configured) return { configured: false, connected: false, error_category: 'missing_or_invalid_configuration' };
  try {
    await r2Client.send(new HeadBucketCommand({ Bucket: R2_BUCKET }), { abortSignal: AbortSignal.timeout(5000) });
    return { configured: true, connected: true };
  } catch (error: any) {
    return {
      configured: true,
      connected: false,
      error_category: error?.$metadata?.httpStatusCode === 403
        ? 'permission_denied'
        : error?.$metadata?.httpStatusCode === 404 ? 'bucket_not_found' : 'storage_unreachable',
    };
  }
}

// System Diagnostics & Configuration Status
app.get('/api/system-status', async (_req, res) => {
  const [supabaseHealth, resendHealth, r2Health] = await Promise.all([
    checkSupabaseHealth(),
    checkResendHealth(),
    checkR2Health(),
  ]);

  res.json({
    supabase: supabaseHealth,
    resend: resendHealth,
    r2_storage: r2Health,
    server_time: new Date().toISOString(),
  });
});

// GET Public Data Endpoints
app.get('/api/programs', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('programs')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.programs.filter((program) => program.is_published));
  } catch {
    res.json(memoryStore.programs.filter((program) => program.is_published));
  }
});

app.get('/api/announcements', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.announcements.filter(a => a.is_active));
  } catch {
    res.json(memoryStore.announcements.filter(a => a.is_active));
  }
});

app.get('/api/admin/programs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('programs').select('*').order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.programs);
});

app.get('/api/admin/announcements', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('announcements').select('*').order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.announcements);
});

app.get('/api/admin/reviews', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.reviews);
});

app.post('/api/admin/reviews', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  const { author_name, rating, review_text, source, is_published } = req.body || {};
  if (typeof author_name !== 'string' || !author_name.trim() || author_name.length > 300
      || typeof review_text !== 'string' || !review_text.trim() || review_text.length > 10000
      || !Number.isInteger(rating) || rating < 1 || rating > 5
      || (source !== undefined && source !== null && (typeof source !== 'string' || source.length > 300))
      || (is_published !== undefined && typeof is_published !== 'boolean')) {
    return res.status(400).json({ error: 'Provide an author name, review text, a 1–5 integer rating, and valid optional source/publication values.' });
  }
  const record = {
    author_name: author_name.trim(),
    rating,
    review_text: review_text.trim(),
    source: typeof source === 'string' && source.trim() ? source.trim() : null,
    is_published: is_published !== false,
  };
  if (supabase) {
    const { data, error } = await supabase.from('reviews').insert(record).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }
  const created = { id: crypto.randomUUID(), ...record, created_at: new Date().toISOString() };
  memoryStore.reviews.unshift(created);
  return res.status(201).json(created);
});

app.put('/api/admin/reviews/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  const { author_name, rating, review_text, source, is_published } = req.body || {};
  const updates: Record<string, unknown> = {};
  if (author_name !== undefined) {
    if (typeof author_name !== 'string' || !author_name.trim() || author_name.length > 300) return res.status(400).json({ error: 'Author name is required and must be 300 characters or fewer.' });
    updates.author_name = author_name.trim();
  }
  if (review_text !== undefined) {
    if (typeof review_text !== 'string' || !review_text.trim() || review_text.length > 10000) return res.status(400).json({ error: 'Review text is required and must be 10,000 characters or fewer.' });
    updates.review_text = review_text.trim();
  }
  if (rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' });
    updates.rating = rating;
  }
  if (source !== undefined) {
    if (source !== null && (typeof source !== 'string' || source.length > 300)) return res.status(400).json({ error: 'Source must be 300 characters or fewer.' });
    updates.source = typeof source === 'string' && source.trim() ? source.trim() : null;
  }
  if (is_published !== undefined) {
    if (typeof is_published !== 'boolean') return res.status(400).json({ error: 'is_published must be a boolean.' });
    updates.is_published = is_published;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'At least one review field is required.' });
  if (supabase) {
    const { data, error } = await supabase.from('reviews').update(updates).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Review not found.' });
    return res.json(data);
  }
  const review = memoryStore.reviews.find((item) => item.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  Object.assign(review, updates);
  return res.json(review);
});

app.delete('/api/admin/reviews/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('reviews').delete().eq('id', req.params.id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Review not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.reviews.length;
  memoryStore.reviews = memoryStore.reviews.filter((item) => item.id !== req.params.id);
  if (memoryStore.reviews.length === previousCount) return res.status(404).json({ error: 'Review not found.' });
  return res.json({ success: true });
});

app.get('/api/media', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('media_items')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.media.filter(m => m.is_published));
  } catch {
    res.json(memoryStore.media.filter(m => m.is_published));
  }
});

app.get('/api/admin/media', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('media_items')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) return res.status(500).json({ error: error.message || 'Unable to load media items.' });
      return res.json(data || []);
    }
    return res.status(503).json({ error: 'Media storage is unavailable because Supabase is not configured.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Unable to load media items.' });
  }
});

app.post('/api/admin/media', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    const {
      title,
      caption,
      alt_text,
      media_type,
      is_published,
      display_order,
      youtube_url,
      cover_image_url,
      media_file_base64,
      media_file_mime,
      media_url,
      cover_file_base64,
      audience_tag,
    } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Media title is required.' });
    }

    if (media_type !== 'photo' && media_type !== 'video') {
      return res.status(400).json({ error: 'Media type must be photo or video.' });
    }
    if (!isAudienceTag(audience_tag)) {
      return res.status(400).json({ error: 'A valid audience_tag is required.' });
    }
    const displayOrder = display_order === undefined ? 0 : Number(display_order);
    if (!Number.isInteger(displayOrder)) {
      return res.status(400).json({ error: 'Display order must be a whole number.' });
    }
    if (supabase) {
      const { data: matchingOrder, error: orderLookupError } = await supabase
        .from('media_items')
        .select('id,title')
        .eq('display_order', displayOrder)
        .limit(1);
      if (orderLookupError) {
        return res.status(500).json({ error: `Unable to verify media display order: ${orderLookupError.message}` });
      }
      if (matchingOrder?.length) {
        return res.status(409).json({
          error: `This display order number is already taken by "${matchingOrder[0].title}". Please choose another number.`,
        });
      }
    } else {
      const matchingMedia = memoryStore.media.find((media) => media.display_order === displayOrder);
      if (matchingMedia) {
        return res.status(409).json({
          error: `This display order number is already taken by "${matchingMedia.title}". Please choose another number.`,
        });
      }
    }
    const normalizedType = media_type;
    const cleanYoutube = toSafeYouTubeUrl(youtube_url || null);
    const youtubeVideoId = extractYouTubeVideoId(cleanYoutube || youtube_url || null);

    if (normalizedType === 'video' && !youtubeVideoId) {
      return res.status(400).json({ error: 'A valid YouTube URL is required for video entries.' });
    }

    if (normalizedType === 'photo' && !media_file_base64) {
      return res.status(400).json({ error: 'Upload a photo before saving this media item.' });
    }

    let storedUrl = normalizedType === 'video' ? null : (media_url || null);
    let objectKey = null;
    if (normalizedType === 'photo' && media_file_base64) {
      const matches = media_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
      if (!matches) {
        return res.status(400).json({ error: 'Invalid image upload. Please use a valid PNG, JPG, or WebP image.' });
      }
      const mime = matches[1].toLowerCase();
      const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMime.includes(mime)) {
        return res.status(400).json({ error: 'Unsupported photo format. Please upload JPEG, PNG, or WebP.' });
      }
      const base64Data = matches[3];
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
        return res.status(400).json({ error: 'Invalid image upload. The photo data is not valid base64.' });
      }
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) return res.status(400).json({ error: 'The uploaded photo is empty.' });
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Photo upload exceeds 5 MB limit.' });
      }
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const key = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const url = await uploadMediaToR2(buffer, key, mime);
      storedUrl = url;
      objectKey = key;
    }

    let coverObjectKey: string | null = null;
    let storedCoverUrl = cover_image_url || null;

    if (cover_file_base64 !== undefined && cover_file_base64 !== null && cover_file_base64 !== '') {
      const matches = typeof cover_file_base64 === 'string'
        ? cover_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i)
        : null;

      if (!matches) {
        if (objectKey) await deleteManagedR2Object(objectKey);
        return res.status(400).json({ error: 'Invalid cover image. Please use PNG, JPG, or WebP.' });
      }

      const mime = matches[1].toLowerCase();
      const base64Data = matches[3];

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
        if (objectKey) await deleteManagedR2Object(objectKey);
        return res.status(400).json({ error: 'Invalid cover image format or base64 data.' });
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
        if (objectKey) await deleteManagedR2Object(objectKey);
        return res.status(400).json({ error: 'Cover image must be larger than 0 bytes and no more than 5 MB.' });
      }

      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      coverObjectKey = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      try {
        storedCoverUrl = await uploadMediaToR2(buffer, coverObjectKey, mime);
      } catch (error) {
        if (objectKey) {
          try { await deleteManagedR2Object(objectKey); } catch (cleanupError) {
            console.error('[Admin Media Main Upload Cleanup Error]', cleanupError);
          }
        }
        throw error;
      }
    }

    const newItem = {
      id: crypto.randomUUID(),
      media_type: normalizedType,
      title: title.trim(),
      caption: caption || null,
      r2_object_key: objectKey,
      media_url: storedUrl,
      youtube_url: cleanYoutube || null,
      youtube_video_id: youtubeVideoId,
      cover_image_url: storedCoverUrl,
      alt_text: alt_text || title.trim(),
      audience_tag,
      is_published: is_published !== false,
      display_order: displayOrder,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (supabase) {
      const { data, error } = await supabase.from('media_items').insert([newItem]).select().single();
      if (error) {
        let cleanupErrorMessage = '';
        for (const key of [objectKey, coverObjectKey]) {
          if (!key) continue;
          try {
            await deleteManagedR2Object(key);
          } catch (cleanupError: any) {
            console.error('[Admin Media Upload Cleanup Error]', cleanupError);
            cleanupErrorMessage += ` Uploaded object ${key} could not be removed from R2.`;
          }
        }
        return res.status(500).json({ error: `${error.message || 'Failed to create media item.'}${cleanupErrorMessage}` });
      }
      return res.json(data);
    }

    for (const key of [objectKey, coverObjectKey]) {
      if (key) await deleteManagedR2Object(key);
    }
    return res.status(503).json({ error: 'Media storage is unavailable because Supabase is not configured.' });
  } catch (err: any) {
    console.error('[Admin Media Create Error]', err);
    res.status(err.message?.includes('not configured') || err.message?.includes('public URL') ? 503 : 502)
      .json({ error: err.message || 'Unable to save media item.' });
  }
});

app.put('/api/admin/media/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    const { id } = req.params;
    const {
      title,
      caption,
      alt_text,
      media_type,
      is_published,
      display_order,
      youtube_url,
      cover_image_url,
      media_file_base64,
      media_file_mime,
      media_url,
      cover_file_base64,
      audience_tag,
    } = req.body || {};

    let item: any = null;
    if (supabase) {
      const { data, error } = await supabase.from('media_items').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
      item = data;
    } else {
      item = memoryStore.media.find((m) => m.id === id);
    }

    if (!item) {
      return res.status(404).json({ error: 'Media item not found.' });
    }
    if (audience_tag !== undefined && !isAudienceTag(audience_tag)) {
      return res.status(400).json({ error: 'audience_tag must be one of the supported audience tags.' });
    }

    const nextDisplayOrder = display_order === undefined ? item.display_order : Number(display_order);
    if (!Number.isInteger(nextDisplayOrder)) {
      return res.status(400).json({ error: 'Display order must be a whole number.' });
    }
    if (supabase) {
      const { data: matchingOrder, error: orderLookupError } = await supabase
        .from('media_items')
        .select('id,title')
        .eq('display_order', nextDisplayOrder)
        .neq('id', id)
        .limit(1);
      if (orderLookupError) {
        return res.status(500).json({ error: `Unable to verify media display order: ${orderLookupError.message}` });
      }
      if (matchingOrder?.length) {
        return res.status(409).json({
          error: `This display order number is already taken by "${matchingOrder[0].title}". Please choose another number.`,
        });
      }
    } else {
      const matchingMedia = memoryStore.media.find((media) => media.id !== id && media.display_order === nextDisplayOrder);
      if (matchingMedia) {
        return res.status(409).json({
          error: `This display order number is already taken by "${matchingMedia.title}". Please choose another number.`,
        });
      }
    }

    const nextType = media_type ?? item.media_type;
    if (nextType !== 'photo' && nextType !== 'video') {
      return res.status(400).json({ error: 'Media type must be photo or video.' });
    }
    const nextYoutube = toSafeYouTubeUrl((youtube_url ?? item.youtube_url) || null);
    const nextYoutubeId = extractYouTubeVideoId(nextYoutube || (youtube_url ?? item.youtube_url) || null);
    if (nextType === 'video' && !nextYoutubeId) {
      return res.status(400).json({ error: 'A valid YouTube URL is required for video entries.' });
    }
    let nextMediaUrl = nextType === 'video' ? null : (media_url ?? item.media_url ?? null);
    let nextObjectKey = nextType === 'video' ? null : (item.r2_object_key ?? null);
    let uploadedObjectKey: string | null = null;

    if (nextType === 'photo' && media_file_base64) {
      const matches = media_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
      if (!matches) {
        return res.status(400).json({ error: 'Invalid image upload. Please use a valid PNG, JPG, or WebP image.' });
      }
      const mime = matches[1].toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        return res.status(400).json({ error: 'Unsupported photo format. Please upload JPEG, PNG, or WebP.' });
      }
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(matches[3])) {
        return res.status(400).json({ error: 'Invalid image upload. The photo data is not valid base64.' });
      }
      const buffer = Buffer.from(matches[3], 'base64');
      if (buffer.length === 0) return res.status(400).json({ error: 'The uploaded photo is empty.' });
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Photo upload exceeds 5 MB limit.' });
      }
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const key = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const url = await uploadMediaToR2(buffer, key, mime);
      nextMediaUrl = url;
      nextObjectKey = key;
      uploadedObjectKey = key;
    }

    let uploadedCoverObjectKey: string | null = null;
    let nextCoverImageUrl = cover_image_url !== undefined ? cover_image_url : item.cover_image_url;

    if (cover_file_base64 !== undefined && cover_file_base64 !== null && cover_file_base64 !== '') {
      const matches = typeof cover_file_base64 === 'string'
        ? cover_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i)
        : null;

      if (!matches) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
        return res.status(400).json({ error: 'Invalid cover image. Please use PNG, JPG, or WebP.' });
      }

      const mime = matches[1].toLowerCase();
      const base64Data = matches[3];

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
        return res.status(400).json({ error: 'Invalid cover image format or base64 data.' });
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
        return res.status(400).json({ error: 'Cover image must be larger than 0 bytes and no more than 5 MB.' });
      }

      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      uploadedCoverObjectKey = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      try {
        nextCoverImageUrl = await uploadMediaToR2(buffer, uploadedCoverObjectKey, mime);
      } catch (error) {
        if (uploadedObjectKey) {
          try { await deleteManagedR2Object(uploadedObjectKey); } catch (cleanupError) {
            console.error('[Admin Media Main Upload Cleanup Error]', cleanupError);
          }
        }
        throw error;
      }
    }

    const previousObjectKey = item.r2_object_key
      ? getManagedR2Key(item.r2_object_key, 'media')
      : null;
    const isReplacingStoredObject = Boolean(item.r2_object_key && (nextType === 'video' || uploadedObjectKey));
    const shouldRemovePreviousObject = Boolean(previousObjectKey && isReplacingStoredObject && previousObjectKey !== nextObjectKey);
    if (isReplacingStoredObject && !previousObjectKey) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
      return res.status(400).json({ error: 'Stored media object key is invalid; refusing to update the media record.' });
    }
    if (shouldRemovePreviousObject && !r2Client) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
      return res.status(503).json({ error: 'Cloudflare R2 storage is not configured, so the existing media photo cannot be removed.' });
    }

    const updates = {
      title: title !== undefined ? String(title).trim() : item.title,
      caption: caption !== undefined ? caption : item.caption,
      alt_text: alt_text !== undefined ? alt_text : item.alt_text,
      media_type: nextType,
      media_url: nextMediaUrl,
      r2_object_key: nextObjectKey,
      youtube_url: nextYoutube || null,
      youtube_video_id: nextYoutubeId,
      cover_image_url: nextCoverImageUrl,
      audience_tag: audience_tag !== undefined ? audience_tag : item.audience_tag ?? null,
      is_published: is_published !== undefined ? Boolean(is_published) : item.is_published,
      display_order: nextDisplayOrder,
      updated_at: new Date().toISOString(),
    };

    if (supabase) {
      const { data, error } = await supabase.from('media_items').update(updates).eq('id', id).select().single();
      if (error) {
        let cleanupErrorMessage = '';
        for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
          if (!key) continue;
          try {
            await deleteManagedR2Object(key);
          } catch (cleanupError: any) {
            console.error('[Admin Media Upload Cleanup Error]', cleanupError);
            cleanupErrorMessage += ` Uploaded object ${key} could not be removed from R2.`;
          }
        }
        return res.status(500).json({ error: `${error.message || 'Failed to update media item.'}${cleanupErrorMessage}` });
      }
      if (previousObjectKey && shouldRemovePreviousObject) {
        try {
          await deleteManagedR2Object(previousObjectKey);
        } catch (cleanupError: any) {
          console.error('[Admin Media R2 Cleanup Error]', cleanupError);
          return res.status(502).json({ error: `Media details were saved, but the previous R2 photo could not be removed: ${cleanupError.message || 'storage error'}` });
        }
      }
      return res.json(data);
    }

    const idx = memoryStore.media.findIndex((m) => m.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Media item not found.' });
    for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
      if (key) await deleteManagedR2Object(key);
    }
    return res.status(503).json({ error: 'Media storage is unavailable because Supabase is not configured.' });
  } catch (err: any) {
    console.error('[Admin Media Update Error]', err);
    res.status(err.message?.includes('not configured') || err.message?.includes('public URL') ? 503 : 502)
      .json({ error: err.message || 'Unable to update media item.' });
  }
});

app.delete('/api/admin/media/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    const { id } = req.params;

    if (supabase) {
      const { data: existing, error: lookupError } = await supabase
        .from('media_items')
        .select('*')
        .eq('id', id)
        .single();

      if (lookupError) {
        if (lookupError.code === 'PGRST116') {
          return res.status(404).json({ error: 'Media item not found.' });
        }
        return res.status(500).json({
          error: lookupError.message || 'Unable to load media item.',
        });
      }

      const objectKey = existing.r2_object_key
        ? getManagedR2Key(existing.r2_object_key, 'media')
        : null;

      // Never delete a database record when its stored object key is malformed.
      if (existing.r2_object_key && !objectKey) {
        return res.status(400).json({
          error: 'Stored media object key is invalid; refusing to delete the media record.',
        });
      }

      if (objectKey && !r2Client) {
        return res.status(503).json({
          error: 'Cloudflare R2 storage is not configured, so the media photo cannot be deleted.',
        });
      }

      // Delete the R2 object first. If storage deletion fails, preserve the DB row
      // so the admin can retry without losing the reference to the photo.
      if (objectKey) {
        try {
          await deleteManagedR2Object(objectKey);
        } catch (deleteError: any) {
          console.error('[Admin Media R2 Delete Error]', deleteError);
          return res.status(502).json({
            error: `Unable to delete the media photo from R2; the media record was retained. ${deleteError?.message || 'Storage error.'}`,
          });
        }
      }

      const { data: deleted, error: deleteError } = await supabase
        .from('media_items')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (deleteError) {
        console.error('[Admin Media Database Delete Error]', deleteError);
        const partialMessage = objectKey
          ? ' The R2 photo was deleted, but the database record could not be deleted.'
          : '';
        return res.status(500).json({
          error: `${deleteError.message || 'Unable to delete media item.'}${partialMessage}`,
        });
      }

      if (!deleted) {
        return res.status(404).json({
          error: objectKey
            ? 'The R2 photo was deleted, but the media database record was not found.'
            : 'Media item not found.',
        });
      }

      return res.json({ success: true, message: 'Media item deleted.' });
    }

    const idx = memoryStore.media.findIndex((m) => m.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Media item not found.' });
    memoryStore.media.splice(idx, 1);
    return res.json({ success: true, message: 'Media item deleted.' });
  } catch (err: any) {
    console.error('[Admin Media Delete Error]', err);
    return res.status(500).json({
      error: err?.message || 'Unable to delete media item.',
    });
  }
});

app.get('/api/faqs', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('faqs')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.faqs.filter(f => f.is_published));
  } catch {
    res.json(memoryStore.faqs.filter(f => f.is_published));
  }
});

app.get('/api/admin/faqs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('faqs').select('*').order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.faqs);
});

app.get('/api/branding', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('site_branding').select('*').limit(1).maybeSingle();
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.branding);
  } catch {
    res.json(memoryStore.branding);
  }
});

app.post('/api/apply', dispatchWorkerApi);

app.post('/api/approve-application', dispatchWorkerApi);


// POST Callback Request (Public)
app.post('/api/callback-request', async (req, res) => {
  try {
    const { full_name, mobile, email, program_name, preferred_contact_time, message, consent } = req.body;

    if (!full_name || !mobile || !preferred_contact_time) {
      return res.status(400).json({ error: 'Full name, mobile number, and preferred contact time are required.' });
    }
    if (typeof mobile !== 'string' || (email !== null && email !== undefined && typeof email !== 'string')) {
      return res.status(400).json({ error: 'Enter a valid email address and Indian mobile number.' });
    }
    const normalizedMobile = normalizeIndianMobileNumber(mobile);
    const normalizedEmail = typeof email === 'string' && email.trim()
      ? normalizeContactEmail(email)
      : null;
    if (!normalizedMobile || (normalizedEmail && !isValidContactEmail(normalizedEmail))) {
      return res.status(400).json({ error: 'Enter a valid email address and Indian mobile number.' });
    }
    const newRecord = {
      id: crypto.randomUUID(),
      full_name,
      mobile: normalizedMobile,
      email: normalizedEmail,
      program_name: program_name || 'General Inquiry',
      preferred_contact_time,
      message: message || null,
      consent: consent !== false,
      status: 'New',
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      const { error } = await supabase.from('callback_requests').insert([newRecord]);
      if (error) {
        console.error('[Supabase Insert Callback Error]', { code: error.code || 'unknown' });
        return res.status(500).json({ error: 'Failed to record callback request. Please retry.' });
      }
    } else {
      memoryStore.callbacks.unshift(newRecord);
    }

    let emailBranding: EmailBranding = { publicAssetBaseUrl: R2_PUBLIC_URL };
    let emailSettings = DEFAULT_EMAIL_SETTINGS;
    let emailSettingsPersisted = false;
    let siteBranding: Record<string, unknown> | null = null;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('site_branding')
          .select('academy_name,logo_url,primary_green,primary_orange')
          .limit(1)
          .maybeSingle();
        if (error) {
          console.error('[Email Branding Error]', { code: error.code || 'database_query_failed' });
        } else if (data) {
          siteBranding = data;
        }
      } catch (brandingError) {
        console.error('[Email Branding Error]', brandingError);
      }
      try {
        const { data, error } = await supabase
          .from('email_template_settings')
          .select('settings')
          .eq('setting_key', 'default')
          .maybeSingle();
        if (error) {
          console.error('[Email Settings Error]', { code: error.code || 'database_query_failed' });
        } else if (data) {
          const normalized = normalizeEmailSettings(data.settings);
          if (normalized) {
            emailSettings = normalized;
            emailSettingsPersisted = true;
          } else {
            console.error('[Email Settings Error]', { code: 'invalid_saved_settings' });
          }
        }
        if (!emailSettingsPersisted && typeof siteBranding?.academy_name === 'string') {
          emailSettings = {
            ...emailSettings,
            branding: { ...emailSettings.branding, academyName: siteBranding.academy_name },
          };
        }
      } catch {
        console.error('[Email Settings Error]', { code: 'settings_read_failed' });
      }
    }
    const configuredBranding = emailSettings.branding;
    emailBranding = {
      academyName: configuredBranding.academyName || siteBranding?.academy_name,
      logoUrl: configuredBranding.logoUrl || siteBranding?.logo_url,
      primaryGreen: siteBranding?.primary_green,
      primaryOrange: configuredBranding.accentColor,
      headerText: configuredBranding.headerText,
      academyTagline: configuredBranding.academyTagline,
      headerBackgroundColor: configuredBranding.headerBackgroundColor,
      headerTextColor: configuredBranding.headerTextColor,
      footerBackgroundColor: configuredBranding.footerBackgroundColor,
      footerTextColor: configuredBranding.footerTextColor,
      accentColor: configuredBranding.accentColor,
      footerTagline: configuredBranding.footerTagline,
      address: configuredBranding.address,
      phone: configuredBranding.phone,
      email: configuredBranding.email,
      website: configuredBranding.website,
      copyright: configuredBranding.copyright,
      disclaimer: configuredBranding.disclaimer,
      headerPhotoUrl: configuredBranding.headerPhotoKey,
      publicAssetBaseUrl: R2_PUBLIC_URL,
    };
    const callbackContent = applyEmailTemplate(emailSettings, 'callback_staff', {
      title: 'New Callback Request',
      paragraphs: ['A new callback request has been received.'],
      status: 'Pending',
      actionMessage: `Please contact the applicant during their preferred ${String(preferred_contact_time).toLowerCase()} time window.`,
      details: [
        { label: 'Applicant', value: String(full_name) },
        { label: 'Mobile', value: String(normalizedMobile) },
        { label: 'Email', value: normalizedEmail || 'Not provided' },
        { label: 'Program', value: String(program_name || 'General Inquiry') },
        { label: 'Preferred Time', value: String(preferred_contact_time) },
        { label: 'Message', value: String(message || 'None') },
      ],
    });
    const renderedEmail = renderBrandedEmail(callbackContent, emailBranding);
    await sendEmailViaResend({
      to: APPLICATION_NOTIFICATION_EMAIL,
      subject: `New Callback Request — ${full_name} (${preferred_contact_time})`,
      html: renderedEmail.html,
      text: renderedEmail.text,
    });

    res.status(202).json(contactAcknowledgement);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Route application joining-information writes explicitly through the shared Worker handler.
app.put('/api/admin/applications/:id/joining-information', dispatchWorkerApi);

// Route application documents and demo requests through the shared Worker handlers.
app.all(
  [
    '/api/admin/applications',
    '/api/admin/applications/:id',
    '/api/admin/application-erasure-jobs/:id',
    '/api/demo-class-requests',
    '/api/admin/demo-class-requests',
    '/api/admin/demo-class-requests/:id',
    '/api/admin/demo-class-requests/:id/photo',
    '/api/admin/official-document',
    '/api/admin/official-document/preview',
    '/api/admin/official-document/issued',
    '/api/admin/official-document/assets',
    '/api/admin/email-settings',
    '/api/admin/email-settings/reset',
    '/api/admin/email-settings/header-photo',
    '/api/admin/about-us/assets',
    '/api/about-us/assets',
  ],
  dispatchWorkerApi,
);
// -------------------------------------------------------------
// PROTECTED ADMIN DATA ENDPOINTS (Staff and above)
// -------------------------------------------------------------
app.get('/api/admin/notifications', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase.from('application_notifications').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message || 'Unable to load notifications.' });
    return res.json(data || []);
  }
  res.json(memoryStore.notifications);
});

app.get('/api/admin/callbacks', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase.from('callback_requests').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message || 'Unable to load callback requests.' });
    return res.json(data || []);
  }
  res.json(memoryStore.callbacks);
});

app.put('/api/admin/callbacks/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Callback request ID must be a valid UUID.' });
  const { status } = req.body || {};
  if (!['New', 'Contacted', 'Resolved'].includes(status)) {
    return res.status(400).json({ error: 'Callback status must be New, Contacted, or Resolved.' });
  }
  if (supabase) {
    const { data, error } = await supabase.from('callback_requests')
      .update({ status }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Callback request not found.' });
    return res.json(data);
  }
  const record = memoryStore.callbacks.find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Callback request not found.' });
  record.status = status;
  return res.json(record);
});

app.delete('/api/admin/callbacks/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Callback request ID must be a valid UUID.' });

  if (supabase) {
    const { data, error } = await supabase.from('callback_requests')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete callback request.' });
    if (!data) return res.status(404).json({ error: 'Callback request not found.' });
    return res.json({ success: true, message: 'Callback request deleted successfully.' });
  }

  const index = memoryStore.callbacks.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Callback request not found.' });
  memoryStore.callbacks.splice(index, 1);
  return res.json({ success: true, message: 'Callback request deleted successfully.' });
});

// Admin Profiles Management (Super Admin only)
app.get('/api/admin/profiles', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase
      .from('admin_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (!error && data) return res.json(data);
  }
  res.json(memoryStore.admin_profiles);
});

app.put('/api/admin/profiles/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { id } = req.params;
  const { role, is_active } = req.body;

  if (id === admin.id && is_active === false) {
    return res.status(400).json({ error: 'Cannot deactivate your own super admin account.' });
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('admin_profiles')
      .update({ role, is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const idx = memoryStore.admin_profiles.findIndex(p => p.id === id);
  if (idx !== -1) {
    memoryStore.admin_profiles[idx] = { ...memoryStore.admin_profiles[idx], role, is_active };
    return res.json(memoryStore.admin_profiles[idx]);
  }
  res.status(404).json({ error: 'Admin profile not found' });
});

// Site Branding Management (Super Admin only)
app.put('/api/admin/branding', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const isHeroPhotoAdmin = admin.role !== 'super_admin';
  if (isHeroPhotoAdmin) {
    const allowedFields = new Set(['hero_photo_file_base64', 'hero_photo_url']);
    if (
      Object.keys(req.body).some((field) => !allowedFields.has(field)) ||
      (req.body.hero_photo_file_base64 === undefined && req.body.hero_photo_url !== null) ||
      (req.body.hero_photo_url !== undefined && req.body.hero_photo_url !== null)
    ) {
      return res.status(403).json({ error: 'Admins may only upload a new hero photo or remove the current hero photo.' });
    }
  }

  const {
    academy_name,
    tagline,
    logo_url,
    main_logo_alt,
    logo_alt,
    favicon_url,
    footer_logo_url,
    primary_orange,
    primary_green,
    primary_color,
    secondary_color,
    logo_file_base64,
    favicon_file_base64,
    footer_logo_file_base64,
    hero_photo_file_base64,
  } = req.body;

  const resolvedPrimaryColor = primary_color ?? primary_orange;
  const resolvedSecondaryColor = secondary_color ?? primary_green;
  if (!isHeroPhotoAdmin && (
    (resolvedPrimaryColor !== undefined && !/^#[0-9a-f]{6}$/i.test(resolvedPrimaryColor)) ||
    (resolvedSecondaryColor !== undefined && !/^#[0-9a-f]{6}$/i.test(resolvedSecondaryColor))
  )) {
    return res.status(400).json({ error: 'Theme colors must be six-digit hexadecimal values.' });
  }

  const updates: Record<string, unknown> = isHeroPhotoAdmin
    ? { updated_at: new Date().toISOString(), ...(req.body.hero_photo_url === null ? { hero_photo_url: null } : {}) }
    : {
      academy_name: academy_name || "Uptrend's English Academy",
      tagline: tagline || 'Professional Spoken English & Communication Skills',
      logo_url: logo_url || null,
      logo_alt: main_logo_alt || logo_alt || "Uptrend's English Academy Davangere Logo",
      favicon_url: favicon_url || '/favicon.ico',
      footer_logo_url: footer_logo_url || null,
      ...(req.body.hero_photo_url !== undefined ? { hero_photo_url: req.body.hero_photo_url } : {}),
      primary_orange: resolvedPrimaryColor || '#ea580c',
      primary_green: resolvedSecondaryColor || '#16a34a',
      updated_at: new Date().toISOString(),
    };
  const uploadedAssets: Array<{
    key: string;
    column: 'logo_url' | 'favicon_url' | 'footer_logo_url' | 'hero_photo_url';
    localFilename?: string;
  }> = [];
  const cleanupUploadedAssets = async () => {
    for (const asset of uploadedAssets) {
      try {
        if (asset.localFilename) {
          await fs.promises.unlink(path.join(LOCAL_UPLOADS_DIRECTORY, asset.localFilename));
        } else {
          await deleteManagedR2Object(asset.key);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[branding_upload_cleanup_failed]', {
            key: asset.key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  };

  const fileUploads = [
    { field: 'logo_file_base64', column: 'logo_url' },
    { field: 'favicon_file_base64', column: 'favicon_url' },
    { field: 'footer_logo_file_base64', column: 'footer_logo_url' },
    { field: 'hero_photo_file_base64', column: 'hero_photo_url' },
  ] as const;
  for (const { field, column } of fileUploads) {
    const dataUrl = req.body[field];
    if (dataUrl === undefined) continue;
    const match = typeof dataUrl === 'string'
      ? /^data:(image\/(?:jpeg|png|webp|x-icon|vnd\.microsoft\.icon));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl)
      : null;
    if (!match) {
      await cleanupUploadedAssets();
      return res.status(400).json({ error: 'Choose a valid supported branding image.' });
    }

    const buffer = Buffer.from(match[2], 'base64');
    const detectedMime = match[1].toLowerCase();
    const mime = detectedMime === 'image/vnd.microsoft.icon' ? 'image/x-icon' : detectedMime;
    if (mime === 'image/x-icon' && field !== 'favicon_file_base64') {
      await cleanupUploadedAssets();
      return res.status(400).json({ error: 'ICO files are supported only for the favicon.' });
    }
    const signatureIsValid = mime === 'image/jpeg'
      ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
      : mime === 'image/png'
        ? buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
        : mime === 'image/x-icon'
          ? buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0
          : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    const maxImageBytes = field === 'favicon_file_base64' ? 1024 * 1024 : 3 * 1024 * 1024;
    if (buffer.length === 0 || buffer.length > maxImageBytes || !signatureIsValid) {
      await cleanupUploadedAssets();
      return res.status(400).json({
        error: buffer.length > maxImageBytes
          ? `Branding images must be ${maxImageBytes / (1024 * 1024)} MB or smaller.`
          : 'Image contents do not match the selected file type.',
      });
    }

    const extension = mime === 'image/png'
      ? 'png'
      : mime === 'image/webp'
        ? 'webp'
        : mime === 'image/x-icon'
          ? 'ico'
          : 'jpg';
    const key = `branding/${crypto.randomUUID()}.${extension}`;
    try {
      updates[column] = r2Client
        ? await uploadMediaToR2(buffer, key, mime)
        : await uploadToR2(buffer, key, mime);
      uploadedAssets.push({
        key,
        column,
        ...(!r2Client ? { localFilename: path.basename(key) } : {}),
      });
    } catch (error) {
      await cleanupUploadedAssets();
      return res.status(502).json({
        error: error instanceof Error ? error.message : 'Unable to store branding image.',
      });
    }
  }

  if (supabase) {
    const { data: existing, error: existingError } = await supabase
      .from('site_branding')
      .select('id,logo_url,favicon_url,footer_logo_url,hero_photo_url')
      .limit(1)
      .maybeSingle();
    if (existingError) {
      await cleanupUploadedAssets();
      return res.status(500).json({ error: existingError.message });
    }

    const result = existing?.id
      ? await supabase.from('site_branding').update(updates).eq('id', existing.id).select().single()
      : await supabase.from('site_branding').insert([{ id: crypto.randomUUID(), ...updates }]).select().single();
    if (result.error) {
      await cleanupUploadedAssets();
      return res.status(500).json({ error: result.error.message });
    }

    for (const column of ['logo_url', 'favicon_url', 'footer_logo_url', 'hero_photo_url'] as const) {
      if (updates[column] === undefined) continue;
      const previousKey = managedR2ObjectKeyFromMetadata(
        existing?.[column],
        R2_PUBLIC_URL,
        'branding',
      );
      const replacementKey = uploadedAssets.find((asset) => asset.column === column)?.key;
      if (!previousKey || previousKey === replacementKey || !r2Client) continue;
      try {
        await deleteManagedR2Object(previousKey);
      } catch (error) {
        console.error('[branding_old_asset_cleanup_failed]', {
          key: previousKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return res.json(result.data);
  }

  memoryStore.branding = { ...memoryStore.branding, ...updates };
  return res.json(memoryStore.branding);
});

// Admin CRUD Endpoints for Programs (Admin & Super Admin)
app.post('/api/admin/programs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { title, slug, short_description, description, duration, level, target_audience, age_range, is_published, image_url } = req.body;
  const newProg = {
    id: crypto.randomUUID(),
    title,
    slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    short_description,
    description,
    duration,
    level,
    target_audience,
    age_range: age_range || null,
    image_url: image_url || 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80',
    is_published: !!is_published,
    display_order: memoryStore.programs.length + 1,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    const { data, error } = await supabase.from('programs').insert([newProg]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  memoryStore.programs.push(newProg);
  res.json(newProg);
});

app.put('/api/admin/programs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  const updates = req.body;
  if (supabase) {
    const { data, error } = await supabase.from('programs').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const idx = memoryStore.programs.findIndex(p => p.id === id);
  if (idx !== -1) {
    memoryStore.programs[idx] = { ...memoryStore.programs[idx], ...updates };
    return res.json(memoryStore.programs[idx]);
  }
  res.status(404).json({ error: 'Program not found' });
});

app.delete('/api/admin/programs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  if (supabase) {
    const { data, error } = await supabase.from('programs').delete().eq('id', id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete program.' });
    if (!data) return res.status(404).json({ error: 'Program not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.programs.length;
  memoryStore.programs = memoryStore.programs.filter(p => p.id !== id);
  if (memoryStore.programs.length === previousCount) return res.status(404).json({ error: 'Program not found.' });
  return res.json({ success: true });
});

// Announcement Admin CRUD (Admin & Super Admin)
app.post('/api/admin/announcements', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { content, is_active, button_action } = req.body;
  if (button_action !== undefined && button_action !== null &&
      button_action !== 'application' && button_action !== 'demo') {
    return res.status(400).json({ error: 'button_action must be application, demo, or null.' });
  }
  const item = {
    id: crypto.randomUUID(),
    content,
    is_active: is_active !== false,
    display_order: memoryStore.announcements.length + 1,
    button_action: button_action ?? null,
    created_at: new Date().toISOString(),
  };
  if (supabase) {
    const { data, error } = await supabase.from('announcements').insert([item]).select().single();
    if (error) return res.status(500).json({ error: error.message || 'Unable to create announcement.' });
    return res.json(data);
  }
  memoryStore.announcements.push(item);
  res.json(item);
});

app.put('/api/admin/announcements/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  const updates = req.body;
  if (updates.button_action !== undefined && updates.button_action !== null &&
      updates.button_action !== 'application' && updates.button_action !== 'demo') {
    return res.status(400).json({ error: 'button_action must be application, demo, or null.' });
  }
  if (supabase) {
    const { data, error } = await supabase.from('announcements').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const idx = memoryStore.announcements.findIndex(a => a.id === id);
  if (idx !== -1) {
    memoryStore.announcements[idx] = { ...memoryStore.announcements[idx], ...updates };
    return res.json(memoryStore.announcements[idx]);
  }
  res.status(404).json({ error: 'Announcement not found' });
});

app.delete('/api/admin/announcements/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  if (supabase) {
    const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete announcement.' });
    if (!data) return res.status(404).json({ error: 'Announcement not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.announcements.length;
  memoryStore.announcements = memoryStore.announcements.filter(a => a.id !== id);
  if (memoryStore.announcements.length === previousCount) return res.status(404).json({ error: 'Announcement not found.' });
  return res.json({ success: true });
});

// FAQs Admin CRUD (Super Admin only)
app.post('/api/admin/faqs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { question, answer, is_published } = req.body;
  const item = {
    id: crypto.randomUUID(),
    question,
    answer,
    is_published: is_published !== false,
    display_order: memoryStore.faqs.length + 1,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    const { data, error } = await supabase.from('faqs').insert([item]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  memoryStore.faqs.push(item);
  res.json(item);
});

app.put('/api/admin/faqs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { id } = req.params;
  const updates = req.body;
  if (supabase) {
    const { data, error } = await supabase.from('faqs').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const idx = memoryStore.faqs.findIndex(f => f.id === id);
  if (idx !== -1) {
    memoryStore.faqs[idx] = { ...memoryStore.faqs[idx], ...updates };
    return res.json(memoryStore.faqs[idx]);
  }
  res.status(404).json({ error: 'FAQ not found' });
});

app.delete('/api/admin/faqs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { id } = req.params;
  if (supabase) {
    const { data, error } = await supabase.from('faqs').delete().eq('id', id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete FAQ.' });
    if (!data) return res.status(404).json({ error: 'FAQ not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.faqs.length;
  memoryStore.faqs = memoryStore.faqs.filter(f => f.id !== id);
  if (memoryStore.faqs.length === previousCount) return res.status(404).json({ error: 'FAQ not found.' });
  return res.json({ success: true });
});

app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE IN DEV OR STATIC FILES IN PROD
// -------------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
