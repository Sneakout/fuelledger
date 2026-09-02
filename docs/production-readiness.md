# Production Hardening & Vercel Deployment

FuelLedger is configured for a single Vercel project: the React app is served at `/` and the Express API is served through the same first-party `/api/*` origin. This preserves secure cookie authentication without cross-domain browser exceptions.

## Required production services

- Vercel **Pro** project in the Singapore region (`sin1`), not the Hobby plan.
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
| `VITE_API_URL` | `/api` (or leave unset) |
| `VITE_GOOGLE_CLIENT_ID` | Production Google OAuth client ID |

Add the production domain to Google OAuth's Authorized JavaScript Origins. Use a separate database and separate secrets for Preview deployments; previews must not point to the customer database.

## Release sequence

1. Create a managed PostgreSQL production database with point-in-time recovery and a pooled application URL.
2. Save a verified encrypted backup and test restoring it into a separate database.
3. In a protected release terminal, run `corepack pnpm db:deploy` once against the production database. Never run development or demo seeds in production; both are blocked by the application.
4. Configure production Vercel environment variables, then deploy `main`.
5. Confirm `https://your-domain/api/health` returns `{ "status": "ok", "database": "connected" }`.
6. Run the smoke checklist below with a non-demo owner account and a manager assigned to one petrol pump.
7. Enable uptime alerts and a database backup-failure alert before onboarding the first paid customer.

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
