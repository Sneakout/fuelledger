# FuelNerve owner email alerts

Sender: **FuelNerve <hello@mindvector.tech>**. Replies go to hello@mindvector.tech, through the existing Cloudflare → Gmail receiving route. The app sends directly through SMTP2GO's HTTP API; Gmail does not relay application messages.

## Messages and preferences

Owners enable email independently of WhatsApp in **Settings → Email & WhatsApp alerts**. The destination is the active owner's sign-in email; users cannot enter another person's destination. Enabling email prepares one welcome message per owner and address. It never sends passwords.

Core receives the daily operating summary (litres, collections and stock). Active Intelligence subscribers receive low stock, reconciled shift summaries, receipt summaries and customer credit reports. The existing agent events, calculations, categories and schedules supply the same verified facts as WhatsApp. Customer payment reminders remain WhatsApp-only: customer email consent and destinations have not been collected.

Each email includes forest-green/lime FuelNerve branding, a plain-text alternative, station/date, the verified figures and a direct link to supporting records. It contains no external tracking images. The footer links to preferences.

## Deployment checklist

1. Apply the additive `20261120090000_owner_email_alerts` migration and deploy API/web together. Existing owners remain opted out. No stock, sales or accounting records change.
2. In SMTP2GO, authorise `mindvector.tech` as a sender domain, install the DNS records shown by SMTP2GO and verify them. Preserve the existing Cloudflare mail-routing records. Do not invent or duplicate SPF records; use the provider's exact DNS instructions.
3. Create an SMTP2GO API key with email-sending permission. Save it privately as server-only `SMTP2GO_API_KEY` in the deployment environment. Do not paste it into chat, source code or browser settings.
4. Set `EMAIL_FROM=hello@mindvector.tech`, initially `EMAIL_DELIVERY_ENABLED=false`, and `EMAIL_ROLLOUT_ORGANIZATION_IDS=<internal test organization ID>`. All are server-only variables. Redeploy after configuration changes.
5. Configure the existing authenticated scheduler:
   - `/api/notifications/cron/agent-messages`: existing event processing.
   - `/api/notifications/cron/daily`: existing daily/credit schedule; run hourly at the configured hour.
   - `/api/notifications/cron/email-delivery`: every minute, `Authorization: Bearer <CRON_SECRET>`. Four jobs maximum per request, with a 15-second timeout per send.
6. In the internal owner account, enable email. In Growth Desk, open that owner → **Owner email updates** → refresh and preview the welcome email. Check the real name, address and content.
7. Set `EMAIL_DELIVERY_ENABLED=true`, redeploy, then use **Send this email** for the internal welcome. Confirm arrival in the actual inbox and check SMTP2GO activity. Only then expand the allowlist to opted-in owners.

The UI does not expose provider diagnostics to owners. Admins can inspect the selected owner's latest ten emails in Growth Desk. `ACCEPTED` means SMTP2GO accepted the request, not proof of inbox delivery. Delivery/bounce tracking currently remains in SMTP2GO; no unverified webhook claims are stored in FuelNerve.

## Recovery and pause

- Unique database identity includes organization, station, event, category, owner and destination. Duplicate events do not create duplicate jobs.
- Each worker claims a pending job atomically. Parallel workers cannot send the same claimed job.
- Consent, current recipient, active fuel station, current plan and source facts are rechecked before sending. Stale/changed records are suppressed with a reason. Messages expire after 24 hours.
- HTTP 429 rejections retry at bounded delays, up to four attempts. Explicit 4xx rejections are `FAILED`; after fixing configuration an administrator can select **Retry rejected email**. The existing job is reused and all eligibility checks run again.
- Timeouts, 5xx, malformed success responses and expired processing leases are `UNKNOWN`. They never retry automatically because an email may have been accepted. Check SMTP2GO using the `X-FuelNerve-Delivery` reference, recipient and time. Keep uncertain messages held; do not create a replacement simply to retry.
- Pause all application email with `EMAIL_DELIVERY_ENABLED=false` and redeploy, or remove an organization from the allowlist. Jobs and evidence remain intact. Owner opt-out and category changes suppress pending work immediately on the next processing pass.
- SMTP2GO delivery webhooks, automatic bounce suppression and a global paginated email operations inbox are future extensions; check provider activity during this limited pilot.

Official provider reference: https://developers.smtp2go.com/docs/send-an-email
