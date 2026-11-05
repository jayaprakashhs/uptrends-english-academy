import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('request-contact migration removes duplicate indexes without changing applications or request records', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261105000005_allow_repeated_demo_and_callback_requests.sql', import.meta.url),
    'utf8',
  );
  const applicationContactMigration = await readFile(
    new URL('../supabase/migrations/20261105000002_allow_multiple_applications_per_contact.sql', import.meta.url),
    'utf8',
  );
  const registryMigration = await readFile(
    new URL('../supabase/migrations/20261030000006_prevent_duplicate_application_contacts.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /DROP INDEX IF EXISTS public\.idx_application_contact_registry_source_email/);
  assert.match(migration, /DROP INDEX IF EXISTS public\.idx_application_contact_registry_source_mobile/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS application_contact_registry_email_key/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS application_contact_registry_mobile_key/);
  assert.match(migration, /p_source_table NOT IN \('applications', 'demo_class_requests', 'callback_requests'\)/);
  assert.match(migration, /RETURN false;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.check_application_contact_duplicate/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.check_application_contact_duplicate[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /DROP TRIGGER|DROP POLICY|DELETE\s+FROM/i);

  assert.match(applicationContactMigration, /IF p_source_table = 'applications' THEN\s+RETURN false;/);
  assert.doesNotMatch(migration, /public\.applications|ALTER TABLE public\.applications/i);
  assert.match(registryMigration, /CREATE TRIGGER trg_sync_application_contact_registry/);
  assert.match(registryMigration, /CREATE TRIGGER trg_sync_callback_contact_registry/);
  assert.match(registryMigration, /CREATE TRIGGER trg_sync_demo_contact_registry/);
});
