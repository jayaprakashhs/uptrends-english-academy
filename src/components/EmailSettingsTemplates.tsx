import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Image, Monitor, RotateCcw, Save, Smartphone, Trash2, Upload, X } from 'lucide-react';
import { applyEmailTemplate, DEFAULT_EMAIL_SETTINGS, normalizeEmailSettings, type EmailSettings, type EmailTemplateKey } from '../../email-settings';
import { DEFAULT_EMAIL_HERO_IMAGE_URL, renderBrandedEmail } from '../../email-template';
import type { AdminProfile } from '../types';

interface EmailSettingsTemplatesProps {
  currentAdmin: AdminProfile;
  onSessionExpired: () => void;
}

const templateOptions: Array<{ key: EmailTemplateKey; label: string }> = [
  { key: 'demo_applicant', label: 'Demo Class Request Received — Applicant' },
  { key: 'demo_staff', label: 'Demo Class Request — Academy Notification' },
  { key: 'application_applicant', label: 'Application Received — Applicant' },
  { key: 'application_staff', label: 'Application Received — Academy Notification' },
  { key: 'admission_approved', label: 'Admission Approved' },
  { key: 'callback_staff', label: 'Callback Request — Academy Notification' },
];

const sampleContent = (key: EmailTemplateKey) => {
  const isApproval = key === 'admission_approved';
  const isDemo = key.startsWith('demo_');
  const isCallback = key === 'callback_staff';
  const isStaff = key.endsWith('_staff');
  return {
    title: '',
    greeting: isStaff ? undefined : 'Preview Student',
    paragraphs: [
      '',
      ...(isApproval ? ['Please find your official admission approval document attached.'] : []),
    ],
    status: isApproval ? 'Approved' : 'Pending',
    actionMessage: '',
    referenceNumber: isDemo ? 'DEMO-PREVIEW-001' : isCallback ? undefined : 'UEA-APP-PREVIEW-001',
    details: [
      ...(isCallback ? [
        { label: 'Applicant', value: 'Preview Student' },
        { label: 'Mobile', value: '+91 90000 00000' },
        { label: 'Email', value: 'preview@example.com' },
        { label: 'Preferred Time', value: 'Afternoon' },
        { label: 'Message', value: 'Sample message for preview only.' },
      ] : [
        { label: isStaff ? 'Student' : 'Program', value: isDemo ? 'Spoken English (Demo Class)' : 'Spoken English' },
        ...(!isDemo ? [{ label: 'Application Reference', value: 'UEA-APP-PREVIEW-001' }] : []),
        ...(isApproval ? [{ label: 'Student ID', value: 'UEA-STU-PREVIEW-001' }] : []),
        ...(isDemo ? [{ label: 'Request Date', value: '06 Nov 2026' }] : []),
      ]),
      { label: 'Preview Data', value: 'Synthetic sample — not sent' },
    ],
  };
};

const MAX_HEADER_PHOTO_BYTES = 3 * 1024 * 1024;
const HEADER_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const fileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string'
    ? resolve(reader.result)
    : reject(new Error('The selected photo could not be read.'));
  reader.onerror = () => reject(new Error('The selected photo could not be read.'));
  reader.readAsDataURL(file);
});

const InputField: React.FC<{
  label: string;
  value: string;
  disabled: boolean;
  type?: 'text' | 'url' | 'email' | 'tel' | 'color';
  onChange: (value: string) => void;
}> = ({ label, value, disabled, type = 'text', onChange }) => (
  <label className="block min-w-0 text-xs font-semibold text-slate-700">
    {label}
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
    />
  </label>
);

const TextAreaField: React.FC<{
  label: string;
  value: string;
  disabled: boolean;
  rows?: number;
  onChange: (value: string) => void;
}> = ({ label, value, disabled, rows = 3, onChange }) => (
  <label className="block min-w-0 text-xs font-semibold text-slate-700">
    {label}
    <textarea
      rows={rows}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
    />
  </label>
);

export const EmailSettingsTemplates: React.FC<EmailSettingsTemplatesProps> = ({
  currentAdmin,
  onSessionExpired,
}) => {
  const [savedSettings, setSavedSettings] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS);
  const [draft, setDraft] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS);
  const [siteLogoUrl, setSiteLogoUrl] = useState('');
  const [savedPhotoUrl, setSavedPhotoUrl] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [stagedPhotoKeys, setStagedPhotoKeys] = useState<string[]>([]);
  const [templateKey, setTemplateKey] = useState<EmailTemplateKey>('demo_applicant');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const headerPhotoInput = useRef<HTMLInputElement>(null);

  const isSuperAdmin = currentAdmin.role === 'super_admin';
  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedSettings) || stagedPhotoKeys.length > 0;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${currentAdmin.accessToken || sessionStorage.getItem('uptrends_access_token') || ''}`,
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const settingsResponse = await fetch('/api/admin/email-settings', { headers });
        if (settingsResponse.status === 401) onSessionExpired();
        const settingsData = await settingsResponse.json() as {
          settings?: unknown;
          current_logo_url?: unknown;
          header_photo_url?: unknown;
          error?: string;
        };
        if (!settingsResponse.ok || !settingsData.settings) {
          throw new Error(settingsData.error || 'Unable to load email settings.');
        }
        const normalized = normalizeEmailSettings(settingsData.settings);
        if (!normalized) throw new Error('Saved email settings are invalid. Contact a Super Admin.');
        const currentSiteLogo = typeof settingsData.current_logo_url === 'string'
          ? settingsData.current_logo_url
          : '';
        const currentPhotoUrl = typeof settingsData.header_photo_url === 'string'
          ? settingsData.header_photo_url
          : '';
        if (active) {
          setSavedSettings(normalized);
          setDraft(normalized);
          setSiteLogoUrl(currentSiteLogo);
          setSavedPhotoUrl(currentPhotoUrl);
          setPhotoUrl(currentPhotoUrl);
          setReady(true);
        }
      } catch (loadError) {
        if (active) {
          setMessage({
            type: 'error',
            text: loadError instanceof Error ? loadError.message : 'Unable to load email settings.',
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [currentAdmin.accessToken, currentAdmin.id, onSessionExpired]);

  const updateBranding = (key: keyof EmailSettings['branding'], value: string) => {
    setDraft((current) => ({ ...current, branding: { ...current.branding, [key]: value } }));
    setMessage(null);
  };

  const updateTemplate = (key: keyof EmailSettings['templates'][EmailTemplateKey], value: string) => {
    setDraft((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [templateKey]: { ...current.templates[templateKey], [key]: value },
      },
    }));
    setMessage(null);
  };

  const renderedPreview = useMemo(() => {
    const content = applyEmailTemplate(draft, templateKey, sampleContent(templateKey));
    return renderBrandedEmail(content, {
      ...draft.branding,
      logoUrl: draft.branding.logoUrl || siteLogoUrl,
      headerPhotoUrl: photoUrl,
    }).html;
  }, [draft, photoUrl, siteLogoUrl, templateKey]);

  const deleteStagedPhotos = async (keys: string[]) => {
    const uniqueKeys = [...new Set(keys)].filter(Boolean);
    for (const key of uniqueKeys) {
      const response = await fetch(`/api/admin/email-settings/header-photo?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers,
      });
      if (response.status === 401) onSessionExpired();
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'An unused uploaded photo could not be removed.');
    }
  };

  const uploadHeaderPhoto = async (file?: File) => {
    if (!file || !isSuperAdmin || !ready || photoUploading) return;
    if (!HEADER_PHOTO_TYPES.has(file.type)) {
      setMessage({ type: 'error', text: 'Choose a JPEG, PNG, or WebP photo.' });
      return;
    }
    if (file.size === 0 || file.size > MAX_HEADER_PHOTO_BYTES) {
      setMessage({ type: 'error', text: 'The email header photo must be between 1 byte and 3 MB.' });
      return;
    }
    setPhotoUploading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/email-settings/header-photo', {
        method: 'POST',
        headers,
        body: JSON.stringify({ image_file_base64: await fileAsDataUrl(file) }),
      });
      if (response.status === 401) onSessionExpired();
      const result = await response.json() as { object_key?: string; photo_url?: string; error?: string };
      const objectKey = result.object_key;
      const uploadedPhotoUrl = result.photo_url;
      if (!response.ok || !objectKey || !uploadedPhotoUrl) {
        throw new Error(result.error || 'The email header photo could not be uploaded.');
      }
      setDraft((current) => ({
        ...current,
        branding: { ...current.branding, headerPhotoKey: objectKey },
      }));
      setPhotoUrl(uploadedPhotoUrl);
      setStagedPhotoKeys((keys) => [...keys, objectKey]);
      setMessage({ type: 'success', text: 'Photo uploaded to R2. Save Changes to publish it in outgoing emails.' });
    } catch (uploadError) {
      setMessage({
        type: 'error',
        text: uploadError instanceof Error ? uploadError.message : 'The email header photo could not be uploaded.',
      });
    } finally {
      setPhotoUploading(false);
    }
  };

  const saveChanges = async () => {
    if (!isSuperAdmin || !ready) return;
    const normalized = normalizeEmailSettings(draft);
    if (!normalized) {
      setMessage({
        type: 'error',
        text: 'Check required text, six-digit colors, email address, and public HTTPS URLs before saving.',
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/email-settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ settings: normalized }),
      });
      if (response.status === 401) onSessionExpired();
      const result = await response.json() as {
        settings?: unknown;
        error?: string;
        photo_cleanup_warning?: string;
      };
      if (!response.ok || !result.settings) throw new Error(result.error || 'Email settings could not be saved.');
      const saved = normalizeEmailSettings(result.settings);
      if (!saved) throw new Error('The saved email settings could not be validated.');
      setSavedSettings(saved);
      setDraft(saved);
      setSavedPhotoUrl(saved.branding.headerPhotoKey ? photoUrl : '');
      const unusedStagedKeys = stagedPhotoKeys.filter((key) => key !== saved.branding.headerPhotoKey);
      let cleanupWarning = '';
      try {
        await deleteStagedPhotos(unusedStagedKeys);
        setStagedPhotoKeys([]);
      } catch (cleanupError) {
        cleanupWarning = cleanupError instanceof Error ? ` ${cleanupError.message}` : ' An unused uploaded photo could not be removed.';
      }
      const serverWarning = typeof result.photo_cleanup_warning === 'string'
        ? result.photo_cleanup_warning
        : '';
      const cleanupWarnings = [cleanupWarning.trim(), serverWarning].filter(Boolean);
      setMessage({
        type: 'success',
        text: cleanupWarnings.length
          ? `Email settings saved with a cleanup warning: ${cleanupWarnings.join(' ')}`
          : 'Email settings saved successfully.',
      });
    } catch (saveError) {
      setMessage({
        type: 'error',
        text: saveError instanceof Error ? saveError.message : 'Email settings could not be saved.',
      });
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = async () => {
    if (!isSuperAdmin || !ready || resetting) return;
    if (!window.confirm('Restore the default email design and replace all saved email settings? This cannot be undone.')) return;
    setResetting(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/email-settings/reset', {
        method: 'POST',
        headers,
      });
      if (response.status === 401) onSessionExpired();
      const result = await response.json() as {
        settings?: unknown;
        error?: string;
        photo_cleanup_warning?: string;
      };
      if (!response.ok || !result.settings) throw new Error(result.error || 'Default email design could not be restored.');
      const restored = normalizeEmailSettings(result.settings);
      if (!restored) throw new Error('Restored default email settings could not be validated.');
      setSavedSettings(restored);
      setDraft(restored);
      setSavedPhotoUrl('');
      setPhotoUrl('');
      const stagedKeys = stagedPhotoKeys;
      try {
        await deleteStagedPhotos(stagedKeys);
        setStagedPhotoKeys([]);
      } catch (cleanupError) {
        setMessage({
          type: 'error',
          text: `Default email design restored, but ${cleanupError instanceof Error ? cleanupError.message : 'an unused uploaded photo could not be removed.'}`,
        });
        return;
      }
      setMessage({
        type: typeof result.photo_cleanup_warning === 'string' ? 'error' : 'success',
        text: typeof result.photo_cleanup_warning === 'string'
          ? result.photo_cleanup_warning
          : 'Default email design restored.',
      });
    } catch (resetError) {
      setMessage({
        type: 'error',
        text: resetError instanceof Error ? resetError.message : 'Default email design could not be restored.',
      });
    } finally {
      setResetting(false);
    }
  };

  const cancelChanges = async () => {
    setDraft(savedSettings);
    setPhotoUrl(savedPhotoUrl);
    setMessage(null);
    try {
      const unusedKeys = stagedPhotoKeys.filter((key) => key !== savedSettings.branding.headerPhotoKey);
      await deleteStagedPhotos(unusedKeys);
      setStagedPhotoKeys([]);
    } catch (cleanupError) {
      setMessage({
        type: 'error',
        text: cleanupError instanceof Error ? cleanupError.message : 'An unused uploaded photo could not be removed.',
      });
    }
  };

  const template = draft.templates[templateKey];
  const disabled = !isSuperAdmin || loading || saving || resetting || photoUploading || !ready;
  const brandingFields: Array<[keyof EmailSettings['branding'], string, 'text' | 'url' | 'email' | 'tel' | 'color']> = [
    ['academyName', 'Academy name', 'text'],
    ['headerText', 'Header text', 'text'],
    ['academyTagline', 'Academy tagline', 'text'],
    ['logoUrl', 'Email logo URL (blank uses the current site logo)', 'url'],
    ['headerBackgroundColor', 'Header background', 'color'],
    ['headerTextColor', 'Header text color', 'color'],
    ['accentColor', 'Accent and status color', 'color'],
    ['footerBackgroundColor', 'Footer background', 'color'],
    ['footerTextColor', 'Footer text color', 'color'],
    ['footerTagline', 'Footer tagline', 'text'],
    ['address', 'Address', 'text'],
    ['phone', 'Phone', 'tel'],
    ['email', 'Email address', 'email'],
    ['website', 'Website', 'url'],
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-2xl border border-orange-100 bg-gradient-to-r from-[#fff8ef] via-white to-[#EAF3FF] p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-orange-700">Email notifications</p>
        <h1 className="mt-1 text-xl font-extrabold text-[#123B78] sm:text-2xl">Email Settings &amp; Templates</h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Preview uses synthetic sample data and never sends an email. Changes are applied to outgoing notifications only after saving.
        </p>
      </header>

      {message && (
        <div role="status" className={`rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          {message.text}
        </div>
      )}
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading saved email settings…</p>}

      {!loading && (
        <>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="email-template-picker">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label id="email-template-picker" className="block text-xs font-semibold text-slate-700">
                Email template
                <select
                  value={templateKey}
                  onChange={(event) => setTemplateKey(event.target.value as EmailTemplateKey)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  {templateOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setPreviewOpen((open) => !open)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#123B78] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#0B1F4D]"
              >
                <Eye size={16} />{previewOpen ? 'Hide Preview' : 'Preview Email'}
              </button>
            </div>
            {!isSuperAdmin && (
              <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
                Read-only preview access. Only a Super Admin can change and save email settings.
              </p>
            )}
          </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="email-header-photo-title">
              <div>
                <h2 id="email-header-photo-title" className="font-bold text-[#0B1F4D]">Email Header Photo</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {draft.branding.headerPhotoKey
                    ? 'This photo appears in the shared hero area of academy notification emails.'
                    : 'The default student-learning photo is used until a custom photo is saved.'}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-center">
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#F4F7FC]">
                  <img
                    src={photoUrl || DEFAULT_EMAIL_HERO_IMAGE_URL}
                    alt={draft.branding.headerPhotoKey ? 'Current custom email header photo' : 'Default academy email header photo'}
                    className="block aspect-[16/10] w-full object-cover"
                  />
                  <p className="border-t border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600">
                    {draft.branding.headerPhotoKey ? 'Custom email photo' : 'Default email photo'}
                  </p>
                </div>
                {isSuperAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={headerPhotoInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={disabled}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        void uploadHeaderPhoto(file);
                        event.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => headerPhotoInput.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#123B78] px-4 py-2.5 text-xs font-bold text-[#123B78] hover:bg-blue-50 disabled:opacity-50"
                    >
                      <Upload size={15} />{photoUploading ? 'Uploading…' : draft.branding.headerPhotoKey ? 'Replace Photo' : 'Upload New Photo'}
                    </button>
                    <button
                      type="button"
                      disabled={disabled || !draft.branding.headerPhotoKey}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          branding: { ...current.branding, headerPhotoKey: '' },
                        }));
                        setPhotoUrl('');
                        setMessage({ type: 'success', text: 'Photo removal is pending. Save Changes to publish the default photo.' });
                      }}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Trash2 size={15} />Remove Photo
                    </button>
                    <p className="w-full text-xs leading-relaxed text-slate-500">
                      JPEG, PNG, or WebP; maximum 3 MB. A replacement becomes active only after Save Changes succeeds.
                    </p>
                  </div>
                )}
                {!isSuperAdmin && (
                  <p className="flex items-center gap-2 text-xs text-slate-500"><Image size={16} />Photo preview is read-only.</p>
                )}
              </div>
            </section>

            {isSuperAdmin && (
            <>
              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div>
                  <h2 className="font-bold text-[#0B1F4D]">Academy branding and footer</h2>
                  <p className="mt-1 text-xs text-slate-500">The email logo can use the current Site Branding logo or a public HTTPS image URL.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {brandingFields.map(([key, label, type]) => (
                    <InputField
                      key={key}
                      label={label}
                      type={type}
                      value={draft.branding[key]}
                      disabled={disabled}
                      onChange={(value) => updateBranding(key, value)}
                    />
                  ))}
                  <TextAreaField label="Copyright" value={draft.branding.copyright} disabled={disabled} onChange={(value) => updateBranding('copyright', value)} />
                  <TextAreaField label="Automated-email disclaimer" value={draft.branding.disclaimer} disabled={disabled} onChange={(value) => updateBranding('disclaimer', value)} />
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div>
                  <h2 className="font-bold text-[#0B1F4D]">Selected notification content</h2>
                  <p className="mt-1 text-xs text-slate-500">Supported tokens: {'{{academyName}}'}, {'{{program}}'}, {'{{recipientName}}'}, {'{{applicationReference}}'}, and {'{{preferredTime}}'}.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <InputField label="Notification heading" value={template.heading} disabled={disabled} onChange={(value) => updateTemplate('heading', value)} />
                  <InputField label="Button label (blank hides button)" value={template.buttonLabel} disabled={disabled} onChange={(value) => updateTemplate('buttonLabel', value)} />
                  <TextAreaField label="Introductory message" value={template.message} disabled={disabled} onChange={(value) => updateTemplate('message', value)} />
                  <TextAreaField label="Follow-up message" value={template.followUp} disabled={disabled} onChange={(value) => updateTemplate('followUp', value)} />
                  <InputField label="Button URL (HTTPS)" type="url" value={template.buttonUrl} disabled={disabled} onChange={(value) => updateTemplate('buttonUrl', value)} />
                  <InputField label="Button color" type="color" value={template.buttonColor} disabled={disabled} onChange={(value) => updateTemplate('buttonColor', value)} />
                </div>
              </section>

              <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                <button type="button" disabled={disabled} onClick={() => void restoreDefaults()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <RotateCcw size={15} />{resetting ? 'Restoring…' : 'Restore Default Design'}
                </button>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={disabled || !isDirty} onClick={cancelChanges} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <X size={15} />Cancel
                  </button>
                  <button type="button" disabled={disabled || !isDirty} onClick={() => void saveChanges()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50">
                    <Save size={15} />{saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </>
          )}

          {previewOpen && (
            <section className="space-y-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5" aria-label="Synthetic email preview">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-[#0B1F4D]">Live email preview</h2>
                  <p className="mt-1 text-xs text-slate-500">Preview data only. It updates immediately and is never sent.</p>
                </div>
                <div className="flex gap-2" role="group" aria-label="Preview width">
                  <button type="button" aria-pressed={previewMode === 'desktop'} onClick={() => setPreviewMode('desktop')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${previewMode === 'desktop' ? 'border-[#123B78] bg-blue-50 text-[#123B78]' : 'border-slate-200 text-slate-600'}`}><Monitor size={15} />Desktop</button>
                  <button type="button" aria-pressed={previewMode === 'mobile'} onClick={() => setPreviewMode('mobile')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${previewMode === 'mobile' ? 'border-[#123B78] bg-blue-50 text-[#123B78]' : 'border-slate-200 text-slate-600'}`}><Smartphone size={15} />Mobile</button>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#F4F7FC] p-2 sm:p-4">
                <iframe
                  key={`${templateKey}-${previewMode}`}
                  title={`${templateOptions.find((option) => option.key === templateKey)?.label || 'Email'} preview (${previewMode})`}
                  sandbox=""
                  srcDoc={renderedPreview}
                  className="mx-auto block max-w-full bg-white shadow-sm"
                  style={{ width: previewMode === 'mobile' ? 390 : 660, height: 900, border: 0 }}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
