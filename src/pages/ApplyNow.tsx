import React, { useState } from 'react';
import { Program } from '../types';
import { compressPassportPhoto } from '../lib/imageCompressor';
import { MAX_APPLICATION_PHOTO_BYTES } from '../../application-photo-storage';
import {
  getApplicationPrimaryContact,
  validateApplicationCategoryFields,
  type ApplicationCategoryField,
  type ApplicationCategoryFieldErrors,
  type ApplicationQualificationCategory,
} from '../../application-request';
import { CheckCircle2, AlertCircle, Upload, ArrowRight, FileCheck, RefreshCw, Target, GraduationCap, MessageCircle, UsersRound, Clock } from 'lucide-react';
import { isValidContactEmail, normalizeIndianMobileNumber } from '../../contact-validation';
import { ContactValidationMessage, useContactDuplicateValidation } from '../hooks/useContactDuplicateValidation';
import { PremiumDropdown } from '../components/PremiumDropdown';

const applicationBenefits = [
  {
    title: 'Personalized Guidance',
    description: 'Learn at your level and pace.',
    icon: Target,
  },
  {
    title: 'All-Level Training',
    description: 'Beginner to advanced programs.',
    icon: GraduationCap,
  },
  {
    title: 'Speaking Practice',
    description: 'Improve fluency and pronunciation.',
    icon: MessageCircle,
  },
  {
    title: 'Interactive Sessions',
    description: 'Learn through active participation.',
    icon: UsersRound,
  },
  {
    title: 'Flexible Learning',
    description: 'Fit classes into your schedule.',
    icon: Clock,
  },
  {
    title: 'Progress Guidance',
    description: 'Get feedback to improve continuously.',
    icon: RefreshCw,
  },
] as const;

interface ApplyNowProps {
  programs: Program[];
  selectedProgram: Program | null;
  setCurrentPage: (page: string) => void;
}

export const ApplyNow: React.FC<ApplyNowProps> = ({
  programs,
  selectedProgram,
  setCurrentPage,
}) => {
  const publishedPrograms = programs.filter((p) => p.is_published);

  // Form states
  const [studentName, setStudentName] = useState('');
  const [qualificationCategory, setQualificationCategory] = useState<ApplicationQualificationCategory | ''>('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [qualification, setQualification] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [collegeName, setCollegeName] = useState('');
  const [occupation, setOccupation] = useState('');
  const [programId, setProgramId] = useState(
    selectedProgram ? selectedProgram.id : (publishedPrograms[0]?.id || '')
  );
  const [dateOfBirth, setDateOfBirth] = useState('');
  const dateOfBirthInputRef = React.useRef<HTMLInputElement | null>(null);
  const [address, setAddress] = useState('');
  const [place, setPlace] = useState('');
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(true);

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoSizeKB, setPhotoSizeKB] = useState<number | null>(null);
  const [photoSizeBytes, setPhotoSizeBytes] = useState<number | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string>('image/jpeg');
  const [photoCompressionMessage, setPhotoCompressionMessage] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  // Submission states
  const [submitting, setSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [headerStackHeight, setHeaderStackHeight] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryErrors, setCategoryErrors] = useState<ApplicationCategoryFieldErrors>({});
  const [categoryValidationAttempted, setCategoryValidationAttempted] = useState(false);
  const primaryEmail = qualificationCategory === 'Student' ? parentEmail : email;
  const primaryMobile = qualificationCategory === 'Student' ? parentPhone : mobile;
  const contactValidation = useContactDuplicateValidation(primaryEmail, primaryMobile);

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

  React.useLayoutEffect(() => {
    const headerStack = document.querySelector<HTMLElement>('[data-apply-header-stack]');
    if (!headerStack) return;

    const updateHeaderStackHeight = () => {
      setHeaderStackHeight(headerStack.getBoundingClientRect().height);
    };
    updateHeaderStackHeight();

    const observer = new ResizeObserver(updateHeaderStackHeight);
    observer.observe(headerStack);
    return () => observer.disconnect();
  }, []);

  const validateCategoryFields = (overrides: Partial<Record<ApplicationCategoryField, string>> = {}) => (
    validateApplicationCategoryFields({
      qualification_category: qualificationCategory,
      qualification,
      parent_phone: parentPhone,
      parent_email: parentEmail,
      school_name: schoolName,
      college_name: collegeName,
      occupation,
      place,
      city,
      ...overrides,
    })
  );

  const updateCategoryField = (
    field: ApplicationCategoryField,
    value: string,
    updateValue: (value: string) => void,
  ) => {
    updateValue(value);
    if (categoryValidationAttempted) {
      const validation = validateCategoryFields({ [field]: value });
      setCategoryErrors(validation.valid ? {} : validation.errors);
      return;
    }

    setCategoryErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const categoryErrorId = (field: ApplicationCategoryField) => (
    `application-${field.replace(/_/g, '-')}-error`
  );

  const renderCategoryError = (field: ApplicationCategoryField) => (
    categoryErrors[field]
      ? <p id={categoryErrorId(field)} role="alert" className="mt-1 text-[11px] font-medium normal-case text-rose-700">{categoryErrors[field]}</p>
      : null
  );

  const handleQualificationCategoryChange = (category: ApplicationQualificationCategory | '') => {
    setQualificationCategory(category);
    setQualification('');
    setParentPhone('');
    setParentEmail('');
    setSchoolName('');
    setCollegeName('');
    setOccupation('');
    setCategoryErrors((current) => ({ place: current.place, city: current.city }));
    setCategoryValidationAttempted(false);
    setErrorMessage(null);
  };

  // Handle Photo Selection & Compression (Strict <= 300 KB)
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    setErrorMessage(null);
    if (!file || compressing || submitting) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setErrorMessage(`Please upload a valid image (JPEG, PNG, or WebP).${photoPreview ? ' Your previously selected photo is still selected.' : ''}`);
      return;
    }

    try {
      setCompressing(true);
      // Run browser canvas compression with 300 KB limit
      const compressed = await compressPassportPhoto(file, MAX_APPLICATION_PHOTO_BYTES);
      setPhotoFile(file);
      setPhotoPreview(compressed.base64);
      setPhotoSizeKB(compressed.sizeKB);
      setPhotoSizeBytes(compressed.sizeBytes);
      setPhotoMimeType(compressed.mimeType);
      setPhotoCompressionMessage(file.size > MAX_APPLICATION_PHOTO_BYTES
        ? `Photo automatically compressed from ${Math.ceil(file.size / 1024)} KB to ${Math.ceil(compressed.sizeBytes / 1024)} KB.`
        : null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error processing the selected photo.';
      setErrorMessage(`${message}${photoPreview ? ' Your previously selected photo is still selected.' : ''}`);
    } finally {
      setCompressing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setCategoryValidationAttempted(true);
    const categoryFields = validateCategoryFields();
    setCategoryErrors(categoryFields.valid ? {} : categoryFields.errors);

    // Client-side validations
    if (!studentName.trim()) {
      setErrorMessage('Student full name is required.');
      return;
    }
    if (!categoryFields.valid) {
      return;
    }
    if (qualificationCategory !== 'Student' && !normalizeIndianMobileNumber(mobile)) {
      setErrorMessage('Please provide a valid Indian mobile number.');
      return;
    }
    if (qualificationCategory !== 'Student' && !isValidContactEmail(email)) {
      setErrorMessage('A valid email address is mandatory to receive confirmation and admission decisions.');
      return;
    }
    const applicationContact = getApplicationPrimaryContact(categoryFields.value, { mobile, email });
    if (!applicationContact) {
      setErrorMessage('Valid parent contact details are required for Student applications.');
      return;
    }
    if (compressing) {
      setErrorMessage('Please wait for photo processing to finish.');
      return;
    }
    if (!photoPreview || photoSizeBytes === null) {
      setErrorMessage('A passport-size photograph (300 KB or less) is required.');
      return;
    }
    if (photoSizeBytes !== null && photoSizeBytes > MAX_APPLICATION_PHOTO_BYTES) {
      setErrorMessage(`Photograph size (${photoSizeKB} KB) exceeds the 300 KB maximum limit. Please re-upload.`);
      return;
    }
    if (!privacyConsent) {
      setErrorMessage('You must agree to the privacy policy to submit your application.');
      return;
    }

    const [emailResult, mobileResult] = await Promise.all([
      contactValidation.validateEmail(applicationContact.email),
      contactValidation.validateMobile(applicationContact.mobile),
    ]);
    if (emailResult.error || mobileResult.error) {
      setErrorMessage(emailResult.error || mobileResult.error || 'Unable to verify your contact information. Please try again.');
      return;
    }

    const currentProgram = programs.find((p) => p.id === programId);
    const progTitle = currentProgram ? currentProgram.title : 'Spoken English Course';

    setSubmitting(true);

    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: studentName,
          mobile: applicationContact.mobile,
          email: applicationContact.email,
          ...categoryFields.value,
          program_id: programId,
          program_name: progTitle,
          date_of_birth: dateOfBirth || null,
          address: address || null,
          message: message || null,
          photo_base64: photoPreview,
          photo_mime_type: photoMimeType,
          privacy_consent: privacyConsent,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit application. Please retry.');
      }

      setSubmissionSuccess(true);
      window.scrollTo({ top: 100, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process application. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        '--application-workspace-height': `calc(100dvh - ${headerStackHeight}px)`,
        '--application-sticky-offset': `${headerStackHeight}px`,
      } as React.CSSProperties}
      className="grid grid-cols-1 bg-[#fff8ef] lg:min-h-[var(--application-workspace-height)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
    >
      <aside className="flex items-start px-5 py-8 sm:px-8 sm:py-10 lg:sticky lg:top-[var(--application-sticky-offset)] lg:self-start lg:px-10 lg:py-6 lg:max-[1439px]:!px-8 lg:max-[1439px]:!py-2">
        <div className="mx-auto w-full max-w-xl">
          <h1 className="text-3xl font-extrabold leading-tight text-slate-950 lg:text-2xl xl:text-3xl lg:max-[1439px]:!text-[26px] lg:max-[1439px]:!leading-[1.15]">
            Welcome to Uptrend’s English Academy
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-700 sm:text-base sm:leading-6 lg:text-sm lg:max-[1439px]:!mt-2 lg:max-[1439px]:!text-[13px] lg:max-[1439px]:!leading-[18px]">
            Build confidence in spoken English with practical training designed for everyday life, academics, and professional success.
          </p>

          <h2 className="mt-5 text-base font-bold text-slate-950 lg:max-[1439px]:!mt-3 lg:max-[1439px]:!text-sm">
            Why Choose Us?
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:max-[1439px]:!mt-2 lg:max-[1439px]:!gap-x-3 lg:max-[1439px]:!gap-y-2">
            {applicationBenefits.map(({ title, description, icon: Icon }) => (
              <li key={title} className="flex items-start gap-2 text-sm leading-5 text-slate-700 lg:max-[1439px]:!gap-1.5 lg:max-[1439px]:!text-[11px] lg:max-[1439px]:!leading-[15px]">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 lg:max-[1439px]:!h-6 lg:max-[1439px]:!w-6">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span><strong className="block font-bold text-slate-900">{title}</strong>{description}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-l-2 border-orange-500 pl-4 lg:max-[1439px]:!mt-3 lg:max-[1439px]:!pl-3">
            <h2 className="text-base font-bold text-slate-950 lg:max-[1439px]:!text-sm lg:max-[1439px]:!leading-[18px]">
              Start Your English Learning Journey Today
            </h2>
            <p className="mt-2 text-sm leading-5 text-slate-600 lg:max-[1439px]:!mt-1.5 lg:max-[1439px]:!text-xs lg:max-[1439px]:!leading-[17px]">
              Complete the application form and take your first step toward confident communication.
            </p>
            <p className="mt-3 text-sm font-bold leading-5 text-orange-700 lg:max-[1439px]:!mt-2 lg:max-[1439px]:!text-xs lg:max-[1439px]:!leading-[17px]">
              Speak with confidence. Grow with Uptrend!
            </p>
          </div>
        </div>
      </aside>

      <section className="min-w-0 bg-[#fff8ef] px-4 py-6 sm:px-6 lg:px-8 lg:py-6">
        <div className="mx-auto max-w-3xl">
      {submissionSuccess ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-10">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 className="w-12 h-12" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-slate-950">Request Received</h1>
            <p className="text-sm text-slate-600 max-w-lg mx-auto">
              Thank you. If we can process your request, the academy will contact you using the details provided.
            </p>
          </div>

          <div className="pt-4 flex justify-center gap-4">
            <button
              onClick={() => {
                setSubmissionSuccess(false);
                setStudentName('');
                setMobile('');
                setEmail('');
                setQualification('');
                setPhotoFile(null);
                setPhotoPreview(null);
                setPhotoSizeKB(null);
                setPhotoSizeBytes(null);
                setPhotoCompressionMessage(null);
                setQualificationCategory('');
                setQualification('');
                setParentPhone('');
                setParentEmail('');
                setSchoolName('');
                setCollegeName('');
                setOccupation('');
                setPlace('');
                setCity('');
                setCategoryErrors({});
                setCategoryValidationAttempted(false);
              }}
              className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
            >
              Submit Another Application
            </button>
            <button
              onClick={() => setCurrentPage('home')}
              className="px-6 py-2.5 rounded-xl bg-orange-600 text-white text-xs font-bold hover:bg-orange-500 cursor-pointer"
            >
              Return to Homepage
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-white px-5 py-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700">
              Admissions application
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
              Join Our Academy
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Complete your application to get started.
            </p>
          </div>

          {/* Form */}
          <form noValidate onSubmit={handleSubmit} className="space-y-7 p-5 sm:p-8">
            {errorMessage && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-xs">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <strong className="block font-bold">Submission Notice:</strong>
                  <span>{errorMessage}</span>
                </div>
              </div>
            )}

            {/* Section 1: Student Information */}
            <div className="space-y-4">
              <h2 className="text-base font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-xs flex items-center justify-center font-bold">
                  1
                </span>
                <span>Personal & Academic Details</span>
              </h2>

              <div className="grid grid-cols-1 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Student Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Enter student's legal name"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label htmlFor="application-qualification-category" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Qualification Category *
                  </label>
                  <PremiumDropdown
                    id="application-qualification-category"
                    name="qualification_category"
                    required
                    value={qualificationCategory}
                    onChange={(value) => handleQualificationCategoryChange(value as ApplicationQualificationCategory | '')}
                    aria-invalid={Boolean(categoryErrors.qualification_category)}
                    aria-describedby={categoryErrors.qualification_category ? categoryErrorId('qualification_category') : undefined}
                    className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 bg-white ${categoryErrors.qualification_category ? 'border-rose-600' : 'border-slate-300'}`}
                    placeholder="Select category"
                    options={[
                      { value: 'Student', label: 'Student' },
                      { value: 'Graduate', label: 'Graduate' },
                      { value: 'Working', label: 'Working' },
                    ]}
                  />
                  {renderCategoryError('qualification_category')}
                </div>
              </div>

              {qualificationCategory !== 'Student' && (
                <>
                  <div className="grid grid-cols-1 gap-5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Mobile Number *
                      </label>
                      <input
                        type="tel"
                        required
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        onBlur={() => void contactValidation.validateMobile(mobile)}
                        aria-invalid={contactValidation.mobileCheck.duplicate || Boolean(contactValidation.mobileCheck.error)}
                        aria-describedby="application-mobile-validation"
                        placeholder="+91 98765 43210"
                        className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${contactValidation.mobileCheck.duplicate || contactValidation.mobileCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                      />
                      <ContactValidationMessage id="application-mobile-validation" state={contactValidation.mobileCheck} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Email ID *
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => void contactValidation.validateEmail(email)}
                        aria-invalid={contactValidation.emailCheck.duplicate || Boolean(contactValidation.emailCheck.error)}
                        aria-describedby="application-email-validation"
                        placeholder="student@example.com"
                        className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${contactValidation.emailCheck.duplicate || contactValidation.emailCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                      />
                      <ContactValidationMessage id="application-email-validation" state={contactValidation.emailCheck} />
                      <p className="text-[11px] text-slate-400 mt-1">Confirmation and application updates will be delivered to this address.</p>
                    </div>
                  </div>
                </>
              )}

              {qualificationCategory === 'Student' && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Parent / Guardian Details</h3>
                  <div className="mt-3 grid grid-cols-1 gap-5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Parent Phone Number *
                      <input
                        id="application-parent-phone"
                        type="tel"
                        required
                        maxLength={30}
                        autoComplete="tel"
                        value={parentPhone}
                        onChange={(event) => updateCategoryField('parent_phone', event.target.value, setParentPhone)}
                        onBlur={() => void contactValidation.validateMobile(parentPhone)}
                        aria-invalid={Boolean(categoryErrors.parent_phone || contactValidation.mobileCheck.error)}
                        aria-describedby={[categoryErrors.parent_phone ? categoryErrorId('parent_phone') : null, 'application-parent-mobile-validation'].filter(Boolean).join(' ')}
                        placeholder="+91 98765 43210"
                        className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.parent_phone || contactValidation.mobileCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                      />
                      {renderCategoryError('parent_phone')}
                      <ContactValidationMessage id="application-parent-mobile-validation" state={contactValidation.mobileCheck} />
                    </label>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Parent Email ID *
                      <input
                        id="application-parent-email"
                        type="email"
                        required
                        maxLength={320}
                        autoComplete="email"
                        value={parentEmail}
                        onChange={(event) => updateCategoryField('parent_email', event.target.value, setParentEmail)}
                        onBlur={() => void contactValidation.validateEmail(parentEmail)}
                        aria-invalid={Boolean(categoryErrors.parent_email || contactValidation.emailCheck.error)}
                        aria-describedby={[categoryErrors.parent_email ? categoryErrorId('parent_email') : null, 'application-parent-email-validation'].filter(Boolean).join(' ')}
                        placeholder="parent@example.com"
                        className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.parent_email || contactValidation.emailCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                      />
                      {renderCategoryError('parent_email')}
                      <ContactValidationMessage id="application-parent-email-validation" state={contactValidation.emailCheck} />
                      <p className="mt-1 text-[11px] text-slate-400 normal-case">Confirmation and application updates will be delivered to this address.</p>
                    </label>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      School Name *
                      <input
                        id="application-school-name"
                        type="text"
                        required
                        maxLength={200}
                        value={schoolName}
                        onChange={(event) => updateCategoryField('school_name', event.target.value, setSchoolName)}
                        aria-invalid={Boolean(categoryErrors.school_name)}
                        aria-describedby={categoryErrors.school_name ? categoryErrorId('school_name') : undefined}
                        className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.school_name ? 'border-rose-600' : 'border-slate-300'}`}
                      />
                      {renderCategoryError('school_name')}
                    </label>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Which Class Are You Studying? *
                      <input
                        id="application-qualification"
                        type="text"
                        required
                        maxLength={500}
                        value={qualification}
                        onChange={(event) => updateCategoryField('qualification', event.target.value, setQualification)}
                        aria-invalid={Boolean(categoryErrors.qualification)}
                        aria-describedby={categoryErrors.qualification ? categoryErrorId('qualification') : undefined}
                        placeholder="e.g. 10th Standard / PUC 1st Year"
                        className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.qualification ? 'border-rose-600' : 'border-slate-300'}`}
                      />
                      {renderCategoryError('qualification')}
                    </label>
                  </div>
                </div>
              )}

              {qualificationCategory === 'Graduate' && (
                <div className="grid grid-cols-1 gap-5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    College Name *
                    <input
                      id="application-college-name"
                      type="text"
                      required
                      maxLength={200}
                      value={collegeName}
                      onChange={(event) => updateCategoryField('college_name', event.target.value, setCollegeName)}
                      aria-invalid={Boolean(categoryErrors.college_name)}
                      aria-describedby={categoryErrors.college_name ? categoryErrorId('college_name') : undefined}
                      className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.college_name ? 'border-rose-600' : 'border-slate-300'}`}
                    />
                    {renderCategoryError('college_name')}
                  </label>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Qualification *
                    <input
                      id="application-qualification"
                      type="text"
                      required
                      maxLength={500}
                      value={qualification}
                      onChange={(event) => updateCategoryField('qualification', event.target.value, setQualification)}
                      aria-invalid={Boolean(categoryErrors.qualification)}
                      aria-describedby={categoryErrors.qualification ? categoryErrorId('qualification') : undefined}
                      placeholder="e.g. B.Com, B.Sc, MBA"
                      className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.qualification ? 'border-rose-600' : 'border-slate-300'}`}
                    />
                    {renderCategoryError('qualification')}
                  </label>
                </div>
              )}

              {qualificationCategory === 'Working' && (
                <div className="grid grid-cols-1 gap-5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Occupation *
                    <input
                      id="application-occupation"
                      type="text"
                      required
                      maxLength={200}
                      value={occupation}
                      onChange={(event) => updateCategoryField('occupation', event.target.value, setOccupation)}
                      aria-invalid={Boolean(categoryErrors.occupation)}
                      aria-describedby={categoryErrors.occupation ? categoryErrorId('occupation') : undefined}
                      placeholder="e.g. Teacher, Engineer"
                      className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.occupation ? 'border-rose-600' : 'border-slate-300'}`}
                    />
                    {renderCategoryError('occupation')}
                  </label>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Qualification *
                    <input
                      id="application-qualification"
                      type="text"
                      required
                      maxLength={500}
                      value={qualification}
                      onChange={(event) => updateCategoryField('qualification', event.target.value, setQualification)}
                      aria-invalid={Boolean(categoryErrors.qualification)}
                      aria-describedby={categoryErrors.qualification ? categoryErrorId('qualification') : undefined}
                      placeholder="e.g. B.Com, Diploma"
                      className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.qualification ? 'border-rose-600' : 'border-slate-300'}`}
                    />
                    {renderCategoryError('qualification')}
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Selected Program *
                  </label>
                  <PremiumDropdown
                    id="application-selected-program"
                    value={programId}
                    onChange={setProgramId}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 bg-white"
                    options={programs.map((program) => ({
                      value: program.id,
                      label: `${program.title} ${program.level ? `(${program.level})` : ''}`,
                    }))}
                  />
                </div>

                <div>
                  <label htmlFor="application-date-of-birth" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Date of Birth (Optional)
                  </label>
                  <div onClick={openDatePicker} className="w-full cursor-pointer">
                    <input
                      ref={dateOfBirthInputRef}
                      id="application-date-of-birth"
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className="w-full cursor-pointer px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Place *
                  <input
                    id="application-place"
                    type="text"
                    required
                    maxLength={200}
                    value={place}
                    onChange={(event) => updateCategoryField('place', event.target.value, setPlace)}
                    aria-invalid={Boolean(categoryErrors.place)}
                    aria-describedby={categoryErrors.place ? categoryErrorId('place') : undefined}
                    placeholder="Area / locality"
                    className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.place ? 'border-rose-600' : 'border-slate-300'}`}
                  />
                  {renderCategoryError('place')}
                </label>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  City *
                  <input
                    id="application-city"
                    type="text"
                    required
                    maxLength={120}
                    autoComplete="address-level2"
                    value={city}
                    onChange={(event) => updateCategoryField('city', event.target.value, setCity)}
                    aria-invalid={Boolean(categoryErrors.city)}
                    aria-describedby={categoryErrors.city ? categoryErrorId('city') : undefined}
                    className={`mt-1 w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${categoryErrors.city ? 'border-rose-600' : 'border-slate-300'}`}
                  />
                  {renderCategoryError('city')}
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Residential Address (Optional)
                </label>
                <input type="text" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Building / street address" className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Additional Message or Learning Goals (Optional)
                </label>
                <textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you hope to achieve (e.g. interview preparation, fluency, grammar)..."
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 resize-none"
                />
              </div>
            </div>

            {/* Section 2: Passport-Size Photograph (Strict <= 300 KB requirement) */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h2 className="text-base font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-xs flex items-center justify-center font-bold">
                    2
                  </span>
                  <span>Passport-Size Photograph *</span>
                </div>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                  Strictly ≤ 300 KB
                </span>
              </h2>

              <p className="text-xs text-slate-500">
                Upload a recent front-facing passport photograph. Supported formats: JPEG, PNG, WebP. The photo will automatically be compressed to under 300 KB.
              </p>

              <div className="grid grid-cols-1 gap-5">
                <div>
                  <label className="border-2 border-dashed border-slate-300 hover:border-orange-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-orange-50/20">
                    <Upload className="w-8 h-8 text-slate-400 mb-2" />
                    <span className="text-xs font-bold text-slate-800">
                      Click to choose photo or drag & drop
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1">
                      JPEG, PNG, WebP (Max 300 KB compressed)
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoChange}
                      disabled={compressing || submitting}
                      className="hidden"
                    />
                  </label>
                  {compressing && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-orange-600">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing photo and checking the 300 KB limit...</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-center justify-center">
                  {photoPreview ? (
                    <div className="space-y-2 text-center">
                      <div className="w-28 h-36 rounded-xl overflow-hidden border-2 border-emerald-500 shadow-md mx-auto relative bg-slate-100">
                        <img
                          src={photoPreview}
                          alt="Passport preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        <FileCheck className="w-3 h-3" />
                        <span>Ready: {photoSizeKB} KB (≤ 300 KB)</span>
                      </div>
                      {photoCompressionMessage && <p role="status" className="text-[11px] font-semibold text-blue-700">{photoCompressionMessage}</p>}
                    </div>
                  ) : (
                    <div className="w-28 h-36 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 text-center p-2 bg-slate-50">
                      <span className="text-[11px]">Photo Preview (Passport)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Privacy Consent */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  id="privacy"
                  required
                  checked={privacyConsent}
                  onChange={(e) => setPrivacyConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 text-orange-600 rounded-sm border-slate-300 focus:ring-orange-500"
                />
                <label htmlFor="privacy" className="text-xs text-slate-700 leading-relaxed cursor-pointer">
                  <strong>Privacy Consent:</strong> I confirm that the details and photograph provided above are accurate and belong to me. I authorize Uptrend’s English Academy to store these details securely in the database and contact me regarding my admission status.
                </label>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={submitting || compressing}
                className="form-submit-button w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white font-extrabold text-base shadow-lg shadow-orange-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    <span role="status" aria-live="polite">Saving application &amp; sending confirmation...</span>
                  </>
                ) : (
                  <>
                    <span>Submit Application</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
              <p className="text-center text-[11px] text-slate-400 mt-2">
                Upon saving, you will receive your database-generated Application Number (UEA-APP-YYYY-0001).
              </p>
            </div>
          </form>
        </div>
      )}
        </div>
      </section>
    </div>
  );
};
