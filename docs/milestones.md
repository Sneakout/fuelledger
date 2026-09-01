# Milestones

## Milestone 0 — Project Foundation (complete)

Monorepo, web application, API, PostgreSQL migrations, minimal organization/user model, authentication foundation, responsive application shell, ten routed pages, design tokens/styles, environment validation, structured logs, centralized errors, and baseline unit/API tests.

## Milestone 1 — Station Onboarding / Digital Twin (complete)

Station profile, organization-level product and service master, effective-dated station configuration version, arbitrary tanks, dispensers, nozzles, flexible nozzle-to-tank mappings, opening stock/meter values, active/inactive equipment fields, server validation, and the “Build Your Station” wizard. The wizard includes tested templates for Stations A–D.

## Milestone 2 — Product & Service Engine (complete)

Product and service catalog with standard and custom categories, configurable units, purchase/selling prices, tax categories, inventory/tank/meter flags, service and non-inventory products, validation, API, management UI, and a seeded standard catalog.

## Milestone 3 — Shift Management (complete)

Guided opening and closing workflow with station/configuration capture, manager and shift-team assignment, opening/closing cash, complete tank and nozzle readings, shift status, derived meter-volume summary, and explicit reconciliation-required status after close.

## Milestone 4 — Sales & Collections (complete)

Fuel/meter sales, non-fuel product sales, service sales, cash/UPI/card/credit/fleet collection types, in-app transaction history, and transaction links to station, open shift, product, employee, and applicable tank/nozzle. Meter quantities are derived server-side from sequential readings. Credit/fleet sales carry customer/fleet and optional vehicle details until the formal customer master arrives.

## Milestone 5 — Inventory & Wet Stock (complete)

Append-only inventory ledger for receipts, sales, and adjustments; purchase receipts with line items; tank and dip readings; non-fuel stock movements; and a plain-language fuel reconciliation that compares opening + receipts − sales ± adjustments (book stock) with physical stock and variance.

## Milestone 6 — Cash & Shift Reconciliation (complete)

Expected versus actual collections for cash, UPI, card, credit, fleet, and other methods; signed manual adjustments with mandatory reasons; per-method and shift-total variance; immutable reconciliation snapshots; and atomic shift locking.

## Milestone 7 — Customers, Credit & Fleet — Complete

Customer and fleet masters, credit limits and terms, registered vehicles, credit-sale linkage, append-only customer ledger, receipts, outstanding balances, available credit, and FIFO ageing buckets. Fuel, DEF, lubricants, retail products, and services share the same customer account.

## Milestone 8 — Purchases & Expenses — Complete

Supplier master and terms, purchase invoices and invoice lines, due dates, payables, partial/full supplier payments, physical purchase receipts, inventory posting, expense categories, station expenses, and PDF/image evidence attachments.

## Milestone 9 — Accounting Engine (complete)

Organization chart of accounts, balanced append-only journals and journal lines, derived ledger/trial balance, accounts receivable/payable, inventory/COGS/revenue/expense postings, and a readable accounting screen. Sales, customer receipts, supplier invoices/payments, expenses, direct receipts, and inventory adjustments automatically post source-linked journals in their source transaction.

## Milestone 10 — Reports (complete)

Date- and station-filtered management reports for sales trends, product performance, payment mix, outlet comparison, current inventory value, customer receivables and ageing, supplier payables, expense categories, purchases, and journal-derived profit and loss. Includes responsive report UI and sales CSV export without introducing duplicate reporting balances.

## Milestone 11 — Owner Dashboard (complete)

Exception-first owner overview with today’s sales, collections, metered volume, posted net result, seven-day trend and comparison, station health, leading products, current receivables/payables/inventory position, live shift counts, and prioritized links for reconciliation, overdue payables, ageing credit, and stock alerts.

## Milestone 12 — Multi-Station (complete)

Organization-wide owner/accountant visibility, explicit manager/staff station assignments, server-enforced station boundaries, a shared outlet selector, station-scoped dashboards/reports/accounting, consolidated outlet comparison, and an owner-friendly access management screen.

## Next: Milestone 13 — Accountant Portal

Milestones 13–15 follow the master roadmap: accountant portal; AI; intelligence/automation.
