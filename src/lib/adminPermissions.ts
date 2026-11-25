import type { AdminRole } from '../types';

const ROLE_RANK: Record<AdminRole, number> = {
  staff: 1,
  admin: 2,
  super_admin: 3,
};

const SECTION_MINIMUM_ROLE = {
  dashboard: 'staff',
  applications: 'staff',
  'demo-class-requests': 'staff',
  callbacks: 'staff',
  programs: 'admin',
  media: 'admin',
  announcements: 'admin',
  branding: 'super_admin',
  faqs: 'admin',
  'about-us': 'super_admin',
  notifications: 'super_admin',
  'email-settings': 'super_admin',
  roles: 'super_admin',
  settings: 'super_admin',
} as const satisfies Record<string, AdminRole>;

export type AdminSectionId = keyof typeof SECTION_MINIMUM_ROLE;

export const canAccessAdminSection = (role: AdminRole, section: AdminSectionId): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[SECTION_MINIMUM_ROLE[section]];
