# Architecture

FuelLedger is a pnpm monorepo with a React/Vite client (`apps/web`), an Express API (`apps/api`), shared Zod contracts (`packages/shared`), and a PostgreSQL schema managed by Prisma. The browser talks only to `/api`; business rules belong in backend modules, never UI components.

The foundation is organized for vertical domain modules. Each future capability should own its routes, validation, services, policies, and tests. Shared contracts contain transport-safe schemas only. Organization ownership is present from the first migration so future station data can be tenant-scoped.

Security baseline: password hashes use bcrypt, login sessions use signed eight-hour JWTs in HTTP-only SameSite cookies, responses use Helmet headers, CORS is allow-listed, inputs are validated, and logs redact credentials. Self-registration creates an isolated organization and owner. Google ID tokens are verified server-side against a fixed audience before account creation or sign-in. Apple sign-in remains credential-gated until its Services ID and signing-key configuration are supplied. Later milestones must add email verification, CSRF protection, rate limiting, password recovery, session revocation, and complete authorization policies before production.

Demo access is a separate capability, not a privileged login shortcut. Each visitor supplies an email or mobile contact, receives an individually persisted expiry and a JWT capped at 48 hours, and is projected onto the seeded demo owner for broad read visibility. Authentication checks the persisted expiry on every request. The shared authentication middleware rejects all non-read HTTP methods for demo sessions, so browser controls cannot bypass the read-only boundary.

Operational baseline: structured JSON logging, request correlation IDs, centralized error responses, graceful shutdown, and a health endpoint that verifies database connectivity.

Accounting is a backend domain module rather than a browser-calculated report. Operational services post balanced journals through one shared transaction-scoped helper, and the accounting read model derives chart balances and trial totals from immutable journal lines. This preserves a single source of truth while keeping sales, purchases, and expenses simple for station staff.

Milestone 10 reports are server-owned read models over existing operational and accounting facts. Date and station filters are enforced with organization scope in the API. Period metrics—sales, purchases, expenses, and P&L—are kept distinct from current-position metrics such as stock value, receivables, and payables. No reporting snapshot or duplicate balance table is introduced at this stage.

The Milestone 11 owner dashboard composes the trusted reporting read model with live shift/reconciliation state. Its exception rules are calculated server-side and return explicit destinations for action; the browser only presents priorities. Weekly comparison, today’s metrics, and outlet health are derived on request without a new dashboard persistence layer.

Milestone 12 makes station scope a first-class request boundary. Owners and accountants receive organization-wide context; managers and staff receive an explicit active-station allow-list. Route handlers validate write targets and scope bootstrap reads before domain services query records. The shared client station context controls dashboard, report, and accounting projections, but it is never treated as authorization—the API independently enforces access on every station-owned request.
