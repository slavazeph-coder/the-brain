# brainsnn.com's own processing, on Railway

A second Railway service runs the World Builder worker on CPU next to the site. The site's server talks to it over
Railway's private network, holds its credentials, and gives each browser a short session instead. On the World Builder
page, "Process on BrainSNN" then works with no worker address or token to type.

- **Engines:** `colmap-sparse` (COLMAP reconstruction) and `scene-usd` (the scene compiler, Blender 4.2 as a Python
  module). No GPU, no model weights, no API keys.
- **Who can process:**
  - you, with a passcode;
  - any visitor, only if you switch it on, with a daily cap per connection and per day.
- **Files:** uploads and results live on the worker's volume and are deleted after 24 hours.

## Set it up (about 15 minutes)

1. **Make two credentials and a passcode**, on your own computer:

   ```sh
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # run twice: owner credential, visitor credential
   ```

   - Pick a passcode of at least 12 characters, for yourself only.
   - Never paste any of these into a chat, an issue or a file in the repository.

2. **Create the worker service.**
   - In the Railway project: New → GitHub repo → this repository.
   - Name the service `world-worker`.
   - Settings:
     - **Config file:** `robotics/world_worker/deploy/railway/railway.toml`.
     - **Networking:** no public domain. The site reaches it privately.
   - **Volume:** add one mounted at `/data`, 20 GB.
   - **Variables:**

     | Name | Value |
     |---|---|
     | `PORT` | `8080` |
     | `WORLD_WORKER_SITE_OWNER_TOKEN` | the owner credential |
     | `WORLD_STORAGE_BYTES` | a little below the volume size: `19000000000` for 20 GB (at least 5 GB) |
     | `WORLD_CPU_THREADS` | the service's vCPU count (default 2) |
     | `WORLD_WORKER_SITE_VISITOR_TOKEN` | only for visitor processing: the visitor credential |

3. **Point the site at it.** On the existing site service, add these variables. The site redeploys on its own.

   | Name | Value |
   |---|---|
   | `WORLD_WORKER_INTERNAL_URL` | `http://world-worker.railway.internal:8080/` |
   | `WORLD_WORKER_SITE_OWNER_TOKEN` | the same owner credential |
   | `WORLD_SITE_PASSCODE` | your passcode |

   For visitors as well, also add:
   - `WORLD_WORKER_SITE_VISITOR_TOKEN` (the same visitor credential);
   - `WORLD_SITE_VISITORS=1`;
   - optionally `WORLD_SITE_VISITOR_JOBS_PER_DAY` (default 2) and `WORLD_SITE_VISITOR_JOBS_TOTAL` (default 20).

   Railway's shared variables can hold the owner and visitor credentials once, for both services.

4. **Check it.**
   - Open `https://brainsnn.com/api/world/processing`. It should read `"available":true,"passcode":true`.
   - Then, on the World Builder page:
     1. Choose walkthrough video.
     2. Open "Process a walkthrough", then Process on BrainSNN.
     3. Enter the passcode, tick the consent box, and Process.
   - An 8-second test walk took 96 s to reconstruct on 4 CPU threads. A two-minute video has about 120 frames, so
     expect several minutes.

## How it fits together

- **Site** (`brainsnn-r3f-app/src/server/worldWorkerProxy.js`, mounted at `/api/world`):
  - `GET /processing` says what is set up;
  - `POST /session` exchanges the passcode for a 43-character session, kept in page memory only. It refuses after ten
    wrong passcodes an hour from one address. Visitors get a session without one when they're switched on;
  - `/worker/v1/...` forwards the site flow only: capabilities, uploads, jobs, tickets and downloads.
- **Isolation:** each session reaches only the uploads and jobs it created. Job listings are refused. Download links are
  signed by the worker, live for 60 seconds, and need no session.
- **Worker** (`start.sh`):
  - builds its tenant registry from the credentials (`tenants.py`; hashes only on disk);
  - uses a fresh operator credential on every start, which nobody is given;
  - listens on `::` for the private network. Set `WORLD_WORKER_HOST=0.0.0.0` on a host without IPv6.
- **One replica each.** Sessions and visitor counts live in the site's memory, so a site restart ends open sessions.
  Reconnect with the passcode.

## Test it without Railway

```sh
docker build -f robotics/world_worker/deploy/railway/Dockerfile -t brainsnn-world-worker .
docker run --rm -p 8090:8090 -e PORT=8090 -e WORLD_WORKER_HOST=0.0.0.0 -e WORLD_STORAGE_BYTES=9000000000 \
  -e WORLD_WORKER_SITE_OWNER_TOKEN=... -v "$PWD/worker-data:/data" brainsnn-world-worker
# then the site, from brainsnn-r3f-app after npm run build:
NODE_ENV=production WORLD_WORKER_INTERNAL_URL=http://127.0.0.1:8090/ WORLD_WORKER_SITE_OWNER_TOKEN=... \
  WORLD_SITE_PASSCODE=... node dist/server.cjs
```

`tests/world/site_processing_browser_smoke.py` runs the same path in a browser in CI, with a transport fixture in place
of COLMAP.
