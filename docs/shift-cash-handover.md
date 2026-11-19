# Shift opening cash handover

Previous actual closing cash + declared cash added − declared cash removed = expected opening cash. Actual opening cash is a separate physical count. The difference remains visible and does not create a journal, supplier payment, expense or bank movement.

- The latest closed shift is selected within the selected fuel station. Both its ID and closing amount are rechecked inside the serializable opening transaction.
- A new shift's actual opening field is initially suggested from the previous physical count. Users can change it after counting.
- Refresh cash reloads the source without overwriting the user's count, movements or explanation.
- Additions, removals, counted differences of at least one paisa, and an unavailable previous count require an explanation. Cash removed cannot exceed previous cash plus additions.
- First shifts have no previous balance to compare; missing historical closing cash is never represented as a confirmed zero.
- The saved shift has an immutable opening snapshot of the source shift/count, added/removed amounts, expected and actual opening, difference, reason, authenticated actor and timestamp. Related real transactions must still be recorded through their own workflows.
- Older clients may explain a difference in their opening notes; they cannot silently save a conflicting count.

## Deployment

Apply `20261119120000_shift_cash_handover` before deploying the updated API. It adds a nullable JSONB snapshot to shifts and does not backfill or change existing cash balances. Production migration and deployment have not been performed as part of this implementation.

## Verification

Automated checks cover carry-forward, paise precision, cash added/removed, shortages/excesses, required reasons, unavailable history, stale and wrong-shift references, invalid values, persisted actor/snapshot, and preserving physical counts across refresh. Database integration tests require an explicitly isolated test database; they are not run against production.
