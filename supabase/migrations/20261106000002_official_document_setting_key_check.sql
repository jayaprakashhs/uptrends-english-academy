BEGIN;

ALTER TABLE public.official_document_settings
  DROP CONSTRAINT IF EXISTS official_document_settings_setting_key_check;

ALTER TABLE public.official_document_settings
  ADD CONSTRAINT official_document_settings_setting_key_check
  CHECK (setting_key IN ('admission_approval', 'official_fee_structure'));

COMMIT;
