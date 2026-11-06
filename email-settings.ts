import type { EmailContent } from './email-template';

export type EmailTemplateKey =
  | 'demo_applicant'
  | 'demo_staff'
  | 'application_applicant'
  | 'application_staff'
  | 'admission_approved'
  | 'callback_staff';

export interface EmailTemplateSettings {
  heading: string;
  message: string;
  followUp: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonColor: string;
}

export interface EmailSettings {
  branding: {
    academyName: string;
    headerText: string;
    academyTagline: string;
    logoUrl: string;
    headerPhotoKey: string;
    headerBackgroundColor: string;
    headerTextColor: string;
    footerBackgroundColor: string;
    footerTextColor: string;
    accentColor: string;
    footerTagline: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    copyright: string;
    disclaimer: string;
  };
  templates: Record<EmailTemplateKey, EmailTemplateSettings>;
}

const website = 'https://uptrendsenglishacademy.in';

const makeTemplate = (
  heading: string,
  message: string,
  followUp: string,
): EmailTemplateSettings => ({
  heading,
  message,
  followUp,
  buttonLabel: 'Visit Our Website',
  buttonUrl: website,
  buttonColor: '#FF6B00',
});

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  branding: {
    academyName: "Uptrend's English Academy",
    headerText: 'Davangere, Karnataka',
    academyTagline: 'Speak English with Confidence',
    logoUrl: '',
    headerPhotoKey: '',
    headerBackgroundColor: '#EAF3FF',
    headerTextColor: '#123B78',
    footerBackgroundColor: '#123B78',
    footerTextColor: '#FFFFFF',
    accentColor: '#FF6B00',
    footerTagline: 'Learn English for a Brighter Tomorrow...',
    address: 'Davangere, Karnataka',
    phone: '+91 9008000211',
    email: 'uptrendsinstitute@gmail.com',
    website,
    copyright: 'Copyright © {{year}} {{academyName}}. All rights reserved.',
    disclaimer: 'This is an automated email. Please do not reply directly to this message.',
  },
  templates: {
    demo_applicant: makeTemplate(
      'Free Demo Class Request Received',
      'Thank you for requesting a free demo class at {{academyName}}.',
      'Our team will contact you soon to discuss the demo class schedule and next steps.',
    ),
    demo_staff: makeTemplate(
      'New Free Demo Class Request',
      'A new free demo class request has been received.',
      'Please follow up with the applicant to arrange the free demo class.',
    ),
    application_applicant: makeTemplate(
      'Application Received',
      'Thank you for applying to {{academyName}} for {{program}}.',
      'Our admissions team will review your application and contact you with the next steps.',
    ),
    application_staff: makeTemplate(
      'New Student Application Received',
      'A new student application has been submitted for review.',
      'Please review this submission in the Admin Portal.',
    ),
    admission_approved: makeTemplate(
      'Application Approved',
      'Your application to {{academyName}} for {{program}} has been approved.',
      'Please keep the attached admission document for your records and follow the joining instructions.',
    ),
    callback_staff: makeTemplate(
      'New Callback Request',
      'A new callback request has been received.',
      'Please contact the applicant during their preferred {{preferredTime}} time window.',
    ),
  },
};

const TEMPLATE_KEYS: EmailTemplateKey[] = [
  'demo_applicant',
  'demo_staff',
  'application_applicant',
  'application_staff',
  'admission_approved',
  'callback_staff',
];

const BRANDING_TEXT_LIMITS: Record<keyof EmailSettings['branding'], number> = {
  academyName: 120,
  headerText: 240,
  academyTagline: 240,
  logoUrl: 2048,
  headerPhotoKey: 120,
  headerBackgroundColor: 7,
  headerTextColor: 7,
  footerBackgroundColor: 7,
  footerTextColor: 7,
  accentColor: 7,
  footerTagline: 240,
  address: 300,
  phone: 50,
  email: 254,
  website: 2048,
  copyright: 300,
  disclaimer: 500,
};

const TEMPLATE_TEXT_LIMITS: Record<keyof EmailTemplateSettings, number> = {
  heading: 120,
  message: 1000,
  followUp: 1000,
  buttonLabel: 80,
  buttonUrl: 2048,
  buttonColor: 7,
};

const plainText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  return clean.length <= maxLength ? clean : null;
};

const safeHttpsUrl = (value: string, optional = false): boolean => {
  if (!value && optional) return true;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (hostname.includes(':')) return false;
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (
        octets.some((octet) => octet > 255) ||
        octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      ) return false;
    }
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      hostname !== 'localhost' &&
      !hostname.endsWith('.localhost') &&
      !hostname.endsWith('.local') &&
      !hostname.endsWith('.internal') &&
      hostname !== '127.0.0.1' &&
      hostname !== '0.0.0.0' &&
      hostname !== '::1' &&
      !hostname.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
};

const validEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const normalizeEmailSettings = (value: unknown): EmailSettings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const inputBranding = input.branding;
  const inputTemplates = input.templates;
  if (!inputBranding || typeof inputBranding !== 'object' || Array.isArray(inputBranding) ||
    !inputTemplates || typeof inputTemplates !== 'object' || Array.isArray(inputTemplates)) return null;

  const brandingInput = inputBranding as Record<string, unknown>;
  const templatesInput = inputTemplates as Record<string, unknown>;
  const branding = { ...DEFAULT_EMAIL_SETTINGS.branding };
  for (const key of Object.keys(BRANDING_TEXT_LIMITS) as Array<keyof typeof branding>) {
    if (brandingInput[key] === undefined) continue;
    const clean = plainText(brandingInput[key], BRANDING_TEXT_LIMITS[key]);
    if (clean === null) return null;
    branding[key] = clean;
  }
  for (const key of [
    'headerBackgroundColor',
    'headerTextColor',
    'footerBackgroundColor',
    'footerTextColor',
    'accentColor',
  ] as const) {
    if (!/^#[0-9a-f]{6}$/i.test(branding[key])) return null;
  }
  if (!branding.academyName || !branding.headerText || !branding.address ||
    !branding.phone || !branding.email || !branding.website ||
    !validEmail(branding.email) ||
    !safeHttpsUrl(branding.website) ||
    !safeHttpsUrl(branding.logoUrl, true)) return null;
  if (branding.headerPhotoKey &&
    !/^email-assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(branding.headerPhotoKey)) {
    return null;
  }

  const templates = { ...DEFAULT_EMAIL_SETTINGS.templates };
  for (const key of TEMPLATE_KEYS) {
    const source = templatesInput[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const entry = source as Record<string, unknown>;
    const normalized = { ...DEFAULT_EMAIL_SETTINGS.templates[key] };
    for (const field of Object.keys(TEMPLATE_TEXT_LIMITS) as Array<keyof EmailTemplateSettings>) {
      if (entry[field] === undefined) continue;
      const clean = plainText(entry[field], TEMPLATE_TEXT_LIMITS[field]);
      if (clean === null) return null;
      normalized[field] = clean;
    }
    if (!normalized.heading || !/^#[0-9a-f]{6}$/i.test(normalized.buttonColor) ||
      !safeHttpsUrl(normalized.buttonUrl, true) ||
      (normalized.buttonLabel && !normalized.buttonUrl)) return null;
    templates[key] = normalized;
  }

  return { branding, templates };
};

const interpolate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g, (_match, key: string) => values[key] || '');

export const applyEmailTemplate = (
  settings: EmailSettings,
  key: EmailTemplateKey,
  content: EmailContent,
): EmailContent => {
  const template = settings.templates[key];
  const details = content.details || [];
  const values: Record<string, string> = {
    academyName: settings.branding.academyName,
    recipientName: content.greeting || '',
    applicationReference: content.referenceNumber || '',
    year: String(new Date().getFullYear()),
  };
  for (const detail of details) {
    const normalizedLabel = detail.label.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_match, character: string) => character.toUpperCase());
    values[normalizedLabel] = detail.value;
    if (/program|course/i.test(detail.label)) values.program = detail.value;
    if (/preferred.*time/i.test(detail.label)) values.preferredTime = detail.value.toLowerCase();
  }
  const message = interpolate(template.message, values);
  const followUp = interpolate(template.followUp, values);
  return {
    ...content,
    title: interpolate(template.heading, values),
    paragraphs: [message, ...(content.paragraphs || []).slice(1)],
    actionMessage: followUp,
    button: template.buttonLabel && template.buttonUrl
      ? {
          label: template.buttonLabel,
          url: template.buttonUrl,
          color: template.buttonColor,
        }
      : undefined,
  };
};
