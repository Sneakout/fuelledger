# API

Base URL: `http://localhost:4000/api`

- `GET /health` — service and database readiness.
- `POST /auth/login` — validates email/password, returns safe user data, and sets an HTTP-only session cookie.
- `POST /auth/signup` — creates a new organization and its initial owner from validated email/password details, then starts a session.
- `POST /auth/google` — verifies a Google ID token against the configured web client; signs in an existing email or creates a new owner organization when a business name is supplied.
- `POST /auth/demo` — accepts a valid email or mobile contact and issues a read-only session over the populated demo organization for exactly 48 hours.
- `GET /auth/me` — returns the current authenticated user.
- `POST /auth/logout` — clears the session cookie.
- `GET /stations` — lists the authenticated organization’s stations and active configuration.
- `POST /stations` — validates and atomically publishes a station profile, product setup, equipment, mappings, and configuration version 1.
- `GET /products` — returns the product catalog plus custom and tax categories.
- `POST /products`, `PUT /products/:id` — creates or updates a validated product/service.
- `POST /products/categories`, `POST /products/tax-categories` — adds organization-scoped master data.
- `GET /shifts/bootstrap` — returns active stations/configurations, active team members, and recent shifts.
- `POST /shifts/open` — validates full opening cash/readings and opens the next station shift.
- `POST /shifts/:id/close` — validates all closing readings, derives the shift summary, and moves the shift to reconciliation-required.
- `GET /sales/bootstrap` — returns open saleable shifts, active products, available team members, and the latest 100 organization-scoped transactions.
- `POST /sales` — records one collection. It requires an open shift and assigned employee; metered products derive quantity from an in-sequence nozzle reading and validate its tank mapping. Credit and fleet collections require a customer account.
- `GET /customers/bootstrap` — returns customer and fleet accounts with vehicles, ledger activity, outstanding, available credit, and ageing.
- `POST /customers` / `PUT /customers/:id` — creates or updates a customer account and its credit policy.
- `POST /customers/:id/vehicles` — registers a vehicle against its owning account.
- `POST /customers/:id/receipts` — records a cash, UPI, card, or other receipt and posts the matching ledger credit.

Credit and fleet sales now require a customer ID. Fleet sales require a fleet-type account; an optional vehicle must belong to that account. The API rejects sales that would exceed the configured credit limit.

- `GET /purchases/bootstrap` — suppliers, invoices, payables, stations/products/tanks, expense categories, and expenses.
- `POST /purchases/suppliers` — creates a supplier and payment terms.
- `POST /purchases/invoices` — creates an invoice; optionally creates its goods receipt and inventory movements atomically.
- `POST /purchases/payments` — records an invoice payment and advances its status.
- `POST /purchases/expense-categories` / `POST /purchases/expenses` — configures and records expenses.
- `GET /purchases/attachments/:id` — streams authorized invoice or expense evidence.
- `GET /inventory/bootstrap` — returns station stock positions, reconciliation inputs, recent ledger movements, and receipts.
- `POST /inventory/receipts` — records a purchase receipt and immutable positive ledger movements; tank-linked products require a compatible active tank.
- `POST /inventory/adjustments` — records a reasoned positive or negative ledger movement.
- `POST /inventory/tank-readings` — records physical stock and an optional dip reading without modifying book stock.
- `GET /reconciliation/bootstrap` — returns closed review-ready and locked shifts with server-calculated expected collections by payment method.
- `POST /reconciliation/shifts/:id` — validates actual collections and documented manual adjustments, snapshots all method variances, and atomically locks the shift.
- `GET /accounting/bootstrap?stationId?=…` — returns the provisioned chart of accounts, derived account balances/trial totals, and recent source-linked journals for the permitted station scope.
- `GET /reports/bootstrap?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&stationId?=…` — returns filtered sales/product/payment/station summaries and period P&L, plus current inventory value, receivables ageing, and supplier payables.
- `GET /dashboard/bootstrap?stationId?=…` — returns today’s KPIs, seven-day sales trend, current outlet health, open/pending shift counts, prioritized exceptions, collection mix, and leading products for the permitted station scope.
- `GET /access/context` — returns the authenticated user’s active station choices and whether the role has organization-wide scope.
- `GET /access` — owner-only station directory and team assignment view.
- `PUT /access/users/:id` — owner-only replacement of a manager/staff member’s station assignments.

All station-owned bootstrap reads are filtered to the authenticated user’s permitted stations. Station, shift, payment, attachment, and other write targets are checked server-side; changing a browser selector or request body cannot grant access. Errors use `{ "error": { "code", "message", "requestId", "details?" } }`. Request IDs are returned in `x-request-id`.
