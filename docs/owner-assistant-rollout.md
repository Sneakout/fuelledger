# Owner Assistant specialist rollout

The specialist coordinator is disabled by default. It may answer only from Shift, Stock, Profit, Credit and Purchase read capabilities, for exactly one station and one requested snapshot date.

## Release sequence

1. `OFF`: all users remain on the existing assistant.
2. `LOCAL`: exercise sanitized scenarios and the three supported follow-ups locally.
3. `STAGING`: compare coordinator and existing answers from the same frozen records. Start at 5%, then 25%, then 100% after each observation window passes.
4. `PRODUCTION`: start at 5%, then 25%, 50% and 100%. Tenant-and-owner hashing keeps users on a stable route.

The rollout percentage never promotes an environment that the release stage has not reached. The rollback flag immediately routes everyone to the existing assistant, regardless of stage or percentage.

## Release gates

- One and only one station is present in every answer.
- Every visible fact has application-owned evidence for that station.
- All specialist reads use the same requested snapshot date.
- Missing or stale inputs are disclosed.
- Unsupported questions produce no tool calls and a clear refusal.
- Duplicate source records are shown once.
- Model timeouts or invalid output preserve the deterministic facts.

## Production monitoring and rollback

Record completion, deterministic fallback, scope denial, unsupported request, evidence validation, snapshot consistency and end-to-end duration for every coordinator run. Recommend rollback when any evidence or snapshot failure occurs, completion falls below 98%, fallback exceeds 10%, or p95 duration exceeds 20 seconds.

Set rollback first, confirm new requests use the existing route, and retain run audit records for investigation. Re-enable only after the failed gate has a regression test and staging passes again.
