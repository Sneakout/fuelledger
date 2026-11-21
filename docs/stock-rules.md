# Stock rules

These definitions are the authoritative vocabulary for fuel and other inventory. All quantities in one calculation use the product's configured stock unit. Timestamps are stored as instants and shown in the fuel station's local time.

## Dates and times

- **Invoice date** is the date printed on the supplier document. It controls document and accounting presentation. It does not prove when stock arrived and must never place a receipt into a stock period.
- **Received at** is the actual date and time stock physically entered the selected tank or inventory location. The receipt's inventory-ledger movement must have this effective timestamp.
- A record's creation or update time is audit metadata. It is not a substitute for either invoice date or received-at time.

## Stock values

- **Book stock** is `configured opening balance (or confirmed historical opening checkpoint) + receipts - sales +/- approved adjustments`, calculated at a stated cutoff time.
- **Physical stock** is a measured tank quantity captured at a stated time. A measurement is evidence and never changes book stock automatically.
- **Shift opening** is the physical reading captured when the shift begins. It remains fixed even if stock is delivered during the shift.
- **Expected closing** is `shift opening + receipts during shift - sales during shift - testing not returned +/- other approved adjustments during shift`.
- **Actual closing** is the physical tank quantity measured when the shift ends.
- **Variance** is `actual closing - expected closing`. Negative is a shortage and positive is an excess. It remains visible until reviewed and does not itself create an inventory movement.

## Boundaries and invariants

1. Invoice date and received-at time are separate business facts.
2. Every stock movement belongs to one organization, fuel station, product and, when tank-linked, one tank.
3. A receipt is included according to received-at time. A sale or adjustment is included according to its own effective time.
4. Shift opening and actual closing are immutable physical snapshots after the shift is locked.
5. Returned testing fuel does not reduce stock. Testing not returned reduces expected and book stock exactly once.
6. A physical variance requires review; only a separate approved adjustment may change book stock.
7. Corrections preserve the original value, corrected value, actor, time and reason.

The shared calculation contract lives in `packages/shared/src/stock-rules.ts`. Later phases must use this vocabulary when adding receipt timing, shift stock bridges and correction workflows.

## Authoritative chronological balance

Current book stock is evaluated at one explicit `asOf` instant. Only inventory-ledger movements whose effective time is on or before that instant are included. The organization, fuel station, product and tank must all match; a movement whose recorded scope conflicts with its tank is rejected as a consistency error rather than being silently shown under another balance.

The same cutoff-based balance service is used by sale availability checks, shift opening, the owner dashboard and low-stock alerts. Inventory and management reports apply the same cutoff and equation. A future-dated receipt therefore cannot increase current stock, while a receipt physically recorded between two shifts increases the next physical opening expectation. Existing transaction rows are never rewritten by this calculation.

A database guard rejects new or re-scoped ledger movements when the organization does not own the fuel station or product, when a tank-linked product has no tank, or when the selected tank belongs to another fuel station or product. Read models also detect incompatible historical rows and stop with a consistency error instead of silently calculating a misleading balance.

## Shift boundaries

A shift owns effective stock movements in the half-open interval `openedAt <= occurredAt < closedAt`; an open shift has no upper boundary yet. This makes a receipt at the exact closing instant belong after that shift, so no receipt can appear in two shifts. Receipts between shifts bridge the prior physical closing to the next expected opening. Receipts during an open shift are shown separately as “Received during shift” and never rewrite its saved opening.

When a deliberately backdated receipt time falls inside a closed shift, the purchase screen warns the user before saving. The receipt and its existing ledger movement are re-timed in place, derived balances recalculate from the ledger, and an audit event records the old time, new time, actor, reason and affected shift. No receipt, sale, supplier payment or journal is duplicated, and the closed shift itself remains unchanged.

## Receipt timing implementation

For new purchase invoices that receive stock, the API defaults `receivedAt` to the server's current time. An explicitly earlier time requires a reason; a future physical receipt is rejected. Invoice date continues to control the payable document and journal date only. Existing receipt times are not migrated or rewritten.

Authorized users can run the read-only `GET /api/purchases/receipt-timing-audit` report. It returns `recordsChanged: false` and flags linked historical receipts where the receipt time exactly matches the invoice date, was entered later, and has no recorded timing explanation. The report is evidence for review, not permission to repair records automatically.

## Latest physical measurement (dashboard and inventory)

Confirmed historical DSR morning readings, tank checks and shift opening/closing
readings are read through `readLatestTankObservations`. The selected tank must
match the fuel station and product within the organization. Measurement dates,
not upload/correction dates, determine which observation is newest. A correction
to the latest measurement is reflected on the next data load. Future readings,
invalid quantities and unconfirmed chart comparisons are excluded.

A DSR has a **morning business date**, not an exact timestamp. The API retains
`observedAt: null` and `precision: MORNING`; no midnight timestamp is invented.
Timestamped operational evidence is preferred when observations share a date.
This is a tie policy, not proof of the precise sequence of a date-only DSR.

Tank gauges show **calculated book stock**. Last measured stock remains separate,
with its source and actual measurement date. Neither editing an older DSR nor
upload time makes an observation current.

## Confirmed DSR stock coverage

The earliest confirmed DSR morning for a tank supplies the verified historical
opening checkpoint. Earlier ledger entries are incorporated in that opening and
are not added again. Later physical dips are observations, not silent resets.
From the checkpoint, add DSR receipts, subtract consecutive-morning nozzle sales
less returned testing, and apply saved live movements and approved adjustments.
The final morning needs the following morning to establish that day's sales.

A DSR is a whole business-day summary. Live receipts and sales on a covered day
are components of that total. Only the remaining historical quantity is added.
If live quantities exceed the DSR total, preserve live entries and require review;
never create a negative balancing receipt or sale. Missing days remain explicit.
Multi-tank aggregate receipts/testing require allocation; the service does not
invent allocations. Date-only receipts cannot be put at a guessed intraday time.

One shared read model supplies dashboard, inventory, reports, stock checks and
opening expectations. Shift bridges include the change in this timeline between
readings; contributions without exact shift timing are flagged for review.
Saved shift openings and closings are never rewritten. Unsaved closing meters
and testing affect the local provisional closing preview only, until submitted.

This is a read-time composition: no duplicate ledger entries, invoices, supplier
payments, cash or journals are created. Historical corrections change derived
stock on the next read. DSR quantities do not supply purchase costs, so reports
flag historical stock valuation as incomplete rather than inventing costs.
Chart-derived quantities retain precision and are not capped to nominal capacity.
