# Customer account deletion

Location: administrator Growth Desk → Accounts → Delete account.

The action removes the selected organization, every fuel station and staff login,
all stock and money records, DSR imports/corrections, attachments stored in the
application database, sessions, preferences, queued messages and agent jobs.
It removes the account from the shared WhatsApp rollout allowlist and clears
its idempotency receipts and matching demo contacts/follow-up email records.

The preview lists the account, staff email addresses, fuel stations and record
counts. Deletion requires the exact account name, a reason of at least ten
characters and a separate acknowledgement. The signed preview expires after ten
minutes and is bound to the administrator, account and current record contents.
A changed account requires a fresh preview.

Both routes and the deletion service enforce platform administrator access.
Administrator organizations, the current administrator's organization and the
shared demo organization are protected. In-flight provider sends/reviews block
deletion. Push sends claim their jobs before contacting APNs so deletion can
observe that state. Owned rows are locked and removed in foreign-key order in a
serializable transaction; concurrent confirmations cannot both succeed. Any
failure rolls back the complete operation, including the audit write.

Ownership scopes are explicit for indirectly owned tables. Actor/created-by
relationships never define ownership. Unexpected cross-account references block
removal, including those configured with cascading deletes. New schema models
without an ownership rule fail closed.

A minimal platform deletion audit (administrator, organization ID, reason,
counts and time) remains in the existing platform audit table. Hashed security
rate-limit buckets remain. Backups expire under the hosting backup policy;
provider-side message history, already received messages and drafts cached on
users' devices cannot be erased by this application action.

No production deletion is needed to deploy this feature. It uses existing tables
and requires no database migration. The current implementation intentionally
supports complete customer-organization deletion, not deleting the platform
administrator account or silently removing an individual employee's history.

Validation: six isolated PostgreSQL scenarios cover every tenant-owned model,
second-account isolation, login-session removal, protected accounts, wrong/stale
confirmation, in-flight sends, cross-account cascade references, full rollback
when auditing fails, and simultaneous deletion. Three UI tests cover explicit
confirmation and error handling. API suite: 305 passed; web suite: 237 passed.
Both production builds passed. Isolated integration tests require
ACCOUNT_DELETION_TEST_DATABASE_URL pointed at a disposable database/schema.
