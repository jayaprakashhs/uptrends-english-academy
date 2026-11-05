import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { isValidIndianMobileNumber } from '../../demo-class-request';
import { ContactValidationMessage, useContactDuplicateValidation } from '../hooks/useContactDuplicateValidation';
import { PremiumDropdown } from './PremiumDropdown';

interface DemoClassBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DemoClassForm {
  full_name: string;
  mobile: string;
  email: string;
  qualification_category: '' | 'Student' | 'Graduate' | 'Working';
  parent_name: string;
  school_or_college_name: string;
  college_name: string;
  profession: string;
  educational_qualification: string;
  date_of_birth: string;
  address: string;
  city: string;
  additional_information: string;
}

const emptyForm: DemoClassForm = {
  full_name: '',
  mobile: '',
  email: '',
  qualification_category: '',
  parent_name: '',
  school_or_college_name: '',
  college_name: '',
  profession: '',
  educational_qualification: '',
  date_of_birth: '',
  address: '',
  city: '',
  additional_information: '',
};

const inputClassName = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100';

export const DemoClassBookingModal: React.FC<DemoClassBookingModalProps> = ({ isOpen, onClose }) => {
  const [form, setForm] = useState<DemoClassForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const dateOfBirthInputRef = React.useRef<HTMLInputElement | null>(null);
  const contactValidation = useContactDuplicateValidation(form.email, form.mobile, isOpen);

  useEffect(() => {
    if (!isOpen) {
      setForm(emptyForm);
      setError(null);
      setSubmitted(false);
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, submitting]);

  if (!isOpen) return null;

  const updateForm = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.currentTarget;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const openDatePicker = () => {
    const input = dateOfBirthInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;

    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        input.focus();
        return;
      }
    }

    input.focus();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!isValidIndianMobileNumber(form.mobile)) {
      setError('Enter a valid Indian mobile number.');
      return;
    }
    const [emailResult, mobileResult] = await Promise.all([
      contactValidation.validateEmail(form.email),
      contactValidation.validateMobile(form.mobile),
    ]);
    if (emailResult.error || mobileResult.error) {
      setError(emailResult.error || mobileResult.error || 'Unable to verify your contact information. Please try again.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/demo-class-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to submit your demo class request.');
      }
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit your demo class request.');
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-class-modal-title"
        className="max-h-[94svh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-orange-100 bg-gradient-to-r from-orange-600 to-amber-500 p-5 text-white sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-orange-100">Free Demo Class</p>
            <h2 id="demo-class-modal-title" className="mt-1 text-xl font-extrabold sm:text-2xl">
              {submitted ? 'Request received' : 'Book Your Free Demo Class'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close demo class request"
            className="rounded-lg p-2 text-white transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {submitted ? (
          <div className="space-y-4 p-6 text-center sm:p-10">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" aria-hidden="true" />
            <p className="text-lg font-bold text-slate-900">Thank you, {form.full_name}!</p>
            <p className="mx-auto max-w-lg text-sm leading-relaxed text-slate-600">
              If we can process your request, our team will contact you using the details provided.
            </p>
            <button type="button" onClick={onClose} className="rounded-lg bg-orange-600 px-6 py-3 text-sm font-bold text-white hover:bg-orange-700">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 p-5 sm:p-7">
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-700">
                Full Name *
                <input name="full_name" value={form.full_name} onChange={updateForm} required maxLength={150} autoComplete="name" className={inputClassName} />
              </label>
              <label className="text-xs font-bold text-slate-700">
                Mobile Number *
                <input name="mobile" type="tel" value={form.mobile} onChange={updateForm} onBlur={() => void contactValidation.validateMobile(form.mobile)} aria-invalid={Boolean(contactValidation.mobileCheck.error)} aria-describedby="demo-mobile-validation" required maxLength={30} autoComplete="tel" placeholder="+91 90000 00000" className={`${inputClassName} ${contactValidation.mobileCheck.error ? 'border-rose-600' : ''}`} />
                <ContactValidationMessage id="demo-mobile-validation" state={contactValidation.mobileCheck} />
              </label>
              <label className="text-xs font-bold text-slate-700">
                Email ID *
                <input name="email" type="email" value={form.email} onChange={updateForm} onBlur={() => void contactValidation.validateEmail(form.email)} aria-invalid={Boolean(contactValidation.emailCheck.error)} aria-describedby="demo-email-validation" required maxLength={320} autoComplete="email" className={`${inputClassName} ${contactValidation.emailCheck.error ? 'border-rose-600' : ''}`} />
                <ContactValidationMessage id="demo-email-validation" state={contactValidation.emailCheck} />
              </label>
              <div className="text-xs font-bold text-slate-700">
                <label htmlFor="demo-qualification-category">Qualification Category *</label>
                <PremiumDropdown
                  id="demo-qualification-category"
                  name="qualification_category"
                  aria-label="Qualification Category"
                  value={form.qualification_category}
                  onChange={(value) => setForm((current) => ({ ...current, qualification_category: value as DemoClassForm['qualification_category'] }))}
                  required
                  placeholder="Select category"
                  className={inputClassName}
                  options={[
                    { value: 'Student', label: 'Student' },
                    { value: 'Graduate', label: 'Graduate' },
                    { value: 'Working', label: 'Working' },
                  ]}
                />
              </div>

              {form.qualification_category === 'Student' && (
                <>
                  <label className="text-xs font-bold text-slate-700">
                    Parent Name *
                    <input name="parent_name" value={form.parent_name} onChange={updateForm} required maxLength={150} className={inputClassName} />
                  </label>
                  <label className="text-xs font-bold text-slate-700">
                    School or College Name *
                    <input name="school_or_college_name" value={form.school_or_college_name} onChange={updateForm} required maxLength={200} className={inputClassName} />
                  </label>
                </>
              )}
              {form.qualification_category === 'Graduate' && (
                <label className="text-xs font-bold text-slate-700">
                  College Name *
                  <input name="college_name" value={form.college_name} onChange={updateForm} required maxLength={200} className={inputClassName} />
                </label>
              )}
              {form.qualification_category === 'Working' && (
                <label className="text-xs font-bold text-slate-700">
                  Profession or Occupation *
                  <input name="profession" value={form.profession} onChange={updateForm} required maxLength={200} className={inputClassName} />
                </label>
              )}

              <label className="text-xs font-bold text-slate-700 sm:col-span-2">
                Educational Qualification / Course *
                <input
                  name="educational_qualification"
                  value={form.educational_qualification}
                  onChange={updateForm}
                  required
                  maxLength={200}
                  placeholder="e.g., B.Com, M.Com, B.E., B.Sc, MBA, Diploma"
                  className={inputClassName}
                />
              </label>
              <label className="text-xs font-bold text-slate-700">
                Date of Birth *
                <input ref={dateOfBirthInputRef} name="date_of_birth" type="date" value={form.date_of_birth} onChange={updateForm} onClick={openDatePicker} required max={today} className={`${inputClassName} cursor-pointer`} />
              </label>
              <label className="text-xs font-bold text-slate-700">
                City *
                <input name="city" value={form.city} onChange={updateForm} required maxLength={120} autoComplete="address-level2" className={inputClassName} />
              </label>
              <label className="text-xs font-bold text-slate-700 sm:col-span-2">
                Address *
                <textarea name="address" value={form.address} onChange={updateForm} required maxLength={2000} rows={2} autoComplete="street-address" className={inputClassName} />
              </label>
              <label className="text-xs font-bold text-slate-700 sm:col-span-2">
                Additional Information
                <textarea name="additional_information" value={form.additional_information} onChange={updateForm} maxLength={3000} rows={2} className={inputClassName} />
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="form-submit-button w-full rounded-xl bg-orange-600 px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  <span role="status" aria-live="polite">Submitting request…</span>
                </span>
              ) : 'Submit Demo Class Request'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
};