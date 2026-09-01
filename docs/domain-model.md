# Domain model

The root tenancy boundary is Organization: one owner organization may eventually operate multiple Stations. A User belongs to an Organization and has an initial role of Owner, Manager, Accountant, or Staff.

Future bounded contexts are Station Configuration, Product & Service Catalog, Shifts, Sales, Inventory, Procurement, Expenses, Customers & Fleet, Payments & Reconciliation, Accounting, and Reporting. Fuel will be a specialization of generic products and inventory—not the root assumption. No future physical equipment cardinality may be hard-coded.

Milestone 1 implements Organization, User, Station, Product, StationConfiguration, Tank, Dispenser, Nozzle, and NozzleTank. StationConfiguration is versioned; Tank belongs to one configuration and product; Nozzle belongs to one dispenser and product, and can map to multiple compatible tanks.

Milestone 4 adds Sale. It is intentionally a transaction record, not an accounting posting: `METERED`, `PRODUCT`, and `SERVICE` sales use the same trusted trail and preserve their collection method. Metered quantities are derived from recorded meter movement on an active nozzle connected to the selected tank. A lightweight customer/fleet name snapshot is used until the dedicated customer and fleet master arrives in Milestone 7.

Milestone 7 makes Customer an organization-owned account with a type, credit policy, vehicles, sales, receipts, and append-only ledger. A customer is independent of product category, so one account can purchase fuel, DEF, lubricants, merchandise, and services. Vehicle belongs to Customer; every selected vehicle is validated against that ownership. Ageing applies receipts FIFO against the oldest debit and groups the remaining debit by due date.

Milestone 8 separates the commercial purchase invoice from the physical goods receipt. Supplier owns invoice and payment terms; PurchaseInvoice owns financial lines, due date, status, payments, and evidence. PurchaseReceipt proves stock arrival and posts ReceiptLine movements into InventoryLedger. Expense is a station cost classified by an organization expense category and may carry evidence.

Milestone 5 adds PurchaseReceipt, ReceiptLine, InventoryLedger, and TankReading. A receipt and each inventory-tracked sale create one ledger movement; adjustments are their own, reasoned movements. Book stock is opening stock plus receipts, minus sales, plus/minus adjustments. A TankReading carries a physical stock quantity and optional dip measurement; variance is physical stock minus book stock.

Milestone 6 adds ShiftReconciliation and ShiftCollectionReconciliation. Expected values are recalculated from the shift’s sales on the server, then preserved alongside actual collection values. A signed adjustment changes adjusted expected collections only when accompanied by a reason. Variance is `actual − (expected + adjustment)`. A successfully reconciled shift is locked and cannot be reconciled twice.

Milestone 9 adds ChartAccount, Journal, and JournalLine. A Journal belongs to an organization, may reference a station and creator, and uniquely identifies the originating operational fact. Its one-or-more JournalLines reference chart accounts and hold debit/credit values that must balance. The general ledger and trial balance are calculated views over those lines; customer and supplier operational ledgers remain their dedicated AR/AP subledgers.

Milestone 10 adds no persisted domain entity. Reports are derived read models spanning Sale, InventoryLedger, CustomerLedgerEntry, PurchaseInvoice, Expense, and JournalLine. This keeps operational and accounting records authoritative and prevents report totals from drifting into a second source of truth.

Milestone 11 likewise adds no transactional entity. The Owner Dashboard is an organization-scoped projection combining today’s Report read model, recent Sale activity, current Shift status, and ShiftReconciliation variance. Action items identify existing operational records that require attention rather than creating a separate task ledger.

Milestone 12 adds UserStationAccess between User and Station. It is meaningful for MANAGER and STAFF roles; OWNER and ACCOUNTANT derive organization-wide access from role policy. Station-owned projections and commands intersect the user’s allow-list before accessing operational records.
