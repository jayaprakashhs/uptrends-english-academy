import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_JOINING_INFORMATION,
  DEFAULT_JOINING_VENUE,
  JOINING_CLASS_SCHEDULES,
  JOINING_CLASS_TIMINGS,
  getJoiningInformationErrors,
  isValidJoiningDate,
  isValidJoiningInformation,
  isValidJoiningInformationDraft,
  normalizeJoiningInformation,
} from '../joining-information';

test('joining information exposes the required schedule and timing options', () => {
  assert.deepEqual(JOINING_CLASS_SCHEDULES, [
    'Monday to Friday',
    'Monday to Saturday',
    'Sunday',
  ]);
  assert.deepEqual(JOINING_CLASS_TIMINGS, [
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
  ]);
  assert.equal(DEFAULT_JOINING_INFORMATION.venue, DEFAULT_JOINING_VENUE);
});

test('joining date uses a valid ISO calendar date', () => {
  assert.equal(isValidJoiningDate('2026-11-04'), true);
  assert.equal(isValidJoiningDate('2026-02-29'), false);
  assert.equal(isValidJoiningDate('04/11/2026'), false);
});

test('approval requires a valid date, exact dropdown choices, and final venue', () => {
  const valid = {
    joiningDate: '2026-11-04',
    classSchedule: 'Monday to Saturday',
    classTimings: JOINING_CLASS_TIMINGS[0],
    venue: 'Davanagere Ram & Co Circle',
  };
  assert.equal(isValidJoiningInformation(valid), true);
  assert.equal(isValidJoiningInformation({ ...valid, classSchedule: 'Every weekday' }), false);
  assert.equal(isValidJoiningInformation({ ...valid, classTimings: '8:00 AM' }), false);
  assert.equal(isValidJoiningInformation({ ...valid, venue: 'To be confirmed' }), false);
  assert.equal(isValidJoiningInformation({ ...valid, venue: 'To be confirmed at registration' }), false);
  assert.deepEqual(Object.keys(getJoiningInformationErrors({
    joiningDate: '',
    classSchedule: '',
    classTimings: '',
    venue: 'To be confirmed',
  })), ['joiningDate', 'classSchedule', 'classTimings', 'venue']);
});

test('draft validation permits empty fields but rejects invalid values and placeholders', () => {
  assert.equal(isValidJoiningInformationDraft(DEFAULT_JOINING_INFORMATION), true);
  assert.equal(isValidJoiningInformationDraft({
    ...DEFAULT_JOINING_INFORMATION,
    classSchedule: 'Monday to Friday',
  }), true);
  assert.equal(isValidJoiningInformationDraft({
    ...DEFAULT_JOINING_INFORMATION,
    joiningDate: 'tomorrow',
  }), false);
  assert.equal(isValidJoiningInformationDraft({
    ...DEFAULT_JOINING_INFORMATION,
    venue: 'To be confirmed',
  }), false);
});

test('normalization preserves an application-specific venue instead of replacing it', () => {
  assert.deepEqual(normalizeJoiningInformation({
    joiningDate: '2026-11-04',
    classSchedule: 'Monday to Friday',
    classTimings: JOINING_CLASS_TIMINGS[2],
    venue: 'Custom Academy Hall',
  }), {
    joiningDate: '2026-11-04',
    classSchedule: 'Monday to Friday',
    classTimings: JOINING_CLASS_TIMINGS[2],
    venue: 'Custom Academy Hall',
  });
  assert.equal(normalizeJoiningInformation({ venue: ' ' }).venue, DEFAULT_JOINING_VENUE);
});
