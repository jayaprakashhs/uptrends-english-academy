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
const DEFAULT_GREEN = '#14532d';
const DEFAULT_ORANGE = '#ea580c';
const WEBSITE_URL = 'https://uptrendsenglishacademy.in';
const PRIVATE_R2_HOST = /\.r2\.cloudflarestorage\.com$/i;

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] || character));

const safeColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

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

const statusColors = (status: string, green: string, orange: string) => {
  const normalized = status.toLowerCase();
  if (/\b(approved|complete|completed|resolved|sent|successful)\b/.test(normalized)) {
    return { foreground: green, background: '#ecfdf5' };
  }
  if (/\b(pending|awaiting|new|in progress|review)\b/.test(normalized)) {
    return { foreground: orange, background: '#fff7ed' };
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
  'Regards,',
  academyName,
  'Davangere, Karnataka, India',
].join('\n');

export const renderBrandedEmail = (
  content: EmailContent,
  branding: EmailBranding = {},
): RenderedEmail => {
  const academyName = typeof branding.academyName === 'string' && branding.academyName.trim()
    ? branding.academyName.trim()
    : DEFAULT_ACADEMY_NAME;
  const green = safeColor(branding.primaryGreen, DEFAULT_GREEN);
  const orange = safeColor(branding.primaryOrange, DEFAULT_ORANGE);
  const logoUrl = safeLogoUrl(branding.logoUrl, branding.publicAssetBaseUrl);
  const brandName = escapeHtml(academyName);
  const header = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="176" alt="${escapeHtml(academyName)} logo" style="display:block;width:176px;max-width:100%;height:auto;margin:0 auto 15px;border:0;text-decoration:none;">`
    : '';
  const greeting = content.greeting
    ? `<p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:24px;">Dear <strong style="color:#0f172a;">${escapeHtml(content.greeting)}</strong>,</p>`
    : '';
  const paragraphs = (content.paragraphs || []).map((paragraph) =>
    `<p style="margin:0 0 15px;color:#334155;font-size:15px;line-height:25px;">${escapeHtml(paragraph)}</p>`,
  ).join('');
  const status = content.status
    ? (() => {
      const colors = statusColors(content.status, green, orange);
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:3px 0 22px;border:1px solid ${colors.foreground};border-radius:20px;background-color:${colors.background};"><tr><td style="padding:7px 13px;color:${colors.foreground};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;"><strong style="letter-spacing:.2px;">STATUS&nbsp;&nbsp;</strong>${escapeHtml(content.status)}</td></tr></table>`;
    })()
    : '';
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:3px 0 22px;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;background-color:#ffffff;">${content.details.map(({ label, value }, index) => {
      const border = index < (content.details?.length || 0) - 1 ? 'border-bottom:1px solid #e8edf2;' : '';
      return `<tr><td class="detail-label" valign="top" width="36%" style="width:36%;padding:12px 14px;${border}background-color:#f8fafc;color:#64748b;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;letter-spacing:.2px;"><strong>${escapeHtml(label)}</strong></td><td class="detail-value" valign="top" style="padding:12px 14px;${border}color:#1e293b;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;word-break:break-word;">${escapeHtml(value)}</td></tr>`;
    }).join('')}</table>`
    : '';
  const footer = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e8edf2;background-color:#f8fafc;"><tr><td align="center" style="padding:24px 20px 10px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 15px;color:#64748b;font-size:12px;line-height:19px;">Have a question? We’re here to help you take the next step.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="${green}" style="border-radius:7px;background-color:${green};"><a href="${WEBSITE_URL}" style="display:inline-block;padding:11px 20px;border:1px solid ${green};border-radius:7px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:bold;text-decoration:none;">Visit the academy website</a></td></tr></table><p style="margin:18px 0 4px;color:${green};font-size:14px;line-height:21px;font-weight:bold;">${brandName}</p><p style="margin:0 0 4px;color:#64748b;font-size:12px;line-height:19px;">Davangere, Karnataka, India</p><p style="margin:0 0 12px;color:#64748b;font-size:12px;line-height:19px;"><a href="${WEBSITE_URL}" style="color:${green};text-decoration:underline;">${WEBSITE_URL}</a></p><p style="margin:0;color:#94a3b8;font-size:11px;line-height:17px;">This is an official notification from ${brandName}.</p></td></tr></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>@media only screen and (max-width:620px){.email-outer{padding:12px 6px!important}.email-card{border-radius:10px!important}.email-content{padding:26px 20px 22px!important}.email-header{padding:25px 18px!important}.detail-label,.detail-value{display:block!important;width:auto!important;padding:8px 12px!important}.detail-label{border-bottom:0!important}.detail-value{padding-top:2px!important}}</style></head><body style="margin:0;padding:0;background-color:#f1f5f2;"><div style="display:none;font-size:1px;color:#f1f5f2;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(content.paragraphs?.[0] || content.title)}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f2" style="width:100%;background-color:#f1f5f2;"><tr><td class="email-outer" align="center" style="padding:32px 14px;"><table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;border:1px solid #e2e8f0;border-radius:14px;background-color:#ffffff;box-shadow:0 8px 28px rgba(15,23,42,.08);overflow:hidden;"><tr><td class="email-header" align="center" bgcolor="${green}" style="padding:30px 24px 25px;background-color:${green};border-bottom:4px solid ${orange};">${header}<p style="margin:0;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;font-weight:bold;letter-spacing:.2px;">${brandName}</p><p style="margin:5px 0 0;color:#e2eee8;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:1.2px;text-transform:uppercase;">Davangere · Karnataka</p></td></tr><tr><td class="email-content" style="padding:34px 38px 28px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 9px;color:${orange};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">ACADEMY NOTIFICATION</p><h1 style="margin:0 0 23px;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:32px;font-weight:bold;letter-spacing:-.3px;">${escapeHtml(content.title)}</h1>${greeting}${paragraphs}${status}${details}<p style="margin:24px 0 0;padding-top:17px;border-top:1px solid #eef2f6;color:#475569;font-size:14px;line-height:22px;">Warm regards,<br><strong style="color:#0f172a;">${brandName}</strong></p></td></tr><tr><td style="padding:0 24px 22px;background-color:#f8fafc;">${footer}</td></tr></table></td></tr></table></body></html>`;
  return { html, text: plainText(content, academyName) };
};
