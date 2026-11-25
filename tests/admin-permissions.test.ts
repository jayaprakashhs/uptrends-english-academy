import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canAccessAdminSection, type AdminSectionId } from '../src/lib/adminPermissions';

const roles = ['staff', 'admin', 'super_admin'] as const;
const superAdminOnlySections: AdminSectionId[] = ['branding', 'email-settings', 'settings'];

test('email settings, PDF settings, and branding are Super Admin-only sections', () => {
  for (const section of superAdminOnlySections) {
    assert.equal(canAccessAdminSection('staff', section), false, `Staff: ${section}`);
    assert.equal(canAccessAdminSection('admin', section), false, `Admin: ${section}`);
    assert.equal(canAccessAdminSection('super_admin', section), true, `Super Admin: ${section}`);
  }
});

test('FAQ management is available to Admin and Super Admin only', () => {
  assert.equal(canAccessAdminSection('staff', 'faqs'), false);
  assert.equal(canAccessAdminSection('admin', 'faqs'), true);
  assert.equal(canAccessAdminSection('super_admin', 'faqs'), true);
});

test('existing application, program, announcement, media, and callback section access is unchanged', () => {
  const staffSections: AdminSectionId[] = ['applications', 'callbacks', 'demo-class-requests', 'dashboard'];
  const adminSections: AdminSectionId[] = ['announcements', 'media', 'programs'];

  for (const section of staffSections) {
    for (const role of roles) assert.equal(canAccessAdminSection(role, section), true, `${role}: ${section}`);
  }
  for (const section of adminSections) {
    assert.equal(canAccessAdminSection('staff', section), false, `Staff: ${section}`);
    assert.equal(canAccessAdminSection('admin', section), true, `Admin: ${section}`);
    assert.equal(canAccessAdminSection('super_admin', section), true, `Super Admin: ${section}`);
  }
});

test('FAQ RLS migration grants only active admin roles management access', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261126020000_admin_portal_role_permissions.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /DROP POLICY IF EXISTS "Super admin can manage faqs"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Super Admins can manage faqs"/);
  assert.match(
    migration,
    /CREATE POLICY "Admins can manage faqs"\s+ON public\.faqs\s+FOR ALL\s+TO authenticated\s+USING \(public\.is_admin\(\)\)\s+WITH CHECK \(public\.is_admin\(\)\)/,
  );
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.faqs TO authenticated/);
});
