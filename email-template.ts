export interface EmailBranding {
  academyName?: unknown;
  logoUrl?: unknown;
  primaryGreen?: unknown;
  primaryOrange?: unknown;
  publicAssetBaseUrl?: string;
}

export interface EmailContent {
  title: string;
  greeting?: string;
  paragraphs?: string[];
  details?: Array<{ label: string; value: string }>;
  status?: string;
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
const PRIVATE_R2_HOST = /\.r2\.cloudflarestorage\.com$/i;

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] || character));

const safeLogoUrl = (value: unknown, publicAssetBaseUrl?: string): string | null => {
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

  const managedKey = /^branding\/[A-Za-z0-9._/-]+$/.test(rawUrl) ? rawUrl : null;
  if (managedKey && base && !managedKey.split('/').some((part) => part === '.' || part === '..')) {
    return `${base.toString().replace(/\/+$/, '')}/${managedKey}`;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      PRIVATE_R2_HOST.test(hostname) ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const statusColors = (status: string) => {
  const normalized = status.toLowerCase();
  if (/\b(approved|complete|completed|resolved|sent|successful)\b/.test(normalized)) {
    return { foreground: NAVY, background: LIGHT_BLUE };
  }
  if (/\b(pending|awaiting|new|in progress|review)\b/.test(normalized)) {
    return { foreground: ORANGE, background: '#FFF3E8' };
  }
  return { foreground: '#475569', background: '#f1f5f9' };
};

const plainText = (content: EmailContent, academyName: string): string => [
  content.title,
  '',
  ...(content.greeting ? [`Dear ${content.greeting},`, ''] : []),
  ...(content.paragraphs || []),
  ...(content.status ? [`Status: ${content.status}`] : []),
  ...(content.details || []).map(({ label, value }) => `${label}: ${value}`),
  '',
  'Visit the academy: ' + WEBSITE_URL,
  '',
  'Email: ' + ACADEMY_EMAIL,
  'Phone: ' + ACADEMY_PHONE,
  'Learn English for a Brighter Tomorrow...',
  '',
  'Regards,',
  academyName,
  'Davangere, Karnataka',
  `Copyright © ${new Date().getFullYear()} ${academyName}. All rights reserved.`,
  'This is an automated email. Please do not reply directly to this message.',
].join('\n');

export const renderBrandedEmail = (
  content: EmailContent,
  branding: EmailBranding = {},
): RenderedEmail => {
  const academyName = typeof branding.academyName === 'string' && branding.academyName.trim()
    ? branding.academyName.trim()
    : DEFAULT_ACADEMY_NAME;
  const logoUrl = safeLogoUrl(branding.logoUrl, branding.publicAssetBaseUrl)
    || safeLogoUrl(DEFAULT_LOGO_URL);
  const brandName = escapeHtml(academyName);
  const year = new Date().getFullYear();
  const header = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${LIGHT_BLUE}" style="width:100%;background-color:${LIGHT_BLUE};"><tr><td align="center" style="padding:22px 18px 0;font-family:Arial,Helvetica,sans-serif;">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="184" alt="${escapeHtml(academyName)} official logo" style="display:block;width:184px;max-width:100%;height:auto;margin:0 auto 10px;border:0;text-decoration:none;">` : ''}<p style="margin:0;color:${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:31px;font-weight:bold;">${brandName}</p><p style="margin:3px 0 10px;color:${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;letter-spacing:1.2px;">DAVANGERE - KARNATAKA</p></td></tr><tr><td style="padding:0;font-size:0;line-height:0;"><img src="${HEADER_WAVES_URL}" width="620" alt="" style="display:block;width:100%;max-width:620px;height:auto;border:0;"></td></tr></table>`;
  const greeting = content.greeting
    ? `<p style="margin:0 0 18px;color:${BODY_TEXT};font-size:15px;line-height:24px;">Dear <strong style="color:${DARK_NAVY};">${escapeHtml(content.greeting)}</strong>,</p>`
    : '';
  const paragraphs = (content.paragraphs || []).map((paragraph) =>
    `<p style="margin:0 0 15px;color:${BODY_TEXT};font-size:15px;line-height:25px;">${escapeHtml(paragraph)}</p>`,
  ).join('');
  const status = content.status
    ? (() => {
      const colors = statusColors(content.status);
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:3px 0 22px;border:1px solid ${colors.foreground};border-radius:20px;background-color:${colors.background};"><tr><td style="padding:7px 13px;color:${colors.foreground};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;"><strong style="letter-spacing:.2px;">STATUS&nbsp;&nbsp;</strong>${escapeHtml(content.status)}</td></tr></table>`;
    })()
    : '';
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:3px 0 22px;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;background-color:#ffffff;">${content.details.map(({ label, value }, index) => {
      const border = index < (content.details?.length || 0) - 1 ? 'border-bottom:1px solid #e8edf2;' : '';
      return `<tr><td class="detail-label" valign="top" width="36%" style="width:36%;padding:12px 14px;${border}background-color:${LIGHT_BLUE};color:#475569;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;letter-spacing:.2px;"><strong>${escapeHtml(label)}</strong></td><td class="detail-value" valign="top" style="padding:12px 14px;${border}color:${DARK_NAVY};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;word-break:break-word;">${escapeHtml(value)}</td></tr>`;
    }).join('')}</table>`
    : '';
  const footer = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${LIGHT_BLUE_GREY}" style="width:100%;border-top:3px solid ${NAVY};background-color:${LIGHT_BLUE_GREY};"><tr><td align="center" style="padding:20px 18px 18px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 5px;color:${NAVY};font-size:16px;line-height:22px;font-weight:bold;">${brandName}</p><p style="margin:0 0 12px;color:${ORANGE};font-size:13px;line-height:19px;font-weight:bold;">Learn English for a Brighter Tomorrow...</p><p style="margin:0 0 5px;color:${BODY_TEXT};font-size:12px;line-height:19px;">Davangere, Karnataka</p><p style="margin:0 0 5px;font-size:12px;line-height:19px;"><a href="${WEBSITE_URL}" style="color:${NAVY};text-decoration:underline;">${WEBSITE_URL}</a></p><p style="margin:0 0 5px;font-size:12px;line-height:19px;"><a href="mailto:${ACADEMY_EMAIL}" style="color:${NAVY};text-decoration:underline;">${ACADEMY_EMAIL}</a></p><p style="margin:0 0 13px;font-size:12px;line-height:19px;"><a href="tel:+919008000211" style="color:${NAVY};text-decoration:underline;">${ACADEMY_PHONE}</a></p><p style="margin:0 0 7px;color:#64748b;font-size:10px;line-height:16px;">Copyright &copy; ${year} ${brandName}. All rights reserved.</p><p style="margin:0;color:#64748b;font-size:10px;line-height:16px;">This is an automated email. Please do not reply directly to this message.</p></td></tr></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>@media only screen and (max-width:620px){.email-outer{padding:12px 6px!important}.email-card{border-radius:10px!important}.email-content{padding:26px 20px 22px!important}.detail-label,.detail-value{display:block!important;width:auto!important;padding:8px 12px!important}.detail-label{border-bottom:0!important}.detail-value{padding-top:2px!important}}</style></head><body style="margin:0;padding:0;background-color:${LIGHT_BLUE_GREY};"><div style="display:none;font-size:1px;color:${LIGHT_BLUE_GREY};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(content.paragraphs?.[0] || content.title)}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${LIGHT_BLUE_GREY}" style="width:100%;background-color:${LIGHT_BLUE_GREY};"><tr><td class="email-outer" align="center" style="padding:28px 12px;"><table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;border:1px solid #e2e8f0;background-color:#ffffff;"><tr><td style="padding:0;">${header}</td></tr><tr><td class="email-content" bgcolor="#FFFFFF" style="padding:28px 34px 26px;background-color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 9px;color:${ORANGE};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:bold;letter-spacing:.3px;">ACADEMY NOTIFICATION</p><h1 style="margin:0 0 23px;color:${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:33px;font-weight:bold;">${escapeHtml(content.title)}</h1>${greeting}${paragraphs}${status}${details}<p style="margin:24px 0 0;padding-top:17px;border-top:1px solid #e8edf2;color:${BODY_TEXT};font-size:14px;line-height:22px;">Warm regards,<br><strong style="color:${DARK_NAVY};">${brandName}</strong></p></td></tr><tr><td style="padding:0;">${footer}</td></tr></table></td></tr></table></body></html>`;
  return { html, text: plainText(content, academyName) };
};
