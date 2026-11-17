# Production Hardening & Vercel Deployment

FuelNerve is configured for a single Vercel project: the React app is served at `/` and the Express API is served through the same first-party `/api/*` origin. This preserves secure cookie authentication without cross-domain browser exceptions.

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
| `DATABASE_URL` | Pooled, TLS-enabled PostgreSQL connection string used by the application |
| `DIRECT_URL` | Direct, unpooled PostgreSQL connection string used by database migrations |
| `JWT_SECRET` | A new random secret of at least 48 characters |
| `APP_URL` | `https://your-production-domain` |
| `CORS_ORIGIN` | Same value as `APP_URL` |
| `GOOGLE_CLIENT_ID` | Production Google OAuth client ID |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated FuelNerve team email addresses allowed to view demo enquiries |
| `VITE_API_URL` | `/api` (or leave unset) |
| `VITE_GOOGLE_CLIENT_ID` | Production Google OAuth client ID |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp sender phone number ID |
| `WHATSAPP_API_VERSION` | The supported Meta Graph API version, for example `v27.0` |
| `WHATSAPP_TEMPLATE_NAME` | Template for the explicit test alert |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta WhatsApp Business Account owning the production sender and templates |
| `WHATSAPP_DELIVERY_ENABLED` | Operational delivery switch, defaults to `false` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code, normally `en` |
| `WHATSAPP_TEMPLATE_STYLE` | `ALERT_BODY` for the approved one-variable FuelNerve Utility template; `NO_PARAMETERS` only for the Meta `hello_world` transport test |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | A new random secret of at least 16 characters, entered identically in Meta's webhook setup |
| `WHATSAPP_APP_SECRET` | The Meta app secret used to authenticate webhook signatures |
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

After deploying the additive queue migration, configure the Cloud API sender, business account, app secret, webhook verify token and scheduler credentials in the production environment. In WhatsApp Manager, subscribe the callback at `/api/notifications/whatsapp/webhook` to the `messages` field. Confirm that the dedicated system user can send messages and read the account's template statuses. Configure billing with Meta for business-initiated delivery.

Keep `WHATSAPP_DELIVERY_ENABLED=false` until the sender, signed delivery-status webhook and all five English utility templates have been verified. The worker checks each template's approval before dispatch. Jobs awaiting approval or reactivation remain queued and expire after 24 hours. The separate test template may use Meta's `hello_world`, `en_US` and `WHATSAPP_TEMPLATE_STYLE=NO_PARAMETERS` on test infrastructure.

Run these server-side requests with `Authorization: Bearer <CRON_SECRET>`. Use the existing deployment scheduler or another authenticated scheduler. Keep the production delivery worker paused until launch checks are complete.

- `GET /api/notifications/cron/agent-messages` queues owner messages from verified station events.
- `GET /api/notifications/cron/daily` queues the one Core daily report and the Intelligence owner credit report when applicable.
- `GET /api/notifications/cron/whatsapp-delivery` drains a bounded batch. Schedule it every minute for the pilot.

Growth Desk shows recent attempts and suppression reasons. Accepted means Meta acknowledged the request. Delivered and Read require signed Meta webhooks. A timeout, ambiguous provider response or worker interruption after dispatch stays visible as an unconfirmed outcome. A matching signed callback can reconcile it. Automatic retries cover pre-dispatch checks and explicit rate-limit rejections. One administrator retry is available for recent jobs with known non-acceptance. The worker revalidates plan, recipient, consent, preferences and source evidence for each attempt.

### Owner utility templates

All five were submitted for review on the Fuel Nerve WhatsApp Business Account and were still in review when checked on 17 November 2026. Each uses one numbered body variable. Examples submitted to Meta use fictional records.

| Template | Body |
| --- | --- |
| `fuelnerve_stock_level_v1` | FuelNerve stock alert for your fuel station. A tank has reached its configured reorder threshold. {{1}} Review the tank record in FuelNerve to confirm whether a delivery is needed. |
| `fuelnerve_shift_closed_v1` | FuelNerve shift closure report for your fuel station. The shift has been closed and its sales, collections and closing tank stock have been recorded. {{1}} Review the shift reconciliation in FuelNerve for the original readings. |
| `fuelnerve_purchase_receipt_v1` | FuelNerve purchase receipt for your fuel station. A supplier delivery has been recorded against a purchase invoice. {{1}} Review the purchase invoice in FuelNerve for receipt and payment details. |
| `fuelnerve_owner_credit_v1` | FuelNerve customer credit report for your fuel station. The following customer balances are outstanding as of this report. {{1}} Review customer accounts in FuelNerve before following up. |
| `fuelnerve_daily_operations_v1` | FuelNerve daily operations report for your fuel station. This is the daily summary of recorded fuel sales, collections and tank stock. {{1}} Review the station dashboard in FuelNerve for the underlying records. |

The Credit Agent also prepares customer-facing reminder drafts for owner review. See Customer WhatsApp reminders for the separate template and consent flow.

[Meta template management](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/) · [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)

## Station agent job processing

Agent reviews use a separate scheduled request. After the additive `nerve_review_jobs` migration and API deployment, configure a server-side scheduler to send `GET /api/notifications/cron/agent-reviews` every minute with `Authorization: Bearer <CRON_SECRET>`. The endpoint schedules one review per agent, station and Indian business day and processes a bounded batch of queued work. Watch queue age and terminal failures during the pilot, and adjust polling or worker concurrency to match volume. Stopping the schedule pauses processing while transaction events continue to be recorded.

Inspect `nerve_review_jobs` for pending work, expired leases and terminal failures. A healthy response reports counts for queued, completed, retried, failed and skipped reviews. A completed job contains the verified findings and the runtime audit for the successful attempt. Reviews are read-only and the worker has no WhatsApp delivery call.

The agent-messages worker handles reconciled shifts, posted receipts and stock changes. Agent jobs created before the migration are excluded from WhatsApp delivery.

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

## Customer WhatsApp reminders

Owners manage notification preferences under **WhatsApp alerts**. Growth Desk provides activation, test messages and delivery troubleshooting. Core sends the daily operating summary. Core + Intelligence supports operational alerts, the scheduled owner credit report and customer reminders.

Customer reminders start with **Preview reminder** and **Approve and queue reminder** in the customer profile. Scheduled sending is off until the owner saves an enabled schedule. The daily cron must run during the selected Indian Standard Time hour. Consent is associated with the saved WhatsApp number and records when, how and by whom it was captured. A new number needs separate consent.

The delivery worker checks the approved balance and destination against the current ledger, including cross-station payments. A dispute, paused customer, revoked consent, changed scheduled policy or recent delivery can stop dispatch. An unresolved delivery blocks additional reminders for the customer.

The English utility template `fuelnerve_customer_payment_reminder_v1` was submitted for Meta review in the production Fuel Nerve WhatsApp Business Account. It uses one numbered body variable.

> Payment reminder for your fuel account. Our records show an overdue balance. {{1}} If you have already paid or believe the balance is incorrect, please contact your fuel station.

Example variable: Sample Fuel Station · Demo Fleet · ₹4,250.00 overdue as of 2026-11-17 · Earliest unpaid due date 2026-11-10.

Verify Meta approval and the signed delivery webhook before enabling production dispatch. Start with an owner-reviewed test to an opted-in test recipient. Use Growth Desk to confirm the delivery result before enabling any customer schedule.

## Owner welcome on WhatsApp

Create the English Utility template `fuelnerve_owner_welcome_v1` in WhatsApp Manager. Use numbered body variables with example values `Nanda` and `My Petrol Pump`. Keep the formatting and wording below, and add one fixed **Visit website** button labeled **Open FuelNerve** with URL `https://fuel.mindvector.tech/`.

```text
*Welcome to FuelNerve, {{1}}!*

Your account for *{{2}}* is ready. Open FuelNerve to review your fuel station setup and get started with shifts, sales, and tank stock.

To choose which updates you receive here, go to *Settings → WhatsApp alerts*.
```

The first saved WhatsApp opt-in on a newly created organization queues one welcome. The sender uses the owner's first name and the oldest active fuel station, with the organization name as a fallback. Existing organizations are excluded from automatic welcomes.

To verify the same template on an existing opted-in test account, select **Prepare welcome preview** on its Growth Desk card. Keep **Internal test** scoped to that account with **Owner welcome** as the only enabled category. Generate previews while paused, review and approve the intended welcome, then unpause to dispatch. The worker verifies the approved Meta template, its button, and the saved recipient. Confirm delivery and pause again after testing.

## Controlled WhatsApp rollout

Deploy the additive migrations with **Shadow** selected as the initial database policy. The independent deployment switch `WHATSAPP_DELIVERY_ENABLED` defaults to `false` and applies to transport tests as well. Shadow previews can be generated with this switch off. Once live account setup is verified, set the deployment switch to `true` and keep the database policy paused until the intended stage and category are selected.

In **Settings → Growth Desk → WhatsApp rollout**, use **Generate previews** to run a bounded review batch without contacting Meta. Open **WhatsApp alerts** on the appropriate account, compare the preview and recipient with the shift reconciliation, physical receipt, tank stock, daily totals or credit ledger, then select **Approve preview**. Review event-date, station and currency amounts in addition to the text. The worker binds approval to the sender, recipient, template and current contents. A changed calculation requires a new approval.

1. **Internal test** permits one opted-in owner account. Start with one operational category and one reviewed preview. Use **Process approved messages** or the authenticated delivery worker. Compare the actual handset message with the approved preview and confirm a signed **Delivered** or **Read** update. Meta acceptance alone does not advance the rollout.
2. **Owner pilot** permits up to five explicitly selected opted-in accounts after the internal delivery check. Keep customer reminders off. Review rejected, uncertain, delayed and suppressed jobs in Growth Desk while comparing received messages with their evidence.
3. Turn on **Customer reminders** separately after a pilot owner delivery is verified. Start with owner-reviewed recipients. Continue using both recipient consent and a final ledger check. Verify that a payment or dispute changes or withdraws the preview before it can send.
4. **Expanded delivery** keeps explicit account enrollment and per-message preview approval. Expand in small batches and check the previous 24 hours of outcomes before adding the next group.

**Pause all WhatsApp** blocks new dispatch claims immediately without redeploying. Uncheck an individual delivery category to pause just that category. In-flight messages can still complete and authenticated delivery callbacks continue updating history. Agent events, proposed messages, drafts and approval history are preserved. Keep the rollout-enabled release in place when pausing. Redeploying a version from before the rollout controls can bypass this database switch.
