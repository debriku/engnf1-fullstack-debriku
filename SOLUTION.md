# SOLUTION

## Part A: Architecture and trace
```
React (Vite) --fetch--> Express /api --mysql2 pool--> MySQL
   App.jsx                app.js: auth -> role -> validate -> tx        tickets, ticket_events, bookings
```
Imported ticket trace: `Queue.reimport` -> `POST /api/tickets/import` -> `classify()` (classify.js) -> `INSERT IGNORE` on unique `externalId` -> `GET /api/tickets` + `GET /api/stats` -> stats strip and list.

**Reviewed** = an agent changed the category, or moved the ticket out of OPEN. Priority/assignee edits alone do not mark it reviewed.

## Part B: Concurrency and idempotency
- Booking: one transaction locks the user row, then the resource row (`SELECT ... FOR UPDATE`), counts the user's upcoming bookings, checks overlap (`newStart < existingEnd AND newEnd > existingStart`, PENDING/APPROVED only), then inserts. Fixed lock order avoids deadlocks. Concurrent requests for a resource queue on its row lock, so exactly one wins and the rest see the overlap and get 409.
- Import: `INSERT IGNORE` on the UNIQUE `externalId` is atomic. Existing rows are locked and re-classified only when `isHumanOverride = 0`.

## Part C: Measure first, then optimise
_Fill in with your own measurements: run `npm run seed:bulk`, time `GET /api/tickets?limit=100` (e.g. 20 runs, median) before and after the indexes in schema.sql (drop them to get the "before" figure)._
| | Median ms | p95 ms |
|---|---|---|
| Before indexes | | |
| After indexes | | |

Trade-off to discuss: more indexes speed reads but slow writes and use storage; `LIKE '%q%'` search cannot use a B-tree index (a FULLTEXT index would, with different matching rules).

## Part D: With one more day
_Point to file:line after you review the code, e.g. replace LIKE search with FULLTEXT, add automated tests for the 10-request race._
