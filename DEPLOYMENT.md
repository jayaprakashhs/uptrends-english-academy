# Production Deployment & Setup Guide — Uptrend's English Academy

This guide provides the complete, step-by-step instructions for deploying and configuring **Uptrend’s English Academy** (Davangere, Karnataka).

---

## 1. Supabase PostgreSQL & Auth Setup
1. Create a new project in [Supabase](https://supabase.com/).
2. In the Supabase dashboard, navigate to **SQL Editor**.
3. Run the schema migration:
   - Copy contents of `supabase/migrations/20261024000000_create_uptrends_schema.sql` and click **Run**.
4. Run the seed data migration:
   - Copy contents of `supabase/migrations/20261024000001_seed_initial_data.sql` and click **Run**.
5. Copy your credentials from **Project Settings -> API**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (Keep server-side only; never expose to browser).

---

## 2. Super Admin Account Provisioning
In accordance with security rules, public admin registration is disabled. To provision the initial Super Admin:
1. In Supabase Dashboard, open **Authentication -> Users** and click **Add User -> Create User**.
2. Enter email (e.g. `uptrendsinstitute@gmail.com`) and choose a secure password.
3. Copy the newly generated **User UID** (UUID).
4. Run this query in **SQL Editor**:
   ```sql
   INSERT INTO admin_profiles (id, email, full_name, role, is_active)
   VALUES (
     'YOUR_COPIED_USER_UID',
     'uptrendsinstitute@gmail.com',
     'Academy Director',
     'super_admin',
     true
   )
   ON CONFLICT (id) DO UPDATE SET role = 'super_admin', is_active = true;
   ```
5. You can now log into `/admin` with these credentials.

---

## 3. Cloudflare R2 Object Storage Setup
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/) and go to **R2**.
2. Create `uptrends-academy-media` for private student application photos and `uptrends-academy-public` for public gallery media. Do not enable a public domain on the application-photo bucket.
3. For local Express development only, under **Manage R2 API Tokens**, create a token with **Object Read & Write** permissions and copy the following credentials into `.env`:
   - `CLOUDFLARE_R2_ACCOUNT_ID`
   - `CLOUDFLARE_R2_ACCESS_KEY_ID`
   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
   - `CLOUDFLARE_R2_BUCKET_NAME`
   - `CLOUDFLARE_R2_PUBLIC_URL`
4. The Cloudflare Worker uses native R2 bucket bindings instead of these S3 API credentials. The local Express server remains separate and continues to use its configured S3-compatible bucket.
5. Student passport photographs are client-side compressed to ≤ 300 KB and stored in the private application-photo bucket.

For production Worker configuration, use the exact Production binding names and types in Section 8.

---

## 4. Resend Transactional Email Setup
1. Sign up at [Resend](https://resend.com/) and navigate to **API Keys**.
2. Generate an API key and set `RESEND_API_KEY`.
3. In **Domains**, add your verified domain (e.g., `uptrendsacademy.com`) and configure DNS records (SPF, DKIM, DMARC).
4. Set the verified sender in `.env`:
   - `RESEND_FROM_EMAIL="admissions@uptrendsacademy.com"`
5. Set the academy alert recipient:
   - `APPLICATION_NOTIFICATION_EMAIL="uptrendsinstitute@gmail.com"`

---

## 5. Student Approval PDF
When an authorized staff member approves an application, the Worker generates
the official admission approval PDF from the saved application snapshot and
attaches it to the student approval email. The approval PDF contains student,
course, and joining information; payment receipts remain a separate workflow.

---

## 6. Environment Variables Checklist
```env
# Server & Site URL
PORT=3000
VITE_SITE_URL="https://your-domain.com"

# Supabase
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1..."
SUPABASE_SERVICE_ROLE_KEY="<new Supabase sb_secret_... key>"

# Cloudflare R2
CLOUDFLARE_R2_ACCOUNT_ID="your_account_id"
CLOUDFLARE_R2_ACCESS_KEY_ID="your_access_key"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your_secret_key"
CLOUDFLARE_R2_BUCKET_NAME="uptrends-academy-media"
CLOUDFLARE_R2_PUBLIC_URL="https://media.uptrendsacademy.com"

# Resend
RESEND_API_KEY="re_1234567890abcdef"
RESEND_FROM_EMAIL="admissions@uptrendsacademy.com"
APPLICATION_NOTIFICATION_EMAIL="uptrendsinstitute@gmail.com"

```

---

## 7. Running Locally & Production Build
```bash
# Install dependencies
npm install

# Run full-stack dev server (Vite + Express)
npm run dev

# Lint code for TypeScript correctness
npm run lint

# Build the Worker and client assets for production
npm run build

# Start the local Express server
npm run start
```

---

## 8. Cloudflare Worker API Migration & Safe Testing

The Cloudflare Worker API is implemented in `worker-api.ts`; `worker.ts` handles API dispatch and static assets. For local development, put Worker runtime values in the untracked root `.dev.vars` file. Both the local Express server and Wrangler local runtime read `RESEND_API_KEY` from this file; `server.ts` also loads `.env`. The Vite client configuration reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.dev.vars` as fallbacks for public browser configuration. It never defines service-role or other secret values for frontend code. The Cloudflare Vite plugin may stage Worker bindings in its generated output for local preview; the build removes that generated `.dev.vars` file after bundling. Never put `SUPABASE_SERVICE_ROLE_KEY`, R2 credentials, or Resend credentials in any `VITE_*` variable, and do not commit local env files or log secret values.

```env
SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="<new Supabase sb_secret_... key>"
CLOUDFLARE_R2_PUBLIC_URL="https://media.example.com"
RESEND_API_KEY=re_your_actual_api_key
RESEND_FROM_EMAIL="admissions@example.com"
APPLICATION_NOTIFICATION_EMAIL="test-inbox@example.com"
```

`RESEND_API_KEY` is the exact server-side binding name used for sending and health checks. Add the real Resend key only to `.dev.vars` locally; do not put it in a `VITE_*` variable or client build configuration.

Start Wrangler locally with `npx wrangler dev --local --port 8787`. First verify non-mutating requests: public GET endpoints return JSON arrays/objects from Supabase, `GET /api/apply` returns `405` with `Allow: POST`, and an admin GET without a bearer token returns `401` when server credentials are configured. With no credentials, database-dependent endpoints should return JSON `503`, not sample data.

`GET /api/system-status` performs non-mutating health checks: a one-row Supabase read, Resend domain API request, and native R2 binding checks for both buckets. It returns only configured/connected flags and safe error categories, never credentials or raw service errors. Resend domain health requires permission to read domain status.

The Worker runtime bindings are declared in the root `wrangler.json` and are the same names and buckets expected by the code:

| Binding | Cloudflare type | Bucket |
| --- | --- | --- |
| `APPLICATION_MEDIA` | R2 bucket binding | `uptrends-academy-media` (private application photos) |
| `PUBLIC_MEDIA` | R2 bucket binding | `uptrends-academy-public` (public gallery media) |

Keep the application-photo bucket private. Only the public gallery bucket should be served through the public URL. `CLOUDFLARE_R2_PUBLIC_URL` is a text variable for the public gallery bucket and is not used to construct public application-photo URLs.

For the Cloudflare Worker Production environment, add text variables and secrets in **Cloudflare Dashboard → Workers & Pages → `uptrends-english-academy` → Settings → Variables and Secrets → Production**. This must be the same Worker named by the root `wrangler.json`. Use these exact names and types:

| Binding | Cloudflare type | Required by |
| --- | --- | --- |
| `SUPABASE_URL` | Text variable (HTTPS Supabase project URL) | Supabase public/admin APIs and health check |
| `VITE_SUPABASE_URL` | Text variable (fallback only if `SUPABASE_URL` is absent) | Supabase URL fallback |
| `VITE_SUPABASE_ANON_KEY` | Text variable (publishable/anon key) | Public Supabase API routes |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret (server-side only) | Admin/server Supabase APIs and Supabase health check |
| `RESEND_API_KEY` | Secret | Resend email sending and health check |
| `RESEND_FROM_EMAIL` | Text variable (optional; code has a default sender) | Resend email sender |
| `CLOUDFLARE_R2_PUBLIC_URL` | Text variable (HTTPS URL) | Required for serving public gallery uploads |

If `RESEND_API_KEY` is missing or needs replacement, configure it as an encrypted Production secret without changing other bindings:

```powershell
npx wrangler secret put RESEND_API_KEY --config wrangler.json
```

Wrangler prompts for the value; enter the key there rather than putting it in a command, shell history, or config file. The health endpoint performs a read-only `GET /domains` request: `missing_configuration` means the binding is absent/blank, while `authentication_failed` means Resend rejected the configured key. Verify Production at `/api/system-status` after configuring it; a successful command alone does not prove that the correct Worker/environment is being served.

The Worker uses native R2 bindings and does not require R2 API tokens, account ID, or S3 access credentials. The local Express server remains a separate S3-compatible R2 client and continues to read its credential variables from `.env`. `ASSETS` is a separate static-assets binding generated from `wrangler.json`.

Separately make `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` available to the machine/CI job running `npm run deploy`, because Vite embeds these public values into the client bundle at build time. These build-time values do not become Worker runtime bindings. Do not put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_*` variable, frontend `.env` file, or client build configuration. The Worker accepts `SUPABASE_URL` as its server-side project URL; `VITE_SUPABASE_URL` remains a backward-compatible Worker URL binding, but configure `SUPABASE_URL` going forward. `wrangler.json` declares the `ASSETS`, `APPLICATION_MEDIA`, and `PUBLIC_MEDIA` bindings. API calls are same-origin only; cross-origin requests are rejected and no wildcard CORS policy is enabled.

For production `503` responses from Supabase-backed Worker routes, verify the bindings in the Worker's **Production** environment (not only Preview, local `.dev.vars`, or the frontend build environment):

- `SUPABASE_URL` must be the HTTPS URL for the Supabase project.
- `VITE_SUPABASE_ANON_KEY` must be a Worker variable for public data routes.
- `SUPABASE_SERVICE_ROLE_KEY` must be an encrypted Worker secret for admin and server-side operations.

Public routes fail closed with JSON `503` if the URL or public key is missing or the Supabase client cannot be initialized. Admin routes fail closed with JSON `503` if the URL or service-role key is missing or the client cannot be initialized. The Worker emits safe `api_diagnostic` log entries with an operation, error category, and (for missing configuration) binding name only. It never logs binding values. After changing Production bindings, deploy the Worker and verify `/api/system-status`, `/api/programs`, and an admin API request with a valid admin session. Do not treat a successful Worker deployment as proof that runtime bindings are present.

The source Worker entry is `worker.ts`. Root `wrangler.json` is the Vite plugin's source configuration: its Worker name is `uptrends-english-academy`, and `keep_vars: true` preserves dashboard-configured text variables when Wrangler deploys without declaring them in the config. Vite builds the deployable bundle and generates `dist/uptrends_english_academy/wrangler.json`, whose `main` is the compiled Worker and whose assets directory points at `dist/client`. After review and configuration, `npm run deploy` builds first and deploys using that generated config. Do not deploy using the root `wrangler.json` directly; it is not the final bundle/assets layout. If using Cloudflare's Git integration, verify its build command runs the same production build/deploy process against this generated config and that its target is `uptrends-english-academy` Production, not a Preview environment or another Worker.

The backend reads `SUPABASE_SERVICE_ROLE_KEY` in `server.ts` (local Express) and `worker-api.ts` (Worker API, with the binding declared in `worker.ts`). The current Supabase client accepts the key as a string, so a supported `sb_secret_...` key can replace the legacy service-role JWT under the same environment variable name; no database policy or schema change is needed. Rotate safely: create the new Supabase secret key, configure it in local `.dev.vars`/`.env` and as the Production Worker secret (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler.json`), then verify the Supabase health check and representative admin operations in each environment. Keep the old key active until all dependent services have passed verification; only then revoke it in Supabase. Never paste either key into chat, source code, or build-time `VITE_*` variables.

Use a staging Supabase project, a dedicated test R2 bucket, and a Resend test/verified recipient for mutation checks. Submit one test application and callback; verify their database records and notification/email outcomes. For gallery testing, create a small JPEG/PNG/WebP photo, verify its `media_items.r2_object_key` and `media_url`, then delete it and verify both the row and R2 object are removed. Also create/edit a YouTube entry with a valid URL and reject an invalid URL. These actions create records, upload files, and can send email; do not run them against production as smoke tests.

Review CRUD is implemented in the Worker and the existing Reviews tab: staff can list, create, edit, publish/unpublish, and delete reviews using the schema's `author_name`, `rating`, `review_text`, `source`, and `is_published` fields. The original Express backend had no review mutation handlers; this added surface follows the existing reviews table and staff RLS policy.
