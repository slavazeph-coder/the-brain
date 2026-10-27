# brainsnn.com's own processing, on Railway

Step by step, with screenshots of what to expect and a troubleshooting table: `docs/brainsnn-processing-setup.md`.

A second Railway service runs the World Builder worker on CPU next to the site. The site's server talks to it over
Railway's private network, holds its credentials, and gives each browser a short session instead. On the World Builder
page, "Process on BrainSNN" then works with no worker address or token to type.

- **Engines:** `colmap-sparse` (COLMAP reconstruction) and `scene-usd` (the scene compiler, Blender 4.2 as a Python
  module). No GPU, no model weights, no API keys.
- **Who can process:**
  - you, with a passcode;
  - any visitor, only if you switch it on, with a daily cap per connection and per day.
- **Files:** uploads and results live on the worker's volume and are deleted after 24 hours.

## Set it up (about 10 minutes, all in Railway)

1. **Pick a passcode** of at least 12 characters, easy to type on a phone (three random words work). It is the only
   secret: both services derive the worker credentials from it. Never paste it into a chat, an issue or the repository.
2. **Share it with both services.** Project Settings → Shared Variables: add `WORLD_SITE_PASSCODE` with the passcode.
3. **Create the worker service.**
   - In the Railway project: New → GitHub Repo → this repository.
   - Name the service `world-worker`.
   - Settings:
     - **Config file:** `/robotics/world_worker/deploy/railway/railway.toml` (with the leading slash: Railway reads it
       from the repository root). Without it, the service picks up the root `railway.toml` and builds the website.
     - **Networking:** no public domain. The site reaches it privately.
   - **Volume:** add one mounted at `/data`, 20 GB.
   - **Variables:**

     ```
     PORT=8080
     WORLD_SITE_PASSCODE=${{shared.WORLD_SITE_PASSCODE}}
     WORLD_STORAGE_BYTES=19000000000
     WORLD_CPU_THREADS=4
     ```

     - `WORLD_STORAGE_BYTES` is a little below the volume size: 19000000000 for 20 GB, and at least 5 GB.
     - `WORLD_CPU_THREADS` is the service's vCPU count.
   - **Deploy.** The first build downloads Blender (about 400 MB). When it is healthy, the log ends with
     `Uvicorn running on http://[::]:8080`.
4. **Point the site at it.** On the existing site service, add these variables. The site redeploys on its own.

   ```
   WORLD_WORKER_INTERNAL_URL=http://world-worker.railway.internal:8080/
   WORLD_SITE_PASSCODE=${{shared.WORLD_SITE_PASSCODE}}
   ```

   To open processing to visitors later, add `WORLD_SITE_VISITORS=1` here only. Optionally also set
   `WORLD_SITE_VISITOR_JOBS_PER_DAY` (default 2) and `WORLD_SITE_VISITOR_JOBS_TOTAL` (default 20).
5. **Check it.**
   - Open `https://brainsnn.com/api/world/processing`. It should read `"available":true,"passcode":true`.
   - Then, on the World Builder page:
     1. Choose walkthrough video.
     2. Open "Process a walkthrough", then Process on BrainSNN.
     3. Enter the passcode, tick the consent box, and Process.
   - An 8-second test walk took about 100 s to reconstruct on 4 CPU threads. A two-minute video has about 120 frames,
     so expect several minutes.

Changing the passcode changes the credentials on both sides. Redeploy both services after you change it.

Separate credentials instead of the derived ones: set the same `WORLD_WORKER_SITE_OWNER_TOKEN` (and
`WORLD_WORKER_SITE_VISITOR_TOKEN`) on both services. Each is 43–128 letters, digits, `-` or `_`; to make one, run
`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.

## How it fits together

- **Site** (`brainsnn-r3f-app/src/server/worldWorkerProxy.js`, mounted at `/api/world`):
  - `GET /processing` says what is set up;
  - `POST /session` exchanges the passcode for a 43-character session, kept in page memory only. It refuses after ten
    wrong passcodes an hour from one address. Visitors get a session without one when they're switched on;
  - `/worker/v1/...` forwards the site flow only: capabilities, uploads, jobs, tickets and downloads.
- **Isolation:** each session reaches only the uploads and jobs it created. Job listings are refused. Download links are
  signed by the worker, live for 60 seconds, and need no session.
- **Worker** (`start.sh`):
  - builds its tenant registry from the passcode-derived (or explicit) credentials (`tenants.py`; hashes only on disk);
  - uses a fresh operator credential on every start, which nobody is given;
  - listens on `::` for the private network. Set `WORLD_WORKER_HOST=0.0.0.0` on a host without IPv6.
- **One replica each.** Sessions and visitor counts live in the site's memory, so a site restart ends open sessions.
  Reconnect with the passcode.

## Test it without Railway

```sh
docker build -f robotics/world_worker/deploy/railway/Dockerfile -t brainsnn-world-worker .
docker run --rm -p 8090:8090 -e PORT=8090 -e WORLD_WORKER_HOST=0.0.0.0 -e WORLD_STORAGE_BYTES=9000000000 \
  -e WORLD_SITE_PASSCODE=... -v "$PWD/worker-data:/data" brainsnn-world-worker
# then the site, from brainsnn-r3f-app after npm run build:
NODE_ENV=production WORLD_WORKER_INTERNAL_URL=http://127.0.0.1:8090/ WORLD_SITE_PASSCODE=... node dist/server.cjs
```

`tests/world/site_processing_browser_smoke.py` runs the same path in a browser in CI, with a transport fixture in place
of COLMAP.
