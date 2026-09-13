# Confirmed invoice import rollout

The production path is disabled unless all of these conditions pass:

- `INVOICE_IMPORT_RELEASE_STAGE=PRODUCTION`
- the signed-in user is an owner;
- the owner falls inside `INVOICE_IMPORT_ROLLOUT_PERCENT`;
- `INVOICE_IMPORT_ROLLBACK` is not `true`;
- the request remains an unpaid, unreceived invoice with no attachment.

## Recommended rollout

1. Start with `INVOICE_IMPORT_ROLLOUT_PERCENT=5` and `INVOICE_IMPORT_MONITORING_PERCENT=100`.
2. Review at least 50 completed or stopped attempts across representative PDF and image invoices.
3. Move to 25%, then 50%, then 100% only when duplicate blocks, validation failures and browser duration remain acceptable.
4. Set `INVOICE_IMPORT_ROLLBACK=true` to stop new confirmations immediately. Existing purchase records are not changed by rollback.

## Browser measurements

Only these fields are accepted:

- stage: PDF text, OCR, purchase check or submission;
- duration in milliseconds;
- outcome: success, failed or withheld.

The metrics endpoint rejects extra fields. Filenames, document text, supplier details, invoice numbers, amounts, station details and extracted values are never included.

## Promotion gates

- No duplicate invoice is created after repeat clicks or interrupted retries.
- No cross-station request succeeds.
- Demo, manager, accountant and staff accounts cannot use the confirmed-import endpoint.
- No import receives stock, records payment or stores the source document.
- Submission failures stay below 2%, excluding deliberate validation and duplicate blocks.
- Purchase-check p95 stays below 2 seconds, excluding the user’s local OCR time.
- Any privacy, scope or duplicate-control failure triggers immediate rollback.
