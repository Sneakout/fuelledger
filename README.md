# FuelLedger

**Every litre. Every product. Every rupee.**

Milestone 0 foundation for a modern fuel-station business operating system. This repository intentionally contains infrastructure, authentication, navigation, and placeholder modules only.

## Quick start

1. Install Node.js 22+, pnpm, and Docker.
2. Copy `.env.example` to `.env`. For Docker, change the database port in `DATABASE_URL` to `5433`.
3. Run `docker compose up -d postgres`.
4. Run `pnpm install`, `pnpm db:generate`, `pnpm db:deploy`, and `pnpm db:seed`.
5. Run `pnpm dev` and open http://localhost:5173.

Development login: `owner@fuelledger.local` / `FuelLedger123!`

## Quality checks

Run `pnpm check`. See [`docs/architecture.md`](docs/architecture.md) and [`docs/milestones.md`](docs/milestones.md) for scope and design notes.
