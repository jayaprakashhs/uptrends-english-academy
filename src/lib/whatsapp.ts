export function getWhatsAppUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';
  let internationalNumber = digits;

  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    internationalNumber = `91${digits}`;
  } else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]\d{9}$/.test(digits.slice(1))) {
    internationalNumber = `91${digits.slice(1)}`;
  }

  if (
    internationalNumber.length < 11
    || internationalNumber.length > 15
    || internationalNumber.startsWith('0')
  ) {
    return null;
  }

  return `https://wa.me/${internationalNumber}`;
}
