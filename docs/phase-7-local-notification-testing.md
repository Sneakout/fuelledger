# Phase 7 local notification testing

This suite uses fictional names, identifiers and amounts. It must never be populated with production customer records.

## Automated checks

From the repository root:

```sh
corepack pnpm --filter @fuelledger/api exec vitest run \
  tests/owner-notification-local-scenarios.test.ts \
  tests/approval-safety.test.ts \
  tests/station-access.test.ts
```

From `apps/ios`, generate the local project and run the `FuelNerve` test scheme in Xcode. The iOS contract suite verifies cross-station denial, offline and timeout behavior, cookie isolation and the no-preview-data boundary.

## Owner review checklist

Open each sanitized scenario in the local popup experience and verify:

- The first sentence names the person, supplier, shift, tank, invoice or report involved.
- The station, relevant date and verified amount or quantity are visible.
- The same underlying record does not produce a second popup.
- `Show supporting record` opens the expected local FuelNerve page.
- `Compare records` appears only when two or more supporting records exist.
- Core users see deterministic FuelNerve wording with no agent identity.
- Core + Intelligence users see the responsible specialist, while the underlying sentence and numbers remain unchanged.
- Closing the popup keeps the item in Alerts.
- No send, stock-change, invoice-correction or execution action is available.

## Required scenarios

1. Overdue customer purchase — Riverline Logistics HSD credit sale.
2. Overdue supplier delivery — National Fuel Supply invoice and matched receipt.
3. Empty tank — MS tank 1.
4. Low-stock projection — HSD tank 2, using a supplied FuelNerve projection.
5. Physical/book variance — HSD tank 1 reading versus stock ledger.
6. Missing density — HSD tank 1 morning reading.
7. Open shift — Shift 18.
8. Reconciliation difference — Shift 17 collection records.
9. Duplicate invoice — two National Fuel Supply records with the same invoice number and amount.
10. Material expense change — posted generator repair expense and profit report.
11. Pending inventory adjustment — exact HSD tank 1 request.
12. Changed approval evidence — approval must fail with `APPROVAL_EVIDENCE_CHANGED` and make no inventory change.
13. Cross-station denial — Station B request by a Station C-only account must return `403` without data.
14. Offline backend — retain only the last successful response, label it stale and never show samples.

Low-stock dates and all financial values are supplied by FuelNerve's deterministic services. The notification layer only presents validated facts.
