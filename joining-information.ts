export const JOINING_CLASS_SCHEDULES = [
  'Monday to Friday',
  'Monday to Saturday',
  'Sunday',
] as const;

export const JOINING_CLASS_TIMINGS = [
  '8:00 AM – 9:00 AM',
  '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM',
  '11:00 AM – 12:00 PM',
  '12:00 PM – 1:00 PM',
  '1:00 PM – 2:00 PM',
  '2:00 PM – 3:00 PM',
  '3:00 PM – 4:00 PM',
  '4:00 PM – 5:00 PM',
  '5:00 PM – 6:00 PM',
  '6:00 PM – 7:00 PM',
  '7:00 PM – 8:00 PM',
] as const;

export const DEFAULT_JOINING_VENUE = 'Davanagere Ram & Co Circle';

export interface JoiningInformationSettings {
  joiningDate: string;
  classSchedule: string;
  classTimings: string;
  venue: string;
}

export const DEFAULT_JOINING_INFORMATION: JoiningInformationSettings = {
  joiningDate: '',
  classSchedule: '',
  classTimings: '',
  venue: DEFAULT_JOINING_VENUE,
};

const isPlaceholder = (value: string): boolean =>
  /\b(to be confirmed|to be decided|tbd|pending|n\/?a|not set|not decided|not specified|placeholder)\b/i.test(value.trim());

export const isValidJoiningDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const getJoiningInformationErrors = (
  information: JoiningInformationSettings,
): Partial<Record<keyof JoiningInformationSettings, string>> => {
  const errors: Partial<Record<keyof JoiningInformationSettings, string>> = {};
  if (!isValidJoiningDate(information.joiningDate)) {
    errors.joiningDate = information.joiningDate.trim()
      ? 'Choose a valid joining date.'
      : 'Choose a joining date.';
  }
  if (!JOINING_CLASS_SCHEDULES.includes(information.classSchedule as typeof JOINING_CLASS_SCHEDULES[number])) {
    errors.classSchedule = 'Choose a class schedule.';
  }
  if (!JOINING_CLASS_TIMINGS.includes(information.classTimings as typeof JOINING_CLASS_TIMINGS[number])) {
    errors.classTimings = 'Choose a class timing.';
  }
  if (!information.venue.trim() || isPlaceholder(information.venue)) {
    errors.venue = 'Enter a final venue; placeholder text is not accepted.';
  }
  return errors;
};

export const isValidJoiningInformation = (
  information: JoiningInformationSettings,
): boolean => Object.keys(getJoiningInformationErrors(information)).length === 0;

export const isValidJoiningInformationDraft = (value: unknown): value is JoiningInformationSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const information = value as Record<string, unknown>;
  const fields: Array<keyof JoiningInformationSettings> = [
    'joiningDate',
    'classSchedule',
    'classTimings',
    'venue',
  ];
  if (fields.some((field) => typeof information[field] !== 'string')) return false;

  const draft: JoiningInformationSettings = {
    joiningDate: information.joiningDate as string,
    classSchedule: information.classSchedule as string,
    classTimings: information.classTimings as string,
    venue: information.venue as string,
  };
  return draft.joiningDate.length <= 10 &&
    (!draft.joiningDate || isValidJoiningDate(draft.joiningDate)) &&
    draft.classSchedule.length <= 100 &&
    (!draft.classSchedule || JOINING_CLASS_SCHEDULES.includes(draft.classSchedule as typeof JOINING_CLASS_SCHEDULES[number])) &&
    draft.classTimings.length <= 100 &&
    (!draft.classTimings || JOINING_CLASS_TIMINGS.includes(draft.classTimings as typeof JOINING_CLASS_TIMINGS[number])) &&
    draft.venue.length <= 500 &&
    !isPlaceholder(draft.joiningDate) &&
    !isPlaceholder(draft.classSchedule) &&
    !isPlaceholder(draft.classTimings) &&
    !isPlaceholder(draft.venue);
};

export const normalizeJoiningInformation = (value: unknown): JoiningInformationSettings => {
  const information = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const joiningDate = typeof information.joiningDate === 'string' && isValidJoiningDate(information.joiningDate)
    ? information.joiningDate
    : '';
  const classSchedule = typeof information.classSchedule === 'string' &&
    JOINING_CLASS_SCHEDULES.includes(information.classSchedule as typeof JOINING_CLASS_SCHEDULES[number])
    ? information.classSchedule
    : '';
  const classTimings = typeof information.classTimings === 'string' &&
    JOINING_CLASS_TIMINGS.includes(information.classTimings as typeof JOINING_CLASS_TIMINGS[number])
    ? information.classTimings
    : '';
  const venue = typeof information.venue === 'string' &&
    information.venue.trim() &&
    !isPlaceholder(information.venue)
    ? information.venue.trim()
    : DEFAULT_JOINING_VENUE;

  return { joiningDate, classSchedule, classTimings, venue };
};
