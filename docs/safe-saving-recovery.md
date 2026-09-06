# Safe saving and recovery

Financial saves use an Idempotency-Key scoped to the authenticated organization and user. The save receipt and business writes commit in the same serializable transaction. Identical retries return the committed service result; changed request details with the same key are rejected. Transaction failures roll back the receipt too.

The browser coalesces concurrent identical requests and retains an uncertain request's key in session storage for a retry with the same details. This protects retries within that browser session; clearing browser storage, changing the form after an uncertain result, or submitting independently from another browser is not the same operation. Check the register before starting a replacement submission. Keys are not silently expired by the server.

Deploy database migrations before the matching API and web release. Existing integrations must send Idempotency-Key. Do not remove saved retry receipts while clients may still retry them.

## Isolated recovery drill performed

- Created a separate local PostgreSQL cluster on port 55439, not the configured application database.
- Applied all 30 migrations to milestone5_source.
- Ran the opt-in safe-save integration suite: simultaneous submissions, committed-result replay, changed-payload rejection, failed-transaction rollback, successful retry.
- Backed up the synthetic database with pg_dump custom format and restored with pg_restore --exit-on-error into milestone5_restore.
- Compared all synthetic organization and save-receipt rows; exact match (two rows each).

This proves a synthetic database restore, not the recoverability of an existing production backup. Production backup retention, encryption, external attachments and recovery time still need separate operational verification. No production data was read or modified for this drill.

The integration suite requires RECOVERY_TEST_DATABASE_URL explicitly and never falls back to the application's DATABASE_URL. Run only against a disposable database with migrations applied.
