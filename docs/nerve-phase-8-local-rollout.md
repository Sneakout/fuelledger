# Nerve Phase 8 local rollout

This gate is intentionally local-only. Do not commit, push, enable proposals, or enable actions while owner acceptance is in progress.

## Start and refresh the local review

From the FuelNerve folder:

```sh
corepack pnpm dev
```

In a second terminal:

```sh
cd nerve-agent-platform
set -a
source ../.env
set +a
npm run shadow:fuelnerve
```

Open `http://localhost:5173/insights` and sign in as the local owner account. Refresh the page after each shadow review.

## Automated release gate

Run both suites before each owner-testing round:

```sh
corepack pnpm check
cd nerve-agent-platform
npm run check
```

The gate covers agent identity, deterministic ranking, grounded-output fallback, evidence links, tenant and station isolation, stale findings, inactive-agent display, absence of action controls, and keyboard/dialog behavior.

## Owner walkthrough

Use the Nerve page for Station C and review these five updates in order.

| Case | Open this update | Expected owner experience |
| --- | --- | --- |
| Empty stock | **A stock position is empty** | Stock Agent is visible; zero stock is a fact; physical accuracy remains unconfirmed; Inventory opens directly. |
| Three stock differences | **Stock Agent found differences in 3 tanks** | The three readings remain grouped; the briefing compares deterministic book and physical values; possible explanations are labelled as possibilities. |
| Multiple pending shifts | **Shift Agent found 3 shifts waiting for review** | Shift Agent identifies Shift 1 first and explains the waiting-time priority; Reconciliation opens directly. |
| Receipt timing | **A fuel receipt needs a timing check** | Stock Agent distinguishes recorded and physical timing; actual arrival remains unconfirmed; Purchases opens directly. |
| Profit change | **Review revenue movement first** | Profit Agent reloads the same saved report period, shows FuelNerve-calculated values, identifies the largest movement, and does not claim a cause. |

For each case, answer:

- Is the responsible agent immediately clear?
- Does the update add useful prioritization?
- Is the next check obvious?
- Can supporting records be opened without technical language?
- Does the default briefing fit comfortably on screen?
- Are confirmed facts clearly separated from possibilities and unknowns?

Record **Pass**, **Needs wording change**, or **Needs logic change** for each answer. Phase 8 is accepted only when all five cases pass and both automated checks remain green.

## Safety checks

The generated `.local-shadow/latest.json` report must continue to show:

- `proposalsEnabled: false`
- `actionsEnabled: false`
- `crossTenantDenied: true`
- `crossStationDenied: true`
- `failedClosed: true`
- `fuelNerveUnaffected: true`

If any value differs, stop owner testing and treat the run as failed.
