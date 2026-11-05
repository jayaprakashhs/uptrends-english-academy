import React, { useState } from 'react';
import { X, PhoneCall, CheckCircle, AlertCircle, Clock, Send } from 'lucide-react';
import { isValidContactEmail, normalizeIndianMobileNumber } from '../../contact-validation';
import { ContactValidationMessage, useContactDuplicateValidation } from '../hooks/useContactDuplicateValidation';

interface CallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledProgram?: string;
}

export const CallbackModal: React.FC<CallbackModalProps> = ({
  isOpen,
  onClose,
  prefilledProgram = 'General Spoken English',
}) => {
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [programName, setProgramName] = useState(prefilledProgram);
  const [preferredTime, setPreferredTime] = useState<'Morning' | 'Afternoon' | 'Evening'>('Morning');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(true);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contactValidation = useContactDuplicateValidation(email, mobile, isOpen);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !mobile.trim()) {
      setError('Please provide your full name and a valid mobile number.');
      return;
    }
    if (!normalizeIndianMobileNumber(mobile)) {
      setError('Please provide a valid Indian mobile number.');
      return;
    }
    if (email.trim() && !isValidContactEmail(email)) {
      setError('Please provide a valid email address.');
      return;
    }

    if (!consent) {
      setError('Please provide consent for the academy to contact you.');
      return;
    }

    setLoading(true);

    try {
      const [emailResult, mobileResult] = await Promise.all([
        contactValidation.validateEmail(email),
        contactValidation.validateMobile(mobile),
      ]);
      if (emailResult.error || mobileResult.error) {
        setError(emailResult.error || mobileResult.error || 'Unable to verify your contact information. Please try again.');
        return;
      }

      const res = await fetch('/api/callback-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          mobile,
          email,
          program_name: programName,
          preferred_contact_time: preferredTime,
          message,
          consent,
        }),
      });

      let data: { error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to submit your callback request. Please try again.');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSuccess(false);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <PhoneCall className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Request a Callback</h3>
              <p className="text-xs text-orange-100">Uptrend’s English Academy • Davangere</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {success ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8" />
              </div>
              <h4 className="text-xl font-bold text-slate-800">Callback Request Received!</h4>
              <p className="text-sm text-slate-600 max-w-sm mx-auto">
                Thank you. If we can process your request, our academic team will contact you using the details provided.
              </p>
              <button
                onClick={handleClose}
                className="mt-4 px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-orange-500 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    onBlur={() => void contactValidation.validateMobile(mobile)}
                    aria-invalid={Boolean(contactValidation.mobileCheck.error)}
                    aria-describedby="callback-mobile-validation"
                    placeholder="+91 98765 43210"
                    className={`w-full px-3.5 py-2.5 rounded-lg border focus:outline-hidden focus:ring-2 focus:ring-orange-500 text-sm ${contactValidation.mobileCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                  />
                  <ContactValidationMessage id="callback-mobile-validation" state={contactValidation.mobileCheck} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => void contactValidation.validateEmail(email)}
                    aria-invalid={Boolean(contactValidation.emailCheck.error)}
                    aria-describedby="callback-email-validation"
                    placeholder="student@example.com"
                    className={`w-full px-3.5 py-2.5 rounded-lg border focus:outline-hidden focus:ring-2 focus:ring-orange-500 text-sm ${contactValidation.emailCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                  />
                  <ContactValidationMessage id="callback-email-validation" state={contactValidation.emailCheck} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Program of Interest
                </label>
                <input
                  type="text"
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-orange-500 text-sm bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-orange-600" />
                  <span>Preferred Contact Time *</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Morning', 'Afternoon', 'Evening'] as const).map((time) => (
                    <button
                      type="button"
                      key={time}
                      onClick={() => setPreferredTime(time)}
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        preferredTime === time
                          ? 'border-orange-600 bg-orange-50 text-orange-700 font-bold'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {time}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 italic">
                  *Contact preference only. Academy hours are 8:00 AM – 8:30 PM.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Message or Specific Query (Optional)
                </label>
                <textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Any specific questions about courses or timings..."
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-orange-500 text-sm resize-none"
                />
              </div>

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="consent"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 text-orange-600 rounded-sm border-slate-300 focus:ring-orange-500"
                />
                <label htmlFor="consent" className="text-xs text-slate-600 leading-tight">
                  I authorize Uptrend’s English Academy to contact me on my mobile number regarding courses and admissions.
                </label>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading || contactValidation.emailCheck.checking || contactValidation.mobileCheck.checking}
                  className="form-submit-button w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm shadow-md transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      <span role="status" aria-live="polite">Submitting Request...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Submit Callback Request</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
