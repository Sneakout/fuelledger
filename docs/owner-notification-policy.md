# FuelNerve owner notification policy

Status: approved for the initial local rollout. In-app alerts and owner approval requests are enabled; production push delivery still requires valid APNs configuration and a signed device build.

## Principle

Notify an owner only when a decision is required, material loss or operational interruption is plausible, or a time-sensitive exception remains unresolved. Routine facts belong in Today and the Daily Brief.

Core and Core + Intelligence use the same deterministic source events, thresholds, tenant boundaries, and evidence. Core uses direct operational language. Core + Intelligence may add the responsible specialist's identity and an evidence-grounded explanation; it does not change priority or approval authority.

## Validated notification contract

Every newly created owner alert stores a versioned fact packet before its title or message is rendered. The packet includes the subject, record type, optional product, event and due dates, optional money or quantity, status, waiting age, station, evidence references, safe actions, and—only for an entitled organization—the responsible agent. Missing values are represented explicitly as `null`; they must never be guessed.

Evidence paths must be relative, recognized FuelNerve destinations. `APPROVE` is accepted only for an exact inventory-adjustment approval request. Existing alerts created before this contract remain readable without a packet.

## Immediate notifications

- A new approval request that can change inventory, contact a customer, or submit a correction.
- An empty tank or a tank projected by FuelNerve calculations to run out before the next confirmed receipt.
- A materially large collection variance after a shift closes.
- A shift still open beyond its configured closing grace period.
- A failed or uncertain execution after owner approval.
- A security event affecting the owner account or station access.

Immediate notifications must be deduplicated, station-scoped, quiet-period aware except for critical operational interruption, and resolvable.

## Daily Brief only

- Low stock that is not yet time-critical.
- Missing density or routine readings.
- Pending reconciliation within its normal review window.
- Receivables becoming due or overdue.
- Purchase-price or invoice anomalies.
- Material profit, revenue, COGS, or expense changes.
- Positive trends and informational summaries.

## Never push

- Every sale, receipt, reading, journal entry, or stock movement.
- Repeated reminders for the same unresolved condition.
- AI-generated speculation or an unsupported cause.
- Findings without valid FuelNerve evidence.
- Draft proposals that do not require the owner yet.

## Approval notification behavior

- A push opens the matching pending request in Alerts.
- Closing the decision sheet means decide later; it does not reject or acknowledge.
- The pending request remains in Alerts until approved, rejected elsewhere, expired, invalidated, or withdrawn.
- Swiping approves only the exact version shown.
- FuelNerve reloads authorization and business facts before execution.
- Stale or changed requests fail closed and require a fresh request.
- Success produces a durable receipt; uncertain outcomes remain visible.

## Suggested escalation

- Initial push when the request becomes actionable.
- One reminder near expiry, if expiry is introduced.
- No repeated reminder after the owner opens the request unless its urgency materially changes.
- Quiet periods apply to attention-level notifications; critical operational interruption may bypass them according to owner policy.
