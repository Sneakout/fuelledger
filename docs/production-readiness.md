# Production Hardening & Vercel Deployment

FuelLedger is configured for a single Vercel project: the React app is served at `/` and the Express API is served through the same first-party `/api/*` origin. This preserves secure cookie authentication without cross-domain browser exceptions.

## Required production services

- Vercel project in the Singapore region (`sin1`). The Hobby plan is suitable for the initial pilot; Vercel Pro is required before enabling frequent scheduled WhatsApp alerts.
- Managed PostgreSQL located near Singapore, with TLS, connection pooling, daily backups and point-in-time recovery. Neon, Supabase, or AWS Aurora are suitable choices.
- Private object storage for production attachments before accepting significant document volumes. Database-backed attachments remain capped at 500 KB and are suitable only for the initial pilot.
- Error alerting and uptime monitoring configured against `/api/health`.

## Vercel configuration

Import `Sneakout/fuelledger` as one Vercel project with the repository root as the Root Directory. `vercel.json` builds the Vite app, routes `/api/*` to the Express Function and runs in Singapore.

Set the following **Production** environment variables in the Vercel dashboard. Do not add them to Git.

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Pooled, TLS-enabled PostgreSQL connection string |
| `JWT_SECRET` | A new random secret of at least 48 characters |
| `APP_URL` | `https://your-production-domain` |
| `CORS_ORIGIN` | Same value as `APP_URL` |
| `GOOGLE_CLIENT_ID` | Production Google OAuth client ID |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated FuelLedger team email addresses allowed to view demo enquiries |
| `VITE_API_URL` | `/api` (or leave unset) |
| `VITE_GOOGLE_CLIENT_ID` | Production Google OAuth client ID |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp sender phone number ID |
| `WHATSAPP_API_VERSION` | The supported Meta Graph API version, for example `v23.0` |
| `WHATSAPP_TEMPLATE_NAME` | Approved WhatsApp template name, for example `fuelledger_alert` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code, normally `en` |
| `CRON_SECRET` | New random secret of at least 16 characters, used only by Vercel's scheduled alert call |

Add the production domain to Google OAuth's Authorized JavaScript Origins. Use a separate database and separate secrets for Preview deployments; previews must not point to the customer database.

## Release sequence

1. Create a managed PostgreSQL production database with point-in-time recovery and a pooled application URL.
2. Save a verified encrypted backup and test restoring it into a separate database.
3. In a protected release terminal, run `corepack pnpm db:deploy` once against the production database. Never run development or demo seeds in production; both are blocked by the application.
4. Configure production Vercel environment variables, then deploy `main`.
5. Confirm `https://your-domain/api/health` returns `{ "status": "ok", "database": "connected" }`.
6. Run the smoke checklist below with a non-demo owner account and a manager assigned to one petrol pump.
7. Enable uptime alerts and a database backup-failure alert before onboarding the first paid customer.

## WhatsApp owner alerts

FuelLedger can alert an opted-in owner about missing morning density readings, low tank stock, cash variances, open shifts, the daily summary and overdue customer payments. The app records each delivery attempt, so the owner can see whether an alert was sent or failed.

1. In Meta Business Manager, connect the sending WhatsApp number and create an approved utility template named `fuelledger_alert` with one body variable: `{{1}}`. The application sends the complete alert as that variable.
2. Add the WhatsApp and `CRON_SECRET` variables above to Vercel's **Production** environment, then redeploy.
3. After taking a verified production database backup, run `corepack pnpm db:deploy` once from a protected release terminal using the production `DATABASE_URL`.
4. Sign in as the owner, open **WhatsApp alerts**, enter the owner's number with country code, confirm consent, choose alert types and use **Send test alert**.

The initial Hobby-compatible deployment supports saving alert preferences and sending a manual test alert. Before enabling automated alerts, upgrade to Vercel Pro and restore the hourly scheduled check. Alert rules use India time (`Asia/Kolkata`): density is checked at 9:00 AM, open shifts at 11:00 PM, and the daily summary at the hour selected by the owner. Scheduled functions are protected with `CRON_SECRET`; never expose this value in the web app.

## Smoke checklist

- Owner can sign in, create a petrol pump and assign a manager.
- Manager can sign in, change the temporary password and sees only the assigned petrol pump.
- Manager cannot access another petrol pump by changing a request or URL.
- Shift opening, sale, shift close, reconciliation and report values match.
- Logout invalidates the active session; the old cookie cannot call the API.
- Wrong origin cannot make an unsafe API request.
- An invoice or expense attachment opens through the production `/api` path.
- Database health, logs and monitoring alert channel are working.

## Security controls included

- HTTP-only, Secure, SameSite=Strict production cookies with a `__Host-` prefix.
- Database-backed, revocable eight-hour sessions; logout invalidates the session server-side.
- Login throttling, global request throttling, origin checks for unsafe requests, Helmet and CSP headers.
- Password hashing, server-side validation, role and petrol-pump authorization, audit-preserving operational records, and structured request logging with credential redaction.

## Remaining operational requirements

Before broad rollout, provision private object storage for attachments, set database backup retention with point-in-time recovery, test restores at least monthly, configure error tracking, publish Privacy Policy/Terms/Refund and Cancellation/Data Retention policies, and complete a payment gateway/subscription enforcement milestone.
