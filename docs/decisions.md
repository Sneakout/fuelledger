# Architecture decisions

## ADR-001: TypeScript monorepo

Use pnpm workspaces so client, server, and transport validation share types while remaining independently deployable.

## ADR-002: React and Vite

Use React 19 with Vite for a fast, responsive client. Keep the design system in semantic CSS tokens and reusable shell components until component needs justify a larger UI dependency.

## ADR-003: Express API with Zod boundaries

Use a modular Express API and Zod at trust boundaries. Central middleware owns security headers, CORS, request IDs, logs, and error serialization.

## ADR-004: PostgreSQL and Prisma

Use PostgreSQL for transactional integrity and Prisma for typed access and reviewable SQL migrations. Docker is optional because the development machine may already run PostgreSQL.

## ADR-005: HTTP-only cookie authentication

Establish cookie-based authentication without exposing tokens to browser storage. This is a foundation, not production-complete identity: hardening and full RBAC enforcement are tracked for later security work.

## ADR-006: Strict Milestone 0 scope

Seed only an organization and owner needed to prove login. Do not seed tanks, products, transactions, or future business behavior before their schemas and invariants are designed.

## ADR-007: Versioned station digital twin

Each station has numbered configuration versions. Equipment belongs to a configuration version, rather than directly to a station, so later physical changes can preserve the layout in force when a transaction occurred. Nozzle-to-tank is an explicit junction: it supports realistic one-to-many tank feeds without assuming a fixed pump layout.

## ADR-008: Sales are evidence-backed and append-only

Sales are created only in an open shift and preserve their business context. For metered products, the server derives quantity from the next sequential nozzle reading and verifies the selected tank/nozzle/product mapping; callers cannot choose an arbitrary fuel quantity. Milestone 4 deliberately stores customer/fleet names as transaction snapshots rather than introducing a premature customer master. Corrections and reversals will be modeled as new records in later accounting work rather than editing a sale.

## ADR-011 — Customer balances are derived from an append-only ledger

Credit and fleet sales post positive ledger debits; receipts post negative ledger credits in the same database transaction as their source record. The server checks projected outstanding against the credit limit using a serializable sale transaction. Customer and vehicle snapshots remain on sales for readable history, while source IDs provide durable account linkage. Ageing is calculated FIFO from due dates so the ledger remains the single source of truth.

## ADR-012 — Supplier invoices and goods receipts are separate facts

An invoice establishes a payable; it never adds inventory by itself. A purchase receipt establishes physical arrival, and its receipt lines post inventory movements. The manager may capture both together, but the server creates both records inside one transaction. Supplier payments are additive records and drive OPEN, PART_PAID, and PAID status. Evidence is capped at 500 KB per record for the local foundation; object storage can replace byte storage later without changing ownership.

## ADR-009: Physical stock never overwrites book stock

Inventory changes are append-only ledger movements. A physical tank/dip reading is evidence of what was measured, not an implicit adjustment. FuelLedger calculates and displays the variance, then requires a separate documented adjustment if the business decides book stock needs changing. This makes wet-stock discrepancies explainable and auditable.

## ADR-010: Reconciliation is a one-way lock

Expected collections always come from persisted shift sales, never from the browser. Reconciliation stores one row per supported payment method with expected, adjustment, actual, reason, and variance. Any non-zero adjustment requires an explanation. Creating the snapshot and setting the shift to `LOCKED` happen atomically; later correction work must use an explicit controlled workflow rather than reopening or editing the locked shift.

## ADR-013: Operational facts post one balanced, source-linked journal

Accounting is derived from operational facts, not entered independently by a station manager. The posting helper validates positive balanced lines and creates the journal in the same transaction as its source. `(sourceType, sourceId)` is unique, preventing duplicate journals on retries. Posted journals are treated as append-only; future corrections will use explicit reversal journals rather than edits. An invoice without a physical receipt debits goods in transit rather than inventory, preserving the distinction between a liability document and physical stock.

## ADR-014: Reports are derived, scoped read models

Milestone 10 does not create mutable report totals. The API derives reports from tenant-scoped operational ledgers and journal lines for each requested date/station filter. Period performance and current balances are labelled separately because applying one date rule to both would be misleading. CSV export uses the same already-authorized response shown on screen.

## ADR-015: Owner attention is exception-first

The default dashboard is not a smaller copy of every report. It leads with today’s performance, a seven-day comparison, outlet state, and a short server-derived action queue for unreconciled shifts, overdue payables, ageing customer credit, and zero/negative stock. Every action links back to the owning workflow, keeping correction authority and audit rules in the source module.

## ADR-016: Station access is an allow-list enforced by the API

Owner and accountant roles are organization-wide because their work inherently spans outlets. Manager and staff access is an explicit user/station junction and defaults to no stations for newly created restricted users. Every station-owned read is filtered and every write target is authorized by the API. The global browser selector is navigation context only, never a security control. Deployment backfills existing restricted users to existing organization stations to preserve current operations while owners review assignments.
