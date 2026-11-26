# TriageSync

## 1. Overview
Support ticket triage (auto-classify, agent review, audit trail) plus 30-minute resource slot booking with race-safe concurrency. Monorepo: `frontend/` (React + Vite) and `backend/` (Node + Express + MySQL).

## 2. Live links
- App: _add URL_ · API: _add URL_/api

## 3. Seeded credentials
| Role | Email | Password |
|---|---|---|
| ADMIN | admin@triagesync.test | Admin@123 |
| USER | user@triagesync.test | User@123 |

## 4. Tech stack
React 18, Vite, Node 20+, Express, mysql2, bcryptjs (cost 10), JWT (12h), MySQL 8.

## 5. Folder structure
`backend/src/app.js` (routes, validation, RBAC) · `db.js` (pool, transactions) · `classify.js` (triage rules) · `schema.sql` · `seed.js` · `frontend/src/App.jsx` (pages) · `api.js` · `feed.js` (import payload)

## 6. Local setup
```
cd backend && cp .env.example .env   # fill DATABASE_URL and JWT_SECRET
npm install && npm run seed          # idempotent; safe to run twice. Tables are created automatically
npm run seed:bulk                    # optional: +600 tickets for latency tests
npm start
cd ../frontend && cp .env.example .env && npm install && npm run dev
```

## 7. DB schema
See `backend/src/schema.sql`: users, tickets, ticket_events, resources, bookings (indexes on ticket filters and booking slots).

## 8. API summary
All 21 endpoints from the brief under `/api`. Errors: `{ error: { code, message } }`. Check order: 401, 403 role, 404 path id, 403 ownership, 400, 404 referenced id, 409.

## 9. Completed features
- [x] Idempotent import and auto-triage, human override protection
- [x] PATCH with audit events, stats, combined injection-safe filters
- [x] Resources, availability, bookings, approve/reject/cancel, admin stats
- [x] Optimistic UI with rollback, XSS-safe rendering (React escaping)

## 10. Known limitations
_Fill in honestly after testing. Not yet verified: the live deployment and the 10-request concurrency check._
