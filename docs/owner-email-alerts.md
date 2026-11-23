# FuelNerve owner email alerts

Sender: **FuelNerve <hello@mindvector.tech>**. Replies go to hello@mindvector.tech, through the existing Cloudflare → Gmail receiving route. The app sends directly through SMTP2GO's HTTP API; Gmail does not relay application messages.

## Messages and preferences

Owners enable email independently of WhatsApp in **Settings → Email & WhatsApp alerts**. The destination is the active owner's sign-in email; users cannot enter another person's destination. Enabling email only saves consent. An administrator prepares, previews and explicitly sends the welcome from Growth Desk. The automatic worker never sends welcome messages. Business emails are queued and sent only after an accepted welcome exists for that exact organization, owner and destination address; a changed address requires a new welcome. Failed or uncertain welcomes do not activate automation. It never sends passwords.

Core receives the daily operating summary (litres, collections and stock). Active Intelligence subscribers receive low stock, reconciled shift summaries, receipt summaries and customer credit reports. The existing agent events, calculations, categories and schedules supply the same verified facts as WhatsApp. Customer payment reminders remain WhatsApp-only: customer email consent and destinations have not been collected.

Each email includes forest-green/lime FuelNerve branding, a plain-text alternative, station/date, the verified figures and a direct link to supporting records. It contains no external tracking images. The footer links to preferences.

## Deployment checklist

1. Apply the additive `20261120090000_owner_email_alerts` migration and deploy API/web together. Existing owners remain opted out. No stock, sales or accounting records change.
2. In SMTP2GO, authorise `mindvector.tech` as a sender domain, install the DNS records shown by SMTP2GO and verify them. Preserve the existing Cloudflare mail-routing records. Do not invent or duplicate SPF records; use the provider's exact DNS instructions.
3. Create an SMTP2GO API key with email-sending permission. Save it privately as server-only `SMTP2GO_API_KEY` in the deployment environment. Do not paste it into chat, source code or browser settings.
4. Set `EMAIL_FROM=hello@mindvector.tech`, initially `EMAIL_DELIVERY_ENABLED=false`, with SMTP2GO configured. All are server-only variables. Redeploy after configuration changes.
5. Configure the email-only GitHub Actions scheduler described below. It calls three bounded email endpoints with `EMAIL_CRON_SECRET`, without starting WhatsApp delivery. Four emails maximum per delivery request, with a 15-second timeout per send.
6. In the internal owner account, enable email. In Growth Desk, open that owner → **Owner email updates** → select **Prepare welcome email**, then preview the welcome email. Check the real name, address and content.
7. Set `EMAIL_DELIVERY_ENABLED=true`, redeploy, then use **Send this email** for the internal welcome. Confirm arrival in the actual inbox and check SMTP2GO activity. After verifying the internal welcome, manually welcome each opted-in owner to activate that recipient.

The UI does not expose provider diagnostics to owners. Admins can inspect the selected owner's latest ten emails in Growth Desk. `ACCEPTED` means SMTP2GO accepted the request, not proof of inbox delivery. Delivery/bounce tracking currently remains in SMTP2GO; no unverified webhook claims are stored in FuelNerve.

## Recovery and pause

- Unique database identity includes organization, station, event, category, owner and destination. Duplicate events do not create duplicate jobs.
- Each worker claims a pending job atomically. Parallel workers cannot send the same claimed job.
- Consent, current recipient, active fuel station, current plan and source facts are rechecked before sending. Stale/changed records are suppressed with a reason. Live alerts expire after 24 hours. Daily summaries instead have a three-day business-date recovery window, with explicit delayed-report wording. Credit reports remain today-only and recheck current balances.
- HTTP 429 rejections retry at bounded delays, up to four attempts. Explicit 4xx rejections are `FAILED`; after fixing configuration an administrator can select **Retry rejected email**. The existing job is reused and all eligibility checks run again.
- Timeouts, 5xx, malformed success responses and expired processing leases are `UNKNOWN`. They never retry automatically because an email may have been accepted. Check SMTP2GO using the `X-FuelNerve-Delivery` reference, recipient and time. Keep uncertain messages held; do not create a replacement simply to retry.
- Pause all application email with `EMAIL_DELIVERY_ENABLED=false` and redeploy, or pause the individual owner from Growth Desk. Jobs and evidence remain intact. Owner opt-out and category changes suppress pending work immediately on the next processing pass.
- SMTP2GO delivery webhooks, automatic bounce suppression and a global paginated email operations inbox are future extensions; check provider activity during this limited pilot.

Official provider reference: https://developers.smtp2go.com/docs/send-an-email

## Automatic owner email updates

The email worker is independent of WhatsApp. Do **not** schedule the general `/cron/daily`, `/cron/agent-messages` or WhatsApp delivery endpoints for owner email updates. Use these email-only endpoints, in order:

1. `GET /api/notifications/cron/email-schedule` prepares due daily operating reports for today and the preceding three India business dates for both paid plans, plus the credit report for active Intelligence subscribers. It checks India business time, owner settings and individual email consent. A delayed run catches up after the selected hour and recovers missing daily summaries for up to three days. Older days and pre-welcome/pre-plan days are not replayed. Recovered emails clearly show their original date and use that day's ending stock, not today's stock. Stable organization/category/date identities prevent duplicate reports.
2. `GET /api/notifications/cron/email-agent-messages` prepares stock, reconciled-shift and receipt messages through the existing agent fact builders. Its progress is stored separately from WhatsApp's progress. The additive migration marks pre-rollout agent jobs handled **for email only**; old receipts and historical records are not replayed as live events. New events older than 24 hours are skipped. No WhatsApp jobs or push notifications are created by this endpoint.
3. `GET /api/notifications/cron/email-delivery` drains up to four eligible pending emails with the existing atomic claims, current-fact checks, suppression reasons and ambiguous-outcome holds.

All three require `Authorization: Bearer <EMAIL_CRON_SECRET>`. This is a separate random secret of at least 32 characters, **not** `SMTP2GO_API_KEY` or the general `CRON_SECRET`. The email scheduler credential cannot invoke the general WhatsApp cron endpoints. Do not put it in a URL, source code or logs.

### GitHub Actions setup

`.github/workflows/owner-email-alerts.yml` runs at minutes 2, 7, 12, …, 57. GitHub schedules are best-effort and can be delayed or missed; this is a small pilot, not a time-critical guarantee. Scheduled workflows run from the default branch. Public repositories can have schedules disabled after inactivity; monitor Actions and workflow failure notifications. Private repositories consume runner minutes: check the repository's included allowance and spending limit before expanding usage. Disable the workflow if its running cost or delay is unsuitable.

- Save `EMAIL_CRON_SECRET` privately in **Vercel Production** and as a **GitHub Actions repository secret** of the same name. GitHub receives only this limited worker credential; no SMTP2GO or database keys are needed there.
- Apply `20261120190000_email_agent_dispatch` and deploy the API before enabling the workflow. Existing stock, sales, payments and WhatsApp dispatch progress are unchanged.
- All current and future organizations are eligible without a per-account environment setting. `EMAIL_DELIVERY_ENABLED=true` and configured SMTP2GO enable sending globally; exact-recipient welcome acceptance, individual consent, support pause and category checks still control each owner.
- Set the repository Actions variable `OWNER_EMAIL_AUTOMATION_ENABLED=true` only after deployment checks. It defaults to off when absent.
- Run **Actions → Owner email alerts → Run workflow** once. Confirm all three stages succeed. Logs contain counts only; they do not contain recipients or email bodies. Verify actual SMTP2GO delivery, then observe a scheduled run. A failed stage makes the run fail visibly while allowing the other stages to finish. There is no immediate blind network retry.
- The workflow has no checkout or third-party action, no repository token permissions, a seven-minute timeout, and a concurrency group that prevents overlapping runs from cancelling an in-flight send.
- Pause immediately by setting `OWNER_EMAIL_AUTOMATION_ENABLED=false`, disabling the workflow, or setting `EMAIL_DELIVERY_ENABLED=false` in Vercel and redeploying. Owner opt-out also blocks a queued job at its next delivery check. Queues and audit history remain intact.

### Template review

Run `corepack pnpm exec tsx scripts/preview-owner-emails.ts` to produce six synthetic HTML previews in `/tmp/fuelnerve-email-previews`. Review desktop and mobile widths. Templates use email-compatible presentation tables, inline styles, forest-green and lime branding, exact verified values, readable dates, category-specific review guidance, safe record links, and a plain-text alternative. Shortages, excesses, partial receipts and unpaid amounts receive an attention treatment. They distinguish measured and book stock, collections and credit, and invoice totals and payments. The template never calculates balances or silently rounds source figures.

### Owner experience and support controls

- Owners save consent and plan-appropriate categories without preparing a welcome. Their email card shows **off**, **being set up**, **on** or **paused** based on current consent, the exact-recipient welcome, subscription and global sending readiness. No provider diagnostics are exposed to the owner.
- **On** shows the next future daily-summary time in IST. Times are approximate because the scheduler is best effort. Source figures still distinguish collections, credit, book stock and measured stock.
- Growth Desk shows the full owner and destination, then **Preview welcome → Send welcome & start email updates**. Successful acceptance closes the preview and refreshes the permanent status. Uncertain outcomes never offer a blind resend.
- Support can pause/resume each owner's email updates without deleting consent or the accepted welcome. Resuming does not bypass subscription or rollout checks. New recipients require their own welcome.
- Activation skips old shift and receipt events and starts scheduled reports at the next scheduled time. Existing pre-activation jobs are suppressed, preserving history rather than replaying a backlog.
- Apply migration `20261121023000_owner_email_pause` before deploying the support pause controls. It only adds an administrative pause flag; it does not change existing consent or operational records.

### All-account eligibility (21 November 2026)

The former `EMAIL_ROLLOUT_ORGANIZATION_IDS` pilot list is no longer used. An old
value remaining in Vercel has no effect; it may be removed. No migration or
per-customer configuration is required. Deploy API and web together.

1. The owner saves consent and preferences.
2. An administrator previews and sends the welcome from Growth Desk.
3. Only provider acceptance for that exact organization, owner and destination
   unlocks automated reports. Preparing a welcome does not activate anything.
4. Scheduled discovery includes newly eligible owners automatically. Changed
   email addresses require a new welcome. Withdrawn consent and support pause
   stop sending; subscriptions and source facts are rechecked before delivery.

The automatic worker never sends welcome emails and does not replay old shifts
or receipts at activation. Global `EMAIL_DELIVERY_ENABLED=false` remains the
emergency sending switch. WhatsApp rollout is unchanged. This release does not
send a welcome to anyone automatically.

## Independent backup and worker health (24 November 2026)

GitHub's scheduled workflow is best effort. Observed scheduled runs were hours
apart despite the five-minute expression; SMTP2GO was never called for the missed
evening. Do not interpret a successful morning workflow as proof that the evening
report ran.

`vercel.json` adds a daily email-only fallback at `30 15 * * *` (21:00 IST).
On Hobby, execution may occur within that hour. Configure a private `CRON_SECRET`
in Production and redeploy; Vercel supplies it as a Bearer credential. The
fallback prepares reports and drains four eligible jobs. GitHub continues to
prepare specialist events and drain the queue frequently when available.
Neither schedule guarantees minute-accurate delivery. For tighter timing or a
large backlog, use a dedicated scheduler/worker or an upgraded hosting plan.

Apply additive migration `20261124010000_email_worker_health` with deployment.
Growth Desk → account → Owner email updates reports the last successful daily,
agent and sending checks. A stage is stale after 30 minutes, or failed after an
unsuccessful run. Heartbeats contain no recipients, bodies or credentials.
A daily fallback updates daily/sending checks only; it does not claim specialist
agent checks have run.

Daily identity stays organization/category/business-date/owner/address. Accepted,
failed, processing and uncertain messages are never replayed automatically.
Never-attempted daily jobs may refresh their verified facts; only source-changed
or expired suppression can recover, with current consent, welcome and plan checks
applied again. Opt-out suppression is not silently undone. The credit report and
customer reminders do not participate in historical daily-summary recovery.

After deployment, manually run Owner email alerts once and inspect counts and
Growth Desk health. Confirm provider activity for recovered dates; do not rerun
accepted messages as a connection test. Outbound pause switches remain effective.
