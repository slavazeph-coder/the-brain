# BrainSNN developer platform

`/platform/` is one page for building with BrainSNN. It is the home of the World Projects API (#321) for two kinds of
people:
- **Developers:** a sandbox, an explorer for every endpoint, and copy-ready code.
- **The client who approves changes:** a plain-language review page.

It reuses the existing API, SDK and OpenAPI document. There is no new backend and no new sign-in system.

| View | What it does | Built on |
| --- | --- | --- |
| Home | One-click sandbox; "your first five minutes" checklist that ticks as you go; a planner toy where dropped boxes reroute two robot sizes; a first-call quickstart (Node: save the two SDK files beside the script, then run it) | `platform-planner.mjs` (same rules as `world_update.py`) |
| API explorer | All 39 documented operations, grouped by task. Bodies are prefilled from what the session already created, so the review workflow is eight clicks. Shows the raw response, request ID and replay flag, a plain-words fix for each error, and the same request as curl, JavaScript (SDK) or Python | `projects-api.openapi.json`, `platform-catalog.mjs`, `platform-snippets.mjs` |
| Projects → client view | Each site in plain language: readiness and its first blocker, what is waiting on you (confirm evidence, approve or reject with a reason, mark done on site), and what happened | `GET /projects/{id}`, review and decision endpoints |
| Keys | Issue a key per person and role (shown once, never stored), and revoke it in two clicks | `/keys` (admin) |
| Usage | Projects, keys, records and retained sources against limits; this month's billing counters | `/usage` |
| Processing | Engines the key can run | `/processing/capabilities` |
| Docs | The eight words (project, source, revision, evidence, change, trial, Idempotency-Key, expected_version), reference links and a first-project example | — |

## Sandbox

- **No key needed.** "Start in the sandbox" creates a private copy of the API in the tab, with four people to act as:
  admin, site operator, client reviewer and viewer.
- **Real SDK, real code.** The real SDK runs against it through `fetchImpl`, so code written against the sandbox runs
  unchanged against the service.
- **Nothing is sent or saved.** Processing, large uploads and exports answer `501 sandbox-not-simulated`.
- **Held to the real service.** `tests/world/platform-sandbox.test.mjs` runs one scripted workflow through the SDK
  against the production handlers (PGlite) and against the sandbox. Statuses, error codes and response shapes must
  match at every step. That includes 16 refusals:
  - an out-of-date version;
  - a reviewer approving before the evidence is confirmed;
  - the proposer approving their own change;
  - an earlier physical pass offered after a later fail;
  - a reused idempotency key;
  - a revoked key;
  - and the rest.

  A second scripted run checks two later outcomes on both. A later physical trial that fails withdraws a
  verification (the change goes stale). Two overlapping sends of one prepared request apply once: one source, one
  version step.

## Security

The page follows the same rules as the projects workspace:
- **Key in memory only.** A real key stays in page memory only: never in storage or a URL. The input clears on connect.
- **Issued keys shown once.** An issued key is shown once and never stored.
- **API data is text.** Everything from the API is rendered as text nodes.
- **What browser storage holds.** Only the theme choice.

The browser test checks these rules.

## Where it is linked

- the front door's API door;
- the site navigation ("API");
- the developer guide (`/world/api.html`, which keeps the pilot offer and waitlist);
- the projects workspace;
- the homepage content that crawlers read.

The server serves `/platform` the same way as `/walk`.

## Tests

| Test | What it covers |
| --- | --- |
| `tests/world/platform-sandbox.test.mjs` | The sandbox matches the real handlers step for step |
| `tests/world/platform-core.test.mjs` | Catalogue completeness. The prefilled bodies carry a first-time developer from new project to approved change. Snippets are shell-safe and keyless. The toy keeps the planner outcomes |
| `tests/world/platform-browser-smoke.mjs` | Chromium against the real handlers. See below |

What the browser test drives:
- the live-key workflow, from the first request to an independent approval;
- a replay with the same Idempotency-Key, which creates nothing new;
- the editor refused at approval;
- keys issued and revoked;
- usage and docs;
- hostile titles rendered as text;
- dark mode;
- the sandbox walk on a phone, with no horizontal overflow;
- no stored keys;
- an axe WCAG A/AA scan on six pages.

All three run in the World Projects CI workflow.

## Not yet

- **Self-serve sign-up.** Keys are issued by an operator or an admin key. Self-serve sign-up needs an auth provider and
  billing, which are not configured.
- **Uploads in the explorer.** Large source uploads go through the SDK's `uploadSourceFile()`. The explorer links to it
  instead of sending raw bytes.
- **The world-update loop.** It is still a command-line tool. Its review plan lands in a project, so the client view
  shows its changes.
