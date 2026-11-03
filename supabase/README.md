# Supabase Database, Security & Super-Admin Setup for Uptrend's English Academy

This guide details the complete database schema, Row-Level Security (RLS) policies, and Super-Admin provisioning for the **Uptrend's English Academy** (Davangere, Karnataka) platform.

---

## 1. Migration File

The complete, self-contained migration script is located at:
`supabase/migrations/20261024_complete_schema_and_super_admin.sql`

It creates:
- **13 Database Tables** in schema `public`:
  1. `admin_profiles` (Admin & Staff roles, activation status, audit timestamps)
  2. `programs` (English courses, levels, duration, target audience)
  3. `applications` (Student admission submissions with reference codes, contact, qualification, passport photo key)
  4. `application_notifications` (Transactional email delivery history and PDF attachment flags)
  5. `callback_requests` (Immediate student call-back requests)
  6. `contact_enquiries` (General inquiries, message details, read status)
  7. `reviews` (Student testimonials, ratings, published status)
  8. `media_items` (YouTube video embeds and gallery covers)
  9. `announcements` (Moving ticker notices with toggleable active status)
  10. `team_members` (Faculty profiles, designations, biographies)
  11. `site_content` (Structured sections: Philosophy, Journey, Mission, Vision, Video Sections)
  12. `faqs` (Frequently Asked Questions)
  13. `site_branding` (Academy brand identity, logos, colors, official PDF path, specifically incorporating `favicon_url`, `footer_logo_url`, `main_logo_alt`, and `logo_alt`)
- **Query Performance Indexes** on frequent lookups (`application_reference`, `status`, `email`, `slug`, `is_published`, etc.)
- **Recursion-Safe Security Functions** with `SECURITY DEFINER SET search_path = public` to prevent infinite recursion during RLS checks:
  - `public.get_current_user_role()`
  - `public.is_admin_or_staff()`
  - `public.is_admin()`
  - `public.is_super_admin()`
- **Strict Row-Level Security (RLS) Policies** on all 13 tables (public read where applicable, staff/admin/super_admin gated writes)
- **Production Seed Data** for all programs, FAQs, testimonials, media, content, and site branding
- **First Super Admin Provisioning** for target User UID: `59bbb687-4e0d-47f7-b458-5a91955f915d`

---

## 2. How to Run the SQL Migration in Supabase

1. Open your browser and log into your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Select your project (`postgres` database).
3. In the left navigation menu, click on the **SQL Editor** icon (`>_`).
4. Click **New Query** (or the `+` button in the tabs).
5. Open `supabase/migrations/20261024_complete_schema_and_super_admin.sql` from this codebase, copy its entire contents, and paste it into the Supabase SQL Editor.
6. Click **Run** (or press `Cmd + Enter` / `Ctrl + Enter`).
7. Inspect the Results panel:
   - All 13 tables are created.
   - Indexes and security functions are compiled.
   - RLS is enabled on all tables.
   - Seed data is loaded.
   - Super Admin profile is provisioned for UID `59bbb687-4e0d-47f7-b458-5a91955f915d`.

## 2.1. Add the Separate Demo Class Request Workflow

After applying the main schema migration, apply
`supabase/migrations/20261029000000_demo_class_requests.sql` in the Supabase SQL
Editor. This creates a separate `demo_class_requests` table with its own
statuses and staff access through the server-side API. Demo applicant photos
are stored under the private `demo-class-requests/` prefix in the
`APPLICATION_MEDIA` R2 bucket; they are not stored in admission application
records or made public.

The existing `APPLICATION_NOTIFICATION_EMAIL`, `RESEND_API_KEY`, and
`RESEND_FROM_EMAIL` settings are used for demo-request email notifications. No
new environment variables are required.

## 2.2. Cross-Table Duplicate Contact Validation

The migration
`supabase/migrations/20261030000006_prevent_duplicate_application_contacts.sql`
adds a private contact registry and database triggers for `applications`,
`callback_requests`, and `demo_class_requests`. Normalized email and Indian
mobile values have unique constraints in the registry, so simultaneous
submissions are serialized by PostgreSQL. The protected
`check_application_contact_duplicate` RPC is available only to `service_role`;
it is called only by trusted server-side submission handlers. There is no
public contact-preflight endpoint. Public forms receive the same generic
acknowledgement for accepted and duplicate contacts, while duplicate records
are rejected by the server and database constraints. This avoids direct
duplicate-status disclosure; response timing is not guaranteed to be
indistinguishable.

The migration locks the three submission tables and stops without changing
source records if existing duplicate contacts are found. Review the migration
and resolve any reported pre-existing duplicates through the academy's approved
data-maintenance process before applying it. Do not remove student records to
make the migration succeed. No new environment variables are required; the
existing server-side Supabase service-role key is used for validation.

## 2.3. Official Admission PDF and Payment Versions

After applying `20261031000003_application_qualification_category.sql`, apply
`supabase/migrations/20261031000004_official_document_payment_versions.sql`.
It adds nullable `programs.course_mode`, payment-create idempotency metadata, and
version/status fields to the existing `official_document_issuances` table.
The authorized payment RPCs write audit rows in the same transaction as the
payment mutation; prior versions also created `student_payment_update`
document snapshots and delivery-history rows. This does not create duplicate
payment, issuance, or notification tables.

The existing private `APPLICATION_MEDIA` R2 binding stores PDFs under
version-specific keys. Forward-only migration
`20261101000007_remove_lifecycle_automation.sql` removes claim/reconciliation
automation while preserving payment, audit, issuance, and delivery-history
records. Approval-email state is retained as read-only delivery evidence.
Migration `20261101000008_remove_fee_dependencies_from_payments.sql`
keeps payment RPCs and their audit/idempotency behavior without agreed-fee
validation. Fee configuration and agreement records are retained but no longer
available to the application. Migration
`20261101000009_remove_certificate_email_lifecycle.sql` removes certificate
email attempt/rejection-evidence history and its RPCs without touching
certificate records, events, PDFs, or storage objects. Joining instructions
remain in the existing `official_document_settings.document_data` JSON
configuration. No additional environment variables are required.

After applying `20261102000002_tracked_application_erasure.sql`, apply
`supabase/migrations/20261102000003_separate_application_and_payment_retention.sql`.
This forward-only migration adds payment identity and receipt-key snapshots,
changes payment, fee-agreement, baseline, and notification application links
to `ON DELETE SET NULL`, and replaces application erasure finalization so
financial transactions, receipts, payment audits, historical baselines, fee
agreements, payment-update issuance records, and payment-update email evidence
are preserved and detached. Admission snapshots omit financial fields, while
payment-update snapshots retain their separate payment summary.

After migration 03, apply
`supabase/migrations/20261102000004_preserve_official_documents_during_erasure.sql`.
It changes issuance references to `ON DELETE SET NULL`, preserves every
official-document issuance and PDF (including approval and payment-update
versions), and limits storage cleanup to a verified, exclusively owned
application photo that is not referenced by retained issuance snapshots.
Detached document history and original PDF downloads remain accessible to
Admins and Super Admins by application reference. The Worker fails closed
until migration 04's preservation-readiness RPC is available. Migration 04
refuses to install while an application-erasure job is incomplete; resolve
its storage cleanup through the existing retry workflow before applying it.
The existing
legal, accounting, storage-retention, and external-retention approval gate
remains required. Provider-side object versions/backups, legal holds, and
already-delivered email copies are outside the erasure guarantee.

The Admin Portal's Payments register is available to Admin and Super Admin
independently of the Student Applications list. Payment receipts can be
generated and emailed from saved transaction snapshots after an application
is erased. Staff cannot browse the independent register. Official admission
PDF generation and preview render student, course, and joining information
only; legacy payment-update PDF objects are not modified by the migration, and
their financial data is never read into newly generated official PDF bytes.
Already-delivered email copies and provider-side R2 versions/backups are outside
the erasure guarantee.

Migration `20261102000000_forward_historical_official_document_recovery.sql`
replaces the Version 1 historical recovery function with stricter audit-stream
validation for deployments where the original recovery migration has already
run. It does not update application, payment, or document records.

The timestamp type validation in
`20261031000005_payment_document_audit_recovery.sql` compares PostgreSQL's
canonical `format_type` output (`timestamp with time zone`) while accepting
the equivalent `timestamptz` catalog type on existing schemas. Its foreign-key
validation checks catalog relation, column, and delete-action identity rather
than relying on display-formatted constraint text.

### Historical Version 1 recovery

After the payment-version and payment-audit recovery migrations have been
verified, `20261031000006_historical_official_document_recovery.sql` provides
the service-role-only `create_historical_official_document_version_one(uuid)`
function. The Worker exposes it only to `super_admin` users at
`POST /api/admin/official-document/historical-recovery`.

This path is separate from approval: it operates only on an existing Accepted
application, never updates the application, payment, fee-agreement, or
notification tables, and never sends an approval email. It reconstructs
pre-approval payment state from ordered audit records, refuses incomplete or
ambiguous evidence, and uses an application/version uniqueness constraint for
idempotency. The generated recovery snapshot records that joining information
and document settings are not historically verified. The recovery PDF loads the
current configured `site_branding.logo_url` dynamically and fails visibly if
that logo is missing or invalid.

### Tracked permanent application erasure

The existing safeguard migration
`supabase/migrations/20261102000001_safe_application_deletion.sql` must remain
applied. Apply the forward-only
`supabase/migrations/20261102000002_tracked_application_erasure.sql` only
through the reviewed Supabase migration process. It verifies the current
application, payment, and official-issuance foreign-key dependency map and
stops if it finds an unreviewed relationship.

The new API allows Admin and Super Admin only. A durable job locks the
application against payment, notification, and document writes; inventories
its stored photo and application-scoped official-document/receipt keys; and
deletes only keys matching that application's approved object-key patterns.
The photo key must be valid and referenced exclusively by that application;
shared or unverifiable photo references block deletion. Shared academy assets
and other application prefixes are not included. R2 cleanup is verified before
one database transaction removes the application,
payments, payment audit and baseline, fee agreement, notifications,
approval-email state, and official-document issuance snapshots. A failed
storage or database phase remains pending and can be resumed by submitting
Delete again. The database phase rolls back completely on error.

Completed jobs retain only an opaque job ID, the acting admin profile
reference, timestamps, state, and aggregate deleted-row counts. The
application reference and object-key inventory are cleared on completion.
Neither the three previously identified test application IDs nor any other
application is deleted by applying the migration.

**Financial and tax erasure is disabled by default.** The migration creates
`public.application_erasure_policy` with `enabled = false` and the storage and
external-retention verification fields set to false; Delete returns HTTP 409
until a database owner records legal/accounting approval and verifies the
bucket's versioning, retention, and deletion behavior, plus the handling or
exclusion of backups and external copies. Before changing this policy, the
academy must obtain written advice from its accountant/legal adviser that
erasing payment, receipt, audit, and official-document evidence is permitted
for its registrations, open proceedings, and retention obligations. Do not
enable the policy merely to remove a blocked application. The Worker can verify
the currently listed R2 keys but cannot enumerate or erase provider-side
versions, legal holds, backups, copies already delivered to email recipients,
or other external copies. If those are enabled or in scope, this
implementation cannot claim complete permanent erasure and must remain
disabled.

The migration has not been applied as part of this code change. Review the
migration, schema compatibility, and retention approval before applying it;
then deploy the Worker and Admin Portal changes through the normal reviewed
release process.

## 2.5. Super-Admin About Us Management

After reviewing the schema, apply
`supabase/migrations/20261104000000_about_us_management.sql` and
`supabase/migrations/20261105000000_about_us_r2_asset_metadata.sql` to enable
About Us content management. They use the existing `admin_profiles` table,
role values, and `public.is_super_admin()` checks; they do not create another
authentication or role system.

The migrations add instructor qualifications, R2 object keys, and image content
metadata to `team_members`, and create a singleton video-configuration table
with published read access. They do not create a Supabase Storage bucket or any
`storage.objects` policies. Image bytes are uploaded to the existing private
`APPLICATION_MEDIA` Cloudflare R2 bucket through authenticated Worker
endpoints. Supabase stores the R2 object key, MIME type, and byte count only; it
does not store image bytes or Supabase Storage URLs.

The Worker verifies the bearer token against Supabase Auth and checks the user's
active `admin_profiles.role` server-side before allowing image upload, private
preview, or deletion. Deletion is refused while the object key is referenced by
any instructor or video record. Public image requests pass through the Worker,
which checks the anonymous RLS-visible records and serves an image only when it
is linked to published content. About Us images are not stored in `PUBLIC_MEDIA`
and therefore cannot be fetched directly from `media.uptrendsenglishacademy.in`.
Application documents and About Us images share the private
`APPLICATION_MEDIA` bucket but use separate object-key prefixes. No R2
credentials are included in frontend code. The existing `APPLICATION_MEDIA`
binding in `wrangler.json` points to `uptrends-academy-media`; no production
Worker binding or deployment change is required.

For the local Express server, configure the existing server-side credentials
`CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, and
`CLOUDFLARE_R2_SECRET_ACCESS_KEY`, and set
`CLOUDFLARE_R2_BUCKET_NAME=uptrends-academy-media`. The Express server maps
this bucket to `APPLICATION_MEDIA` and uses a separate
`CLOUDFLARE_R2_PUBLIC_BUCKET_NAME=uptrends-academy-public` for `PUBLIC_MEDIA`.
These variables belong only in the server environment, never in `VITE_*`
variables or browser code.

The SQL is not applied by the application code. Apply both migrations in order
only after reviewing their complete SQL. No existing records are deleted.
Then verify that a Super Admin can manage content, while Admin, Staff, and
anonymous users cannot upload, preview unpublished images, or modify About Us
records. Public visitors should see only published profiles and the published
video; without a published video configuration the page keeps its existing
default video. Older `photo_url`/`poster_url` values, if any, are left
untouched but are no longer used for managed About Us images.

---

## 3. Provisioning the Super Admin (Target UID: `59bbb687-4e0d-47f7-b458-5a91955f915d`)

The migration file automatically handles provisioning for this existing Auth UID via:
```sql
INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
SELECT
  u.id,
  COALESCE(u.email, 'uptrendsinstitute@gmail.com'),
  COALESCE(u.raw_user_meta_data->>'full_name', 'Academy Super Admin'),
  'super_admin',
  true
FROM auth.users u
WHERE u.id = '59bbb687-4e0d-47f7-b458-5a91955f915d'::uuid
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  updated_at = NOW();
```

If you ever need to manually assign or change super admin privileges for another auth user, run this in the Supabase SQL Editor:
```sql
INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
VALUES (
  'PASTE_AUTH_USER_UUID_HERE'::uuid,
  'user_email@domain.com',
  'Super Administrator Name',
  'super_admin',
  true
)
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  updated_at = NOW();
```

---

## 4. Environment Variables Required

Configure these variables in the local root `.env` file. `server.ts` loads that file for local development, and Vite exposes only `VITE_` variables to browser code:

```bash
# Supabase (the anonymous key is public; the service-role key is server-side only)
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... # Server-side only! Never expose to client.

# Resend Transactional Email (Admissions & Staff Alerts)
RESEND_API_KEY=<server-only-resend-api-key>
RESEND_FROM_EMAIL="Uptrend's English Academy <admissions@uptrendsenglishacademy.in>"
APPLICATION_NOTIFICATION_EMAIL="uptrendsinstitute@gmail.com"

# Cloudflare R2 Storage (Student Passport Photos & Media Assets)
CLOUDFLARE_R2_ACCOUNT_ID=<server-only-account-id>
CLOUDFLARE_R2_ACCESS_KEY_ID=<server-only-access-key-id>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<server-only-secret-access-key>
CLOUDFLARE_R2_BUCKET_NAME=uptrends-academy-media
CLOUDFLARE_R2_PUBLIC_URL=https://media.uptrendsenglishacademy.in

```

For Cloudflare Workers, configure `SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Worker variables and `SUPABASE_SERVICE_ROLE_KEY` as an encrypted Worker secret. Use encrypted secrets for R2 access and Resend credentials as well. `SUPABASE_URL` must point to the same Supabase project as the service-role key. The Worker accepts `VITE_SUPABASE_URL` as a backward-compatible runtime URL binding, but use `SUPABASE_URL` for new configuration. Worker runtime settings are separate from the Vite build environment: the browser requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time, while the service-role key must never enter the browser bundle. Missing client Supabase settings disable admin login with a visible configuration message; missing server credentials cause protected API requests to fail closed.

---

## 5. Verification Checklist

1. **Authentication Check:**
   - Navigate to `/admin/login`.
   - Sign in with the credentials for UID `59bbb687-4e0d-47f7-b458-5a91955f915d`.
   - Confirm successful login and redirect to the Admin Portal.
   - Check the top header: badge should display `SUPER_ADMIN`.
2. **Branding & Assets Check:**
   - In the Admin Portal, open the **Site Branding & Assets** tab.
   - Verify that `favicon_url`, `footer_logo_url`, `main_logo_alt`, and `logo_alt` fields are loaded.
   - Make an edit (e.g. update tagline or logo alt text) and click **Save Branding Configurations**.
   - Verify the database updates and returns HTTP 200.
3. **Application Approval & Official PDF Flow:**
   - Submit a test application via the student portal or locate an existing submission.
   - Open **Student Applications** in the Admin Portal and click **Review**.
   - Click **Approve**.
   - Verify that status updates to `Accepted`, official PDF attachment is verified, and transactional email is recorded in the **Email Outbox & Retries** tab.
4. **Role Permissions & RLS Check:**
   - Open **Admin Roles & Access** tab (visible only to Super Admin).
   - Test changing a team member's role between Staff, Admin, and Super Admin.
   - Confirm unauthenticated requests to `/api/admin/*` receive HTTP 401.
   - Confirm Staff cannot delete applications, Admin and Super Admin can, and only Super Admin can access role management.
