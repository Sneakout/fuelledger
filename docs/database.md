# Database

PostgreSQL is the source of truth. Prisma owns schema and migrations. Milestone 1 adds `stations`, `products`, `station_configurations`, `tanks`, `dispensers`, `nozzles`, and `nozzle_tanks`, plus constrained product/equipment enums. Transactions remain deliberately deferred.

Milestone 2 adds `product_category_settings` and `tax_categories`, together with purchase price, selling price, and optional category/tax references on products.

Milestone 3 adds `shifts`, `shift_users`, `shift_tank_readings`, and `shift_nozzle_readings`. Readings link directly to the equipment from the configuration used to open the shift; closed shifts move to `RECONCILIATION_REQUIRED` rather than silently applying cash or stock adjustments.

Milestone 4 adds `sales`, a ledger of immutable transaction facts. Each sale belongs to an organization, station, open shift, product, and employee; metered sales additionally reference the compatible tank and nozzle and preserve their opening/closing evidence. Payment method, quantity, unit price, calculated total, optional customer/fleet name, vehicle, and note are kept with the transaction.

Milestone 7 adds `customers`, `vehicles`, `customer_receipts`, and `customer_ledger`. Customer ledger amounts use a simple sign convention: sales are positive debits and receipts are negative credits. Outstanding and ageing are derived, never hand-edited. Sales and receipts retain their source links, station, operator, timestamp, and description for auditability.

Milestone 8 adds `suppliers`, `purchase_invoices`, `purchase_invoice_lines`, `supplier_payments`, `expense_categories`, `expenses`, and `attachments`. A purchase invoice may link one physical `purchase_receipt`; its receipt lines remain the only source of purchase inventory movements. Payable outstanding is invoice total less linked payments. Attachment bytes and safe metadata are stored against an invoice or expense.

Milestone 5 adds `inventory_ledger`, `purchase_receipts`, `receipt_lines`, and `tank_readings`. The inventory ledger is append-only: receipts add stock, sales subtract it, and documented adjustments explain any controlled correction. Physical tank readings are stored separately so book stock and observed stock can be compared without overwriting either record. The migration creates ledger entries for pre-existing inventory-tracked sales.

Milestone 6 adds `shift_reconciliations` and `shift_collection_reconciliations`. One immutable header belongs to each reconciled shift; its method rows snapshot expected, manual adjustment, actual, reason, and variance. Creation and the shift transition to `LOCKED` occur in one database transaction. `OTHER` extends the payment-method enum for configurable counter collections beyond the named methods.

Milestone 9 adds organization-scoped `chart_accounts`, `journals`, and `journal_lines`. A journal has optional station and creator references plus a source type/source ID pair that is unique, so one operational fact can post only once. Journal lines reference chart accounts and store positive debit or credit values; application validation rejects unbalanced or zero-side entries before persistence. The ledger and trial balance are derived from these append-only lines.

Milestone 12 adds `user_station_access`, a unique user/station junction for manager and staff assignments. Existing restricted users are conservatively backfilled to their organization’s existing stations so deployment does not unexpectedly remove access. Owner and accountant scope remains role-derived rather than duplicated in assignment rows. Foreign keys cascade when a user or station is removed, and station lookup is indexed.

`demo_sessions` records the normalized visitor contact type, creation time, and absolute expiry. It contains no password and grants no ownership of operational data. Expiry is indexed for later retention cleanup; expired records cannot authenticate even if the signed browser token remains present.

Use `pnpm db:migrate` during schema development, `pnpm db:deploy` in repeatable environments, and `pnpm db:seed` for the minimal development account. Migrations are immutable after sharing. Financial records introduced later must favor corrections and reversals over destructive updates.

The Docker service is exposed on port 5433 to avoid colliding with a locally installed PostgreSQL server. Update `DATABASE_URL` accordingly when using Docker.
