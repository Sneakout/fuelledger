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
5. Configure the email-only GitHub Actions scheduler described below. It calls three bounded email endpoints with `EMAIL_CRON_SECRET`, without starting WhatsApp delivery. Four emails maximum per delivery request, with a 15-second timeout per send.
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

## Automatic email pilot (20 November 2026)

The email worker is independent of WhatsApp. Do **not** schedule the general `/cron/daily`, `/cron/agent-messages` or WhatsApp delivery endpoints for the email pilot. Use these email-only endpoints, in order:

1. `GET /api/notifications/cron/email-schedule` prepares today's daily operating report for both paid plans, plus the credit report for active Intelligence subscribers. It checks India business time, owner settings and individual email consent. A delayed run catches up after the selected hour within the same day; it does not replay yesterday's summary. Stable organization/category/date identities prevent duplicate reports.
2. `GET /api/notifications/cron/email-agent-messages` prepares stock, reconciled-shift and receipt messages through the existing agent fact builders. Its progress is stored separately from WhatsApp's progress. The additive migration marks pre-rollout agent jobs handled **for email only**; old receipts and historical records are not replayed as live events. New events older than 24 hours are skipped. No WhatsApp jobs or push notifications are created by this endpoint.
3. `GET /api/notifications/cron/email-delivery` drains up to four eligible pending emails with the existing atomic claims, current-fact checks, suppression reasons and ambiguous-outcome holds.

All three require `Authorization: Bearer <EMAIL_CRON_SECRET>`. This is a separate random secret of at least 32 characters, **not** `SMTP2GO_API_KEY` or the general `CRON_SECRET`. The email scheduler credential cannot invoke the general WhatsApp cron endpoints. Do not put it in a URL, source code or logs.

### GitHub Actions setup

`.github/workflows/owner-email-alerts.yml` runs at minutes 2, 7, 12, …, 57. GitHub schedules are best-effort and can be delayed or missed; this is a small pilot, not a time-critical guarantee. Scheduled workflows run from the default branch. Public repositories can have schedules disabled after inactivity; monitor Actions and workflow failure notifications. Private repositories consume runner minutes: check the repository's included allowance and spending limit before expanding usage. Disable the workflow if its running cost or delay is unsuitable.

- Save `EMAIL_CRON_SECRET` privately in **Vercel Production** and as a **GitHub Actions repository secret** of the same name. GitHub receives only this limited worker credential; no SMTP2GO or database keys are needed there.
- Apply `20261120190000_email_agent_dispatch` and deploy the API before enabling the workflow. Existing stock, sales, payments and WhatsApp dispatch progress are unchanged.
- Keep `EMAIL_ROLLOUT_ORGANIZATION_IDS` limited to the admin test organization and `EMAIL_DELIVERY_ENABLED=true` while testing. Individual consent and category settings are always rechecked.
- Set the repository Actions variable `OWNER_EMAIL_AUTOMATION_ENABLED=true` only after deployment checks. It defaults to off when absent.
- Run **Actions → Owner email alerts → Run workflow** once. Confirm all three stages succeed. Logs contain counts only; they do not contain recipients or email bodies. Verify actual SMTP2GO delivery, then observe a scheduled run. A failed stage makes the run fail visibly while allowing the other stages to finish. There is no immediate blind network retry.
- The workflow has no checkout or third-party action, no repository token permissions, a seven-minute timeout, and a concurrency group that prevents overlapping runs from cancelling an in-flight send.
- Pause immediately by setting `OWNER_EMAIL_AUTOMATION_ENABLED=false`, disabling the workflow, or setting `EMAIL_DELIVERY_ENABLED=false` in Vercel and redeploying. Owner opt-out also blocks a queued job at its next delivery check. Queues and audit history remain intact.

### Template review

Run `corepack pnpm exec tsx scripts/preview-owner-emails.ts` to produce six synthetic HTML previews in `/tmp/fuelnerve-email-previews`. Review desktop and mobile widths. Templates use email-compatible presentation tables, inline styles, forest-green and lime branding, exact verified values, readable dates, category-specific review guidance, safe record links, and a plain-text alternative. Shortages, excesses, partial receipts and unpaid amounts receive an attention treatment. They distinguish measured and book stock, collections and credit, and invoice totals and payments. The template never calculates balances or silently rounds source figures.
