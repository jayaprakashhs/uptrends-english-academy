import React, { useCallback, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  isValidContactEmail,
  normalizeContactEmail,
  normalizeIndianMobileNumber,
} from '../../contact-validation';

export interface ContactCheckState {
  value: string;
  checking: boolean;
  error: string | null;
}

interface ContactCheckResult {
  error: string | null;
}

const emptyState: ContactCheckState = {
  value: '',
  checking: false,
  error: null,
};

export const useContactDuplicateValidation = (email: string, mobile: string, enabled = true) => {
  const [emailCheck, setEmailCheck] = useState<ContactCheckState>(emptyState);
  const [mobileCheck, setMobileCheck] = useState<ContactCheckState>(emptyState);

  const validateEmail = useCallback(async (value: string): Promise<ContactCheckResult> => {
    const normalized = normalizeContactEmail(value);
    if (!enabled || !normalized) {
      setEmailCheck(emptyState);
      return { error: null };
    }
    if (!isValidContactEmail(normalized)) {
      const error = 'Enter a valid email address.';
      setEmailCheck({ value: normalized, checking: false, error });
      return { error };
    }

    setEmailCheck({ value: normalized, checking: false, error: null });
    return { error: null };
  }, [enabled]);

  const validateMobile = useCallback(async (value: string): Promise<ContactCheckResult> => {
    const normalized = normalizeIndianMobileNumber(value);
    if (!enabled) {
      setMobileCheck(emptyState);
      return { error: null };
    }
    if (!normalized) {
      const error = value.trim() ? 'Enter a valid Indian mobile number.' : null;
      setMobileCheck(error
        ? { value: value.trim(), checking: false, error }
        : emptyState);
      return { error };
    }

    setMobileCheck({ value: normalized, checking: false, error: null });
    return { error: null };
  }, [enabled]);

  const normalizedEmail = normalizeContactEmail(email);
  const normalizedMobile = normalizeIndianMobileNumber(mobile) || mobile.trim();
  const currentEmailCheck = emailCheck.value === normalizedEmail ? emailCheck : emptyState;
  const currentMobileCheck = mobileCheck.value === normalizedMobile ? mobileCheck : emptyState;

  return {
    emailCheck: currentEmailCheck,
    mobileCheck: currentMobileCheck,
    validateEmail,
    validateMobile,
  };
};

export const ContactValidationMessage: React.FC<{
  id: string;
  state: ContactCheckState;
}> = ({ id, state }) => {
  if (state.checking) {
    return (
      <p id={id} role="status" aria-live="polite" className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
        <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-orange-600" />
        Checking…
      </p>
    );
  }
  if (state.error) {
    return (
      <p id={id} role="status" aria-live="polite" className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {state.error}
      </p>
    );
  }
  return <span id={id} className="sr-only" />;
};
