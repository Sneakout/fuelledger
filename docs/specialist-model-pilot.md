# Shift, Stock and Profit model-explanation pilot

Status: implementation and automated local safety pilot complete; live-provider local and staging pilots require environment credentials and have not been claimed as run.

## Frozen-record comparison

Each case is read once and retained as a frozen application fact packet. The deterministic briefing, model-assisted explanation and forced-provider-failure fallback must contain the same finding identities. The model may explain supplied facts; it cannot select tools, calculate business values, change severity, remove findings or replace evidence.

The owner gate requires all of the following:

- Issue identification: 100% of findings have a specific title and explanation.
- Priority clarity: 100% carry severity; ranked findings carry their deterministic priority reason.
- Evidence openability: 100% have application-relative supporting-record links.
- Failure preservation: 100% of deterministic findings remain when the provider fails or times out.
- Unsupported numbers: zero.
- Finding identity: model-assisted and deterministic paths return the same frozen finding keys.
- Provider fallback rate: at most 5% during a representative pilot window.
- Model p95 latency: at most 5 seconds for Shift and Stock, 7 seconds for Profit.

Automated fixtures are regression evidence only. They are not a representative owner pilot and cannot establish the 5% operational fallback gate.

## Local live-provider pilot

Keep `NERVE_LOCAL_SHADOW_ENABLED=true`, keep findings hidden, and leave proposals and actions disabled. Set `NERVE_EXPLANATION_PROVIDER=openai`, `OPENAI_API_KEY`, `NERVE_OPENAI_MODEL`, and `NERVE_MODEL_TIMEOUT_MS=7000` in the execution environment. Run `npm run shadow:fuelnerve` from `nerve-agent-platform` against the local FuelNerve API.

The runner freezes every source read for the lifetime of that process and writes narrative mode, model latency, token usage and fallback reason to `.local-shadow/latest.json`. For a valid A/B review, capture a sanitized fixture from that report and run both providers against that fixture in one pilot session; separate executions against a changing local database are not an equivalent comparison. Compare finding identities, priority, evidence and explanation quality. Do not promote results produced from records that changed between variants.

## Staging pilot

Staging remains owner-hidden and read-only. Use dedicated staging credentials, a staging-only model key and a sanitized station. Run a minimum representative set containing normal and exception cases for all three specialists. Confirm evidence links inside staging with the same owner permissions used by the pilot.

Promotion is blocked unless the quality configuration passes, provider failures preserve every deterministic finding, no unsupported number survives validation, and the measured staging fallback and latency objectives pass. Production visibility is a separate decision.
