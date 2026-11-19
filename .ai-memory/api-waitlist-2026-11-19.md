---
type: project
description: API access waitlist on /world/api.html, its storage, limits, owner access and what it promises visitors
---

# API access waitlist — 2026-11-19

The owner chose "make a wait list for now" for selling one API access product
before public signup and billing exist.

- Form: `/world/api.html#waitlist` (`api-waitlist.mjs`, `api-waitlist.css`).
  Required: email, use case, consent. Optional: name, company, scans per month,
  details. Hidden `website` honeypot.
- Server: `src/server/apiWaitlist.js`. `POST /api/world/waitlist` → 202 with
  the same message whether or not the address was already listed (no
  enumeration). Latest details win and `submissions` counts repeats.
- Storage: `brainsnn_api_waitlist` in the World Projects PostgreSQL database
  (`WORLD_PROJECT_DATABASE_URL || DATABASE_URL`). No memory fallback.
  `API_WAITLIST_ENABLED=0` turns it off.
- Limits: 5 per IP per hour (`LIMITS.waitlist`, dedicated route tier), 300
  accepted per process per hour, 50,000 rows. An 8 KB body cap.
- Owner read: `GET /api/world/waitlist/entries` with the World passcode owner
  session, or `scripts/api-waitlist-admin.mjs count|csv|remove --email`.
- The only promise to visitors is one email about API access. Nothing sends
  mail yet; the owner contacts people manually from the export.
- Verified: unit tests on embedded Postgres (PGlite) and a real Postgres 16,
  plus a real form submission in Chromium at 1280px and 390px.
