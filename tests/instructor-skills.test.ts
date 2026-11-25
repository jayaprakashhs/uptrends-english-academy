import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInstructorSkills } from '../src/components/InstructorProfileCard';

test('normalizes supported skills in display order and keeps the card to three items', () => {
  const skills = normalizeInstructorSkills([
    { label: '  Speaking  ', icon: 'users-round' },
    { label: 'Grammar', icon: 'book-open' },
    { label: 'Writing', icon: 'pencil' },
    { label: 'Listening', icon: 'headphones' },
  ]);

  assert.deepEqual(skills, [
    { label: 'Speaking', icon: 'users-round' },
    { label: 'Grammar', icon: 'book-open' },
    { label: 'Writing', icon: 'pencil' },
  ]);
});

test('ignores malformed skill values and trims labels to the supported length', () => {
  const skills = normalizeInstructorSkills([
    { label: 'A'.repeat(40), icon: 'message-circle' },
    { label: 'Invalid icon', icon: 'not-an-icon' },
    { label: 12, icon: 'globe' },
    null,
  ]);

  assert.deepEqual(skills, [{ label: 'A'.repeat(32), icon: 'message-circle' }]);
  assert.deepEqual(normalizeInstructorSkills(null), []);
});
