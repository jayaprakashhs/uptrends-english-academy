export const AUDIENCE_TAGS = [
  'School Students',
  'College Students',
  'Professionals',
  'Homemakers',
] as const;

export type AudienceTag = (typeof AUDIENCE_TAGS)[number];

export const isAudienceTag = (value: unknown): value is AudienceTag =>
  typeof value === 'string' && AUDIENCE_TAGS.some((tag) => tag === value);
