BEGIN;

DROP POLICY IF EXISTS "Super admin can manage faqs" ON public.faqs;
DROP POLICY IF EXISTS "Super Admins can manage faqs" ON public.faqs;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.faqs TO authenticated;

CREATE POLICY "Admins can manage faqs"
  ON public.faqs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMIT;
