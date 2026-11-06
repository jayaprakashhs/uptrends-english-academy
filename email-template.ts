export interface EmailBranding {
  academyName?: unknown;
  logoUrl?: unknown;
  headerPhotoUrl?: unknown;
  primaryGreen?: unknown;
  primaryOrange?: unknown;
  publicAssetBaseUrl?: string;
  headerText?: unknown;
  academyTagline?: unknown;
  headerBackgroundColor?: unknown;
  headerTextColor?: unknown;
  footerBackgroundColor?: unknown;
  footerTextColor?: unknown;
  accentColor?: unknown;
  footerTagline?: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  website?: unknown;
  copyright?: unknown;
  disclaimer?: unknown;
}

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailContent {
  title: string;
  greeting?: string;
  paragraphs?: string[];
  details?: EmailDetail[];
  status?: string;
  actionMessage?: string;
  referenceNumber?: string;
  heroImageUrl?: unknown;
  heroImageAlt?: string;
  button?: {
    label: string;
    url: string;
    color?: string;
  };
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const DEFAULT_ACADEMY_NAME = "Uptrend's English Academy";
const DEFAULT_LOGO_URL =
  "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_02.png";
const NAVY = '#123B78';
const ORANGE = '#FF6B00';
const LIGHT_BLUE = '#EAF3FF';
const LIGHT_BLUE_GREY = '#F4F7FC';
const DARK_NAVY = '#142B50';
const BODY_TEXT = '#334155';
const WEBSITE_URL = 'https://uptrendsenglishacademy.in';
const ACADEMY_EMAIL = 'uptrendsinstitute@gmail.com';
const ACADEMY_PHONE = '+91 9008000211';
const HEADER_WAVES_URL = `${WEBSITE_URL}/assets/email-header-waves.png`;
export const DEFAULT_EMAIL_HERO_IMAGE_URL = `${WEBSITE_URL}/assets/email-hero-students.jpg`;
const PRIVATE_R2_HOST = /\.r2\.cloudflarestorage\.com$/i;
const DEFAULT_HEADER_TEXT = 'Davangere, Karnataka';
const DEFAULT_FOOTER_TAGLINE = 'Learn English for a Brighter Tomorrow...';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] || character));

const plainString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

const isSafePublicHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.r2.cloudflarestorage.com') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1'
  ) return false;
  if (host.includes(':')) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return octets[0] !== 0 &&
    octets[0] !== 10 &&
    octets[0] !== 127 &&
    !(octets[0] === 169 && octets[1] === 254) &&
    !(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) &&
    !(octets[0] === 192 && octets[1] === 168) &&
    !(octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
};

const safeEmailLink = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !isSafePublicHost(url.hostname)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
};

const safePhoneLink = (value: string): string => {
  const phone = value.replace(/[^\d+]/g, '');
  return phone && /^\+?\d{5,20}$/.test(phone) ? phone : '';
};

const emailTheme = (branding: EmailBranding) => ({
  headerBackground: safeColor(branding.headerBackgroundColor, LIGHT_BLUE),
  headerText: safeColor(branding.headerTextColor, NAVY),
  footerBackground: safeColor(branding.footerBackgroundColor, NAVY),
  footerText: safeColor(branding.footerTextColor, '#FFFFFF'),
  accent: safeColor(branding.accentColor, ORANGE),
  headerCopy: plainString(branding.headerText) || DEFAULT_HEADER_TEXT,
  academyTagline: plainString(branding.academyTagline) || 'Speak English with Confidence',
  footerTagline: plainString(branding.footerTagline) || DEFAULT_FOOTER_TAGLINE,
  address: plainString(branding.address) || 'Davangere, Karnataka',
  phone: plainString(branding.phone) || ACADEMY_PHONE,
  email: plainString(branding.email) || ACADEMY_EMAIL,
  website: safeEmailLink(branding.website, WEBSITE_URL),
  copyright: plainString(branding.copyright) || `Copyright © ${new Date().getFullYear()} {{academyName}}. All rights reserved.`,
  disclaimer: plainString(branding.disclaimer) || 'This is an automated email. Please do not reply directly to this message.',
});

const safePublicImageUrl = (value: unknown, publicAssetBaseUrl?: string): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rawUrl = value.trim();
  const baseValue = publicAssetBaseUrl?.trim().replace(/\/+$/, '');
  let base: URL | null = null;
  if (baseValue) {
    try {
      base = new URL(baseValue);
    } catch {
      base = null;
    }
    if (
      base &&
      (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
        PRIVATE_R2_HOST.test(base.hostname))
    ) {
      base = null;
    }
  }

  const managedKey = /^(?:branding|email-assets)\/[A-Za-z0-9._/-]+$/.test(rawUrl) ? rawUrl : null;
  if (managedKey && base && !managedKey.split('/').some((part) => part === '.' || part === '..')) {
    return `${base.toString().replace(/\/+$/, '')}/${managedKey}`;
  }

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !isSafePublicHost(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const resolvePublicEmailImageUrl = (
  value: unknown,
  publicAssetBaseUrl?: string,
): string | null => safePublicImageUrl(value, publicAssetBaseUrl);

const statusColors = (status: string, accent: string) => {
  const normalized = status.toLowerCase();
  if (/\b(approved|complete|completed|resolved|sent|successful|paid)\b/.test(normalized)) {
    return { foreground: NAVY, background: LIGHT_BLUE };
  }
  if (/\b(pending|awaiting|new|in progress|review)\b/.test(normalized)) {
    return { foreground: accent, background: '#FFF3E8' };
  }
  if (/\b(rejected|failed|cancelled|declined)\b/.test(normalized)) {
    return { foreground: '#9F1239', background: '#FFF1F2' };
  }
  return { foreground: '#475569', background: '#F1F5F9' };
};

const detailIcon = (label: string): string => {
  const normalized = label.toLowerCase();
  if (/name|student|applicant|recipient/.test(normalized)) return '&#128100;';
  if (/phone|mobile|contact/.test(normalized)) return '&#9742;';
  if (/email/.test(normalized)) return '&#9993;';
  if (/program|course|qualification/.test(normalized)) return '&#127891;';
  if (/date|time|schedule/.test(normalized)) return '&#128197;';
  if (/city|place|address|venue/.test(normalized)) return '&#128205;';
  if (/message|note|details/.test(normalized)) return '&#128221;';
  return '&#8226;';
};

const renderHeader = (academyName: string, logoUrl: string | null, branding: EmailBranding): string => {
  const brandName = escapeHtml(academyName);
  const theme = emailTheme(branding);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${theme.headerBackground}" style="width:100%;background-color:${theme.headerBackground};"><tr><td align="center" style="padding:20px 18px 0;font-family:Arial,Helvetica,sans-serif;">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="184" alt="${brandName} official logo" style="display:block;width:184px;max-width:100%;height:auto;margin:0 auto 10px;border:0;text-decoration:none;">` : ''}<p style="margin:0;color:${theme.headerText};font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:31px;font-weight:bold;">${brandName}</p><p style="margin:5px 0 3px;color:${theme.headerText};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;letter-spacing:.25px;">${escapeHtml(theme.headerCopy)}</p><p style="margin:0 0 12px;color:${theme.accent};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;font-weight:bold;">${escapeHtml(theme.academyTagline)}</p></td></tr><tr><td style="padding:0;font-size:0;line-height:0;"><img src="${HEADER_WAVES_URL}" width="620" alt="" style="display:block;width:100%;max-width:620px;height:auto;border:0;"></td></tr></table>`;
};

const renderHero = (
  content: EmailContent,
  heroImageUrl: string | null,
  branding: EmailBranding,
): string => {
  const theme = emailTheme(branding);
  const title = plainString(content.title);
  const greeting = plainString(content.greeting);
  const intro = (content.paragraphs || []).map(plainString).find(Boolean) || '';
  return `<table class="email-hero" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${LIGHT_BLUE_GREY}" style="width:100%;background-color:${LIGHT_BLUE_GREY};"><tr><td class="hero-copy" width="${heroImageUrl ? '56%' : '100%'}" valign="middle" style="width:${heroImageUrl ? '56%' : '100%'};padding:25px 20px 25px 30px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 8px;color:${theme.accent};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:.8px;">ACADEMY NOTIFICATION</p><h1 style="margin:0 0 12px;color:${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:31px;font-weight:bold;">${escapeHtml(title)}</h1>${greeting ? `<p style="margin:0 0 8px;color:${DARK_NAVY};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;font-weight:bold;">Dear ${escapeHtml(greeting)},</p>` : ''}${intro ? `<p style="margin:0;color:${BODY_TEXT};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">${escapeHtml(intro)}</p>` : ''}</td>${heroImageUrl ? `<td class="hero-image-cell" width="44%" align="right" valign="middle" bgcolor="${LIGHT_BLUE_GREY}" style="width:44%;padding:12px 18px 12px 0;background-color:${LIGHT_BLUE_GREY};"><img class="hero-image" src="${escapeHtml(heroImageUrl)}" width="250" alt="${escapeHtml(plainString(content.heroImageAlt) || 'Students learning at Uptrend’s English Academy')}" style="display:block;width:100%;max-width:250px;height:auto;border:0;outline:none;text-decoration:none;"></td>` : ''}</tr></table>`;
};

const renderParagraphs = (content: EmailContent): string =>
  (content.paragraphs || [])
    .map(plainString)
    .filter(Boolean)
    .slice(1)
    .map((paragraph) => `<p style="margin:0 0 15px;color:${BODY_TEXT};font-size:15px;line-height:25px;">${escapeHtml(paragraph)}</p>`)
    .join('');

const renderReference = (referenceNumber?: string, branding: EmailBranding = {}): string => {
  const reference = plainString(referenceNumber);
  const accent = emailTheme(branding).accent;
  return reference
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;border:1px solid #FFD7B5;background-color:#FFF8F1;"><tr><td style="padding:8px 12px;color:${DARK_NAVY};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;"><strong style="color:${accent};letter-spacing:.4px;">REFERENCE&nbsp;&nbsp;</strong>${escapeHtml(reference)}</td></tr></table>`
    : '';
};

const renderDetails = (details?: EmailDetail[], branding: EmailBranding = {}): string => {
  const accent = emailTheme(branding).accent;
  const rows = details?.filter(({ label, value }) => plainString(label) && plainString(value)) || [];
  if (!rows.length) return '';
  return `<p style="margin:3px 0 9px;color:${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:21px;font-weight:bold;">Request Details</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border:1px solid #DCE7F4;border-radius:10px;border-collapse:separate;background-color:#ffffff;">${rows.map(({ label, value }, index) => {
    const border = index < rows.length - 1 ? 'border-bottom:1px solid #E8EDF2;' : '';
    return `<tr><td class="detail-label" valign="top" width="36%" style="width:36%;padding:11px 12px;${border}background-color:${LIGHT_BLUE};color:#475569;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;letter-spacing:.2px;"><span aria-hidden="true" style="padding-right:5px;color:${accent};">${detailIcon(label)}</span><strong>${escapeHtml(plainString(label))}</strong></td><td class="detail-value" valign="top" style="padding:11px 14px;${border}color:${DARK_NAVY};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;word-break:break-word;">${escapeHtml(plainString(value))}</td></tr>`;
  }).join('')}</table>`;
};

const renderStatus = (status?: string, actionMessage?: string, branding: EmailBranding = {}): string => {
  const statusValue = plainString(status);
  const action = plainString(actionMessage);
  const theme = emailTheme(branding);
  if (!statusValue && !action) return '';
  if (!statusValue) {
    return `<p style="margin:0 0 18px;color:${BODY_TEXT};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">${escapeHtml(action)}</p>`;
  }
  const colors = statusColors(statusValue, theme.accent);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${colors.background}" style="width:100%;margin:2px 0 20px;border:1px solid ${colors.foreground};border-radius:12px;background-color:${colors.background};"><tr><td class="status-label" valign="top" width="${action ? '42%' : '100%'}" style="width:${action ? '42%' : '100%'};padding:13px 15px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 6px;color:${DARK_NAVY};font-size:12px;line-height:17px;font-weight:bold;letter-spacing:.3px;">CURRENT STATUS</p><span style="display:inline-block;padding:6px 13px;border-radius:18px;background-color:${colors.foreground};color:#FFFFFF;font-size:14px;line-height:18px;font-weight:bold;">${escapeHtml(statusValue)}</span></td>${action ? `<td class="status-action" valign="middle" style="padding:13px 15px;border-left:1px solid ${colors.foreground};color:${DARK_NAVY};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;">${escapeHtml(action)}</td>` : ''}</tr></table>`;
};

const renderButton = (button: EmailContent['button']): string => {
  if (!button?.label?.trim() || !button.url?.trim()) return '';
  const url = safeEmailLink(button.url, '');
  if (!url) return '';
  const color = safeColor(button.color, ORANGE);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 20px;"><tr><td align="center" bgcolor="${color}" style="border-radius:8px;background-color:${color};"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border:1px solid ${color};border-radius:8px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:bold;text-decoration:none;">${escapeHtml(button.label.trim())}</a></td></tr></table>`;
};

const renderFooter = (academyName: string, branding: EmailBranding): string => {
  const brandName = escapeHtml(academyName);
  const theme = emailTheme(branding);
  const phoneLink = safePhoneLink(theme.phone);
  const copyright = theme.copyright
    .replace(/\{\{\s*year\s*\}\}/g, String(new Date().getFullYear()))
    .replace(/\{\{\s*academyName\s*\}\}/g, academyName);
  const escapedCopyright = escapeHtml(copyright).replace(/©/g, '&copy;');
  const phone = phoneLink
    ? `<a href="tel:${escapeHtml(phoneLink)}" style="color:${theme.footerText};text-decoration:underline;">${escapeHtml(theme.phone)}</a>`
    : escapeHtml(theme.phone);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${theme.footerBackground}" style="width:100%;border-top:4px solid ${theme.accent};background-color:${theme.footerBackground};"><tr><td align="center" style="padding:21px 18px 17px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 4px;color:${theme.footerText};font-size:16px;line-height:22px;font-weight:bold;">${brandName}</p><p style="margin:0 0 14px;color:${theme.footerText};font-size:12px;line-height:18px;font-weight:bold;">${escapeHtml(theme.academyTagline)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 12px;"><tr><td class="footer-contact-cell" align="center" style="padding:0 9px 5px;color:${theme.footerText};font-size:12px;line-height:19px;">${phone}</td><td class="footer-contact-cell" align="center" style="padding:0 9px 5px;color:${theme.footerText};font-size:12px;line-height:19px;"><a href="mailto:${escapeHtml(theme.email)}" style="color:${theme.footerText};text-decoration:underline;">${escapeHtml(theme.email)}</a></td></tr><tr><td colspan="2" align="center" style="padding:0 9px 5px;color:${theme.footerText};font-size:12px;line-height:19px;"><a href="${escapeHtml(theme.website)}" style="color:${theme.footerText};text-decoration:underline;">${escapeHtml(theme.website)}</a></td></tr></table><p style="margin:0 0 11px;color:${theme.footerText};font-size:12px;line-height:18px;">${escapeHtml(theme.address)}</p><p style="margin:0 0 7px;color:${theme.footerText};font-size:10px;line-height:16px;">${escapeHtml(theme.footerTagline)}</p><p style="margin:0 0 5px;color:${theme.footerText};font-size:10px;line-height:16px;">${escapedCopyright}</p><p style="margin:0;color:${theme.footerText};font-size:10px;line-height:16px;">${escapeHtml(theme.disclaimer)}</p></td></tr></table>`;
};

const plainText = (content: EmailContent, academyName: string, branding: EmailBranding): string => {
  const theme = emailTheme(branding);
  const paragraphs = (content.paragraphs || []).map(plainString).filter(Boolean);
  const details = content.details?.filter(({ label, value }) => plainString(label) && plainString(value)) || [];
  const copyright = theme.copyright
    .replace(/\{\{\s*year\s*\}\}/g, String(new Date().getFullYear()))
    .replace(/\{\{\s*academyName\s*\}\}/g, academyName);
  return [
    plainString(content.title),
    '',
    ...(plainString(content.greeting) ? [`Dear ${plainString(content.greeting)},`, ''] : []),
    ...paragraphs,
    ...(plainString(content.referenceNumber) ? [`Reference: ${plainString(content.referenceNumber)}`] : []),
    ...(plainString(content.status) ? [`Current status: ${plainString(content.status)}`] : []),
    ...(plainString(content.actionMessage) ? [plainString(content.actionMessage)] : []),
    ...details.map(({ label, value }) => `${plainString(label)}: ${plainString(value)}`),
    ...(content.button?.label && content.button.url ? [`${content.button.label}: ${content.button.url}`] : []),
    '',
    'Visit the academy: ' + theme.website,
    '',
    'Email: ' + theme.email,
    'Phone: ' + theme.phone,
    theme.headerCopy,
    theme.footerTagline,
    '',
    'Regards,',
    academyName,
    theme.address,
    copyright,
    theme.disclaimer,
  ].join('\n');
};

export const renderBrandedEmail = (
  content: EmailContent,
  branding: EmailBranding = {},
): RenderedEmail => {
  const academyName = plainString(branding.academyName) || DEFAULT_ACADEMY_NAME;
  const logoUrl = safePublicImageUrl(branding.logoUrl, branding.publicAssetBaseUrl)
    || safePublicImageUrl(DEFAULT_LOGO_URL);
  const theme = emailTheme(branding);
  const heroImageUrl = content.heroImageUrl === null
    ? null
    : safePublicImageUrl(content.heroImageUrl)
      || safePublicImageUrl(branding.headerPhotoUrl, branding.publicAssetBaseUrl)
      || DEFAULT_EMAIL_HERO_IMAGE_URL;
  const brandName = escapeHtml(academyName);
  const header = renderHeader(academyName, logoUrl, branding);
  const hero = renderHero(content, heroImageUrl, branding);
  const bodyParagraphs = renderParagraphs(content);
  const reference = renderReference(content.referenceNumber, branding);
  const details = renderDetails(content.details, branding);
  const status = renderStatus(content.status, content.actionMessage, branding);
  const button = renderButton(content.button);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>@media only screen and (max-width:620px){.email-outer{padding:10px 5px!important}.email-card{border-radius:10px!important}.email-content{padding:22px 18px 20px!important}.hero-copy,.hero-image-cell{display:block!important;width:100%!important;box-sizing:border-box!important}.hero-copy{padding:22px 20px 12px!important}.hero-image-cell{padding:4px 18px 18px!important;text-align:center!important}.hero-image{width:100%!important;max-width:340px!important;margin:0 auto!important}.detail-label,.detail-value{display:block!important;width:auto!important;padding:8px 12px!important}.detail-label{border-bottom:0!important}.detail-value{padding-top:2px!important}.status-label,.status-action{display:block!important;width:100%!important;box-sizing:border-box!important}.status-action{border-top:1px solid ${theme.accent}!important;border-left:0!important}.footer-contact-cell{display:block!important;width:100%!important;text-align:center!important;box-sizing:border-box!important}}</style></head><body style="margin:0;padding:0;background-color:${LIGHT_BLUE_GREY};"><div style="display:none;font-size:1px;color:${LIGHT_BLUE_GREY};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml((content.paragraphs || []).map(plainString).find(Boolean) || plainString(content.title))}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${LIGHT_BLUE_GREY}" style="width:100%;background-color:${LIGHT_BLUE_GREY};"><tr><td class="email-outer" align="center" style="padding:22px 12px;"><table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;border:1px solid #DCE7F4;background-color:#FFFFFF;"><tr><td style="padding:0;">${header}</td></tr><tr><td style="padding:0;">${hero}</td></tr><tr><td class="email-content" bgcolor="#FFFFFF" style="padding:24px 32px 25px;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">${bodyParagraphs}${reference}${details}${status}${button}<p style="margin:22px 0 0;padding-top:15px;border-top:1px solid #E8EDF2;color:${BODY_TEXT};font-size:14px;line-height:22px;">Warm regards,<br><strong style="color:${DARK_NAVY};">${brandName}</strong></p></td></tr><tr><td style="padding:0;">${renderFooter(academyName, branding)}</td></tr></table></td></tr></table></body></html>`;
  return { html, text: plainText(content, academyName, branding) };
};
