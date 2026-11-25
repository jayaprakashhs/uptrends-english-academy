import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20261127000000_admin_profile_rls_and_bootstrap_policy_compatibility.sql', import.meta.url),
  'utf8',
);
const documentation = readFileSync(new URL('../supabase/README.md', import.meta.url), 'utf8');

test('admin profile migration replaces every known broad bootstrap policy', () => {
  const legacyPolicies = [
    'Users can view own admin profile',
    'Staff and Admins can view profiles',
    'Admins can view admin profiles',
    'Super admin can manage admin profiles',
    'Super Admins can insert admin profiles',
    'Super Admins can update admin profiles',
    'Super Admins can delete admin profiles',
  ];

  for (const policy of legacyPolicies) {
    assert.match(
      migration,
      new RegExp(`DROP POLICY IF EXISTS "${policy}" ON public\\.admin_profiles;`),
    );
  }

  assert.match(migration, /USING \(id = auth\.uid\(\)\)/);
  assert.match(migration, /USING \(public\.is_super_admin\(\)\)/);
  assert.match(migration, /WITH CHECK \(public\.is_super_admin\(\) AND id <> auth\.uid\(\)\)/);
  assert.match(migration, /USING \(public\.is_super_admin\(\) AND id <> auth\.uid\(\)\)/);
});

test('admin profile grants leave row authorization to RLS', () => {
  assert.match(migration, /ALTER TABLE public\.admin_profiles ENABLE ROW LEVEL SECURITY;/);
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.admin_profiles\s+FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.admin_profiles\s+TO authenticated;/,
  );
});

test('database setup docs identify bootstrap snapshots as alternatives', () => {
  assert.match(documentation, /overlapping historical\s+bootstrap snapshots, not sequential setup steps/);
  assert.match(documentation, /apply `20261024_complete_schema_and_super_admin\.sql` once/);
});
