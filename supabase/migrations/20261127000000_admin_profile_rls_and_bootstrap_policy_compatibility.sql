BEGIN;

ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.admin_profiles
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_profiles
  TO authenticated;

DROP POLICY IF EXISTS "Users can view own admin profile" ON public.admin_profiles;
DROP POLICY IF EXISTS "Staff and Admins can view profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Admins can view admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super Admins can insert admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super Admins can update admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super Admins can delete admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super admin can manage admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super admins can view admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super admins can insert admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super admins can update other admin profiles" ON public.admin_profiles;
DROP POLICY IF EXISTS "Super admins can delete other admin profiles" ON public.admin_profiles;

CREATE POLICY "Users can view own admin profile"
  ON public.admin_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Super admins can view admin profiles"
  ON public.admin_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins can insert admin profiles"
  ON public.admin_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins can update other admin profiles"
  ON public.admin_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin() AND id <> auth.uid())
  WITH CHECK (public.is_super_admin() AND id <> auth.uid());

CREATE POLICY "Super admins can delete other admin profiles"
  ON public.admin_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin() AND id <> auth.uid());

COMMIT;
