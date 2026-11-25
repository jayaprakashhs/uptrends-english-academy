BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('e3e1bcd0-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-staff-1@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('e3e1bcd0-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-staff-2@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('e3e1bcd0-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('e3e1bcd0-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-super-admin@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('e3e1bcd0-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rls-profile-target@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
VALUES
  ('e3e1bcd0-0000-4000-8000-000000000001', 'rls-staff-1@example.invalid', 'RLS Staff 1', 'staff', true),
  ('e3e1bcd0-0000-4000-8000-000000000002', 'rls-staff-2@example.invalid', 'RLS Staff 2', 'staff', true),
  ('e3e1bcd0-0000-4000-8000-000000000003', 'rls-admin@example.invalid', 'RLS Admin', 'admin', true),
  ('e3e1bcd0-0000-4000-8000-000000000004', 'rls-super-admin@example.invalid', 'RLS Super Admin', 'super_admin', true);

SET LOCAL request.jwt.claim.sub = 'e3e1bcd0-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims = '{"sub":"e3e1bcd0-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.is((SELECT count(*)::integer FROM public.admin_profiles), 1, 'Staff sees only their own profile');
SELECT extensions.throws_ok(
  $$INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
    VALUES ('e3e1bcd0-0000-4000-8000-000000000005', 'rls-profile-target@example.invalid', 'Target', 'super_admin', true)$$,
  '42501',
  'new row violates row-level security policy for table "admin_profiles"',
  'Staff cannot insert a profile or escalate a role'
);
WITH changed AS (
  UPDATE public.admin_profiles SET role = 'super_admin'
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000001'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM changed), 0, 'Staff cannot update their own role');
WITH deleted AS (
  DELETE FROM public.admin_profiles
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000002'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM deleted), 0, 'Staff cannot delete another profile');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'e3e1bcd0-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"sub":"e3e1bcd0-0000-4000-8000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.is((SELECT count(*)::integer FROM public.admin_profiles), 1, 'Admin sees only their own profile');
SELECT extensions.throws_ok(
  $$INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
    VALUES ('e3e1bcd0-0000-4000-8000-000000000005', 'rls-profile-target@example.invalid', 'Target', 'super_admin', true)$$,
  '42501',
  'new row violates row-level security policy for table "admin_profiles"',
  'Admin cannot insert profiles'
);
WITH changed AS (
  UPDATE public.admin_profiles SET role = 'staff'
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000001'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM changed), 0, 'Admin cannot update another profile');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'e3e1bcd0-0000-4000-8000-000000000004';
SET LOCAL request.jwt.claims = '{"sub":"e3e1bcd0-0000-4000-8000-000000000004","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.is((SELECT count(*)::integer FROM public.admin_profiles), 4, 'Super Admin can view all profiles');
SELECT extensions.lives_ok(
  $$INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
    VALUES ('e3e1bcd0-0000-4000-8000-000000000005', 'rls-profile-target@example.invalid', 'Target', 'staff', true)$$,
  'Super Admin can create a profile'
);
WITH changed AS (
  UPDATE public.admin_profiles SET role = 'admin'
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000001'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM changed), 1, 'Super Admin can update another profile');
WITH changed AS (
  UPDATE public.admin_profiles SET role = 'staff'
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000004'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM changed), 0, 'Super Admin cannot change their own role');
WITH deleted AS (
  DELETE FROM public.admin_profiles
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000004'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM deleted), 0, 'Super Admin cannot delete their own profile');
WITH deleted AS (
  DELETE FROM public.admin_profiles
  WHERE id = 'e3e1bcd0-0000-4000-8000-000000000002'
  RETURNING 1
)
SELECT extensions.is((SELECT count(*)::integer FROM deleted), 1, 'Super Admin can delete another profile');

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
