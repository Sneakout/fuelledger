# Nerve Agent Platform SDK

Application-neutral contracts, runtime, multi-application adapters, governed actions, platform services, proactive processing, configurable industry packs, production-quality controls, and GA product contracts through Milestone 12.

## Included

- Core contracts and runtime validators.
- Versioned capability contracts.
- HMAC request signing and verification.
- Tool registration with scope, tenant, location, and evidence enforcement.
- Contract-version negotiation.
- In-memory idempotency protection.
- Standard error envelope.
- Mock application and test fixtures.
- Conformance tests covering valid and rejected requests.
- Versioned agent registry and strict agent-to-tool policy.
- Provider-neutral model gateway with grounded structured narratives.
- Deterministic fallback, cancellation, timeouts, tenant quotas, audit history, and hashed safety identifiers.
- FuelNerve read adapter, evidence verification, and non-user-visible shadow comparison workflow.
- Four evidence-backed, read-only FuelNerve agents with inspectable finding and answer view models.
- Persistent tenant-scoped finding, proposal, approval, and audit stores.
- Expiring proposals with payload, fact, and evidence snapshot hashes.
- Role-based single and dual approval with distinct actors and trusted scopes.
- Stale-proposal detection and source-revalidated approved action envelopes.
- Fixed controlled-action catalogue with per-action scopes and source validation requirements.
- Exactly-once reference execution, receipt replay, approval consumption, and visible uncertain outcomes.
- FuelNerve-owned action adapter that fails closed when a domain handler is unavailable.
- Service control plane for application registration, tenant mapping, scoped tokens, credentials, rotation, regions, and tenant agent enablement.
- Authenticated runtime gateway with environment binding, rate limiting, health monitoring, durable-queue contracts, dead letters, and usage metering.
- Signed event ingestion with per-stream ordering, gap buffering, deduplication, and bounded replay.
- Tenant-timezone schedules, quiet periods, alert lifecycle deduplication, resolution, and delivery preferences.
- Generic business adapter and industry terminology contract.
- CommerceLite second-application reference integration using four reusable read-only agents and independently versioned contracts.
- Immutable fuel-retail and generic-commerce packs with tenant-scoped agent configuration.
- Configurable display names, findings, application-evaluated thresholds, terminology, notifications, approvals, evidence labels, and assistant intents.
- Quantitative evaluation gates, malicious-record corpus, tamper-evident audit chains, retention/deletion workflows, operational telemetry, recovery verification, and kill switches.
- Self-service onboarding, SDK release catalog, commercial plans, entitlements, quotas, model budgets, tenant reporting, approval views, audit export, and operational status.

## Verify

```sh
npm run check
```

The package deliberately has no framework, database, model-provider, or application dependency. The in-memory nonce/idempotency stores and file governance store are test/reference implementations; production deployments must use shared transactional stores. Nerve prepares approved envelopes but never executes source-application actions.
