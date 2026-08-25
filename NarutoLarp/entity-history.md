# Entity History (Append-Only)

Mirrors LarpQuest's `entity_history` ledger and `BlackCloverLarp/entity-history.md`. Every state change gets a row. **Never edit or delete a row** — corrections get a new row that explains what changed and why (rollback-via-compensating-row, not deletion).

Format: `[Ch#] Entity — change (source line)`

## Backfilled History

None yet — no chapters have been played. Once `OGFile.md` exists and chapter 1 is written, backfill starts here.

## Future Rows

Append here as chapters are played. Format matches above: `[Ch#] Entity — change (source location)`. Corrections to earlier entries get a **new row**, never an edit to an existing one — if a ruling in `audit/inconsistencies.md` changes something recorded above, add a row here noting the ruling and what it supersedes.

## Rulings Applied

None yet.
