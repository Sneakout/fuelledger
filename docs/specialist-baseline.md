# Shift, Stock and Profit specialist baseline

Baseline date: 11 September 2026
Status: local shadow implementation; not a production capability statement

## What this baseline establishes

FuelNerve currently has three implemented specialist definitions: Shift Review, Stock Watch and Profit Insight. Their findings and priority are calculated by deterministic FuelNerve services. A model may rewrite supplied facts into constrained explanations, but it does not calculate balances, stock, variance, priority or profit.

The sanitized scenarios are defined in `apps/api/tests/fixtures/specialist-baseline.ts`. The executable expectations are split between `apps/api/tests/specialist-baseline.test.ts`, `apps/api/tests/nerve-prioritization.test.ts` and `nerve-agent-platform/tests/fuelnerve-read-only-agents.test.ts`.

## Capability and claim inventory

| Specialist | Supported claims | Evidence and next check | Explicitly unsupported |
| --- | --- | --- | --- |
| Shift Review | A shift is overdue for closing under the documented 12-hour review threshold; a shift is waiting for reconciliation; closing readings or collection details are missing; collections differ; a handover is incomplete; one shift ranks ahead of another under the published score. Related issues are grouped into one shift briefing. | Shift-specific reconciliation evidence. Compare closing readings, nozzle collections, payment-method totals and handover records. | Cause, fraud, responsibility, approval or resolution unless a source record explicitly establishes it. A station-specific expected closing schedule is not yet configured, so the current overdue threshold is global. |
| Stock Watch | Recorded stock is empty or low; physical and book stock differ; density is missing; receipt timing is ambiguous; a tank ranks first under the published score; a movement violates ledger direction, contains a material adjustment, or the latest completed selling day is at least twice a sufficient prior median; a consumption-based runout estimate when its sample gate passes. | Inventory and receipt evidence. Compare the physical reading, movements, receipts and approved adjustments; verify the physical arrival time separately. Runout output states its book-stock, recorded-sales, sample-window and no-future-change assumptions. | Measurement accuracy, theft, physical arrival time, automatic adjustment or unrestricted demand forecasting. Runout is withheld with fewer than seven recorded selling days in the 14-day window. |
| Profit Insight | Posted revenue, cost of sales, operating expenses and net profit for the selected period; movements across equivalent calendar periods; largest absolute component movement; configured materiality threshold; observed fuel and non-fuel sales-revenue contribution; report completeness and missing cost-of-sales status. | Profit-report evidence. Every displayed amount comes from the report, and net profit reconciles as revenue less cost of sales and operating expenses. Inspect the posted journals and recorded product sales behind the component that ranked first. | Proven causation, prediction, journal correctness, missing-data imputation, product-level profit attribution or a newly calculated accounting result. Contributions describe recorded revenue only because product-level costs are not allocated. |

## Deterministic priority rules

Shift priority adds fixed weights for reconciliation state, waiting minutes, missing closing readings, missing collection details, absolute collection difference and incomplete handover. Stock priority adds fixed weights for empty or low status, physical/book variance, unusual movements, ambiguous receipts, missing density and approved adjustments. Stock movement review uses a 14-day UTC window: invalid receipt/sale directions are flagged; an individual adjustment is material at 500 litres or ten percent of current book stock, whichever is greater; and latest-completed-day sales are unusual only with seven prior selling days, at least 500 litres, and at least twice their median. Runout divides current positive book stock by average recorded sales across at least seven selling days in that window and assumes no future receipt or demand change. Profit priority compares the selected period with the immediately preceding period of equal length; a movement is material when its absolute change is above the monetary floor and its percentage change is at least ten percent, when a percentage baseline exists.

These rules are transparent and reproducible. They are not trained ML models and do not improve automatically from owner behaviour.

## Sanitized baseline scenarios

| Scenario | Expected result | Priority | Evidence | Recommended next check |
| --- | --- | --- | --- | --- |
| Shift 7 has waited 240 minutes, has two missing readings, one missing collection detail and an absolute difference of 50. | One grouped Shift review briefing containing the reconciliation, reading, collection and handover issues. | Shift 7 first. | Exact shift under `/reconciliation` | Compare readings, nozzle collections, payment totals and handover. |
| HSD T-EMPTY has zero recorded litres, a 10-litre physical/book difference, missing density and one ambiguous receipt. | Stock priority, empty, variance, missing-density and receipt-timing findings. | Empty tank first. | `/inventory` and receipt evidence under Purchases | Compare the stock timeline and verify the source receipt and physical arrival time. |
| Revenue moves from 800 to 1,000 across equal seven-day periods and exceeds the movement of cost and expenses. | Profit position and material-change findings. | Revenue movement first. | `/reports` | Inspect the posted journals for revenue, cost of sales and expenses. |

All names and identifiers are synthetic. The fixture contains no production customer records.

## Current measured rule performance

The focused local baseline run covers three deterministic ranking scenarios. All three produced the expected leading item and expected supporting context: 3/3 scenario accuracy, 100% on this small fixture set. The platform suite also verifies that findings remain available when model output is invalid or the model fails.

This number is a regression baseline, not evidence of field accuracy. It contains one positive ranking case per specialist and cannot establish general precision or recall. A later evaluation milestone needs a separate labelled set containing ordinary records, borderline thresholds, incomplete data and deliberately confusing cases.

## Production restrictions and release status

- The local shadow runner registers Shift Review, Stock Watch and Profit Insight and uses `StaticModelProvider`; this is programmed test output rather than a live model.
- The `/intelligence/agents` and investigation endpoints require `NERVE_LOCAL_SHADOW_ENABLED` and return not found in production.
- Proposals and actions are disabled in the local shadow report. Specialist tools are read-only.
- Daily Brief, Ask and investigation explanation modules can call the configured OpenAI Responses API, but deterministic facts survive invalid output or provider failure.
- The specialist platform, routes, tests and this baseline are currently uncommitted local work. Their presence in this working directory does not mean they are deployed.

## Baseline release gate

This milestone is complete when the focused API tests, the platform agent tests and this contract test pass; all supported claims remain mapped above; and any newly advertised capability has both a deterministic source and a sanitized scenario. Unsupported capabilities must remain absent from product claims until that gate is extended.
