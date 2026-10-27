# Turn on BrainSNN processing: step by step

This guide turns on video processing on brainsnn.com itself. You upload a walkthrough on the World Builder page and get
back a 3D reconstruction, then a measured scene: no GPU, no worker address or token to type, and no computer of yours
left running. It takes about 20 minutes, almost all of it waiting for Railway to build.

The code is in PR #248:
- `robotics/world_worker/deploy/railway/`: the worker container;
- `brainsnn-r3f-app/src/server/worldWorkerProxy.js`: the site side;
- `scripts/world-demo/site_processing_check.py`: the check.

The short version is `robotics/world_worker/deploy/railway/README.md`.

## What you are setting up

```
phone / browser ──HTTPS──▶ brainsnn.com (existing site service)
                              │  /api/world/session    passcode → session (kept in page memory only)
                              │  /api/world/worker/... forwards uploads, jobs and downloads
                              ▼  Railway private network, http://world-worker.railway.internal:8080
                           world-worker (new service, no public address)
                              ├─ colmap-sparse: video → posed frames + 3D points   (COLMAP, CPU)
                              └─ scene-usd:     measured points → GLB / USD / IFC  (Blender 4.2, CPU)
                              /data volume: uploads and results, deleted after 24 hours
```

- **The only secret is your passcode.** Both services derive the worker credentials from it. It never appears in the
  repository, a URL or the browser's storage.
- **Only you can process at first.** Opening it to visitors is one setting (Part 8), with a daily cap.
- **It is not a survey.** The scale comes from one distance you measure with a tape. The fold check catches a room
  that COLMAP put together wrong, but not every error.

## Before you start

- [ ] Access to the Railway project that runs brainsnn.com, and permission to merge PRs in `slavazeph-coder/the-brain`.
- [ ] A Railway plan that allows a second service with a **20 GB volume**. Smaller works down to 8 GB; see step 3.6.
- [ ] A passcode: **at least 12 characters**, easy to type on a phone (three random words, for example
  `copper-lantern-meadow`). Keep it in your password manager. Never paste it into a chat, an issue, a commit or a
  screenshot.

## Part 1: Merge the code (2 minutes, then about 10 minutes of checks)

1. Open PR #248 in GitHub ("brainsnn.com processes walkthroughs itself, on a CPU worker on Railway").
2. Check that both checks are green: **test** and **world-contracts**. If either is red, stop and ask the agent that
   opened it.
3. Press **Merge** and confirm.
4. Railway deploys `main` once "BrainSNN app release checks" passes. Then "Verify BrainSNN live deploy" checks the live
   files. Both run in the GitHub **Actions** tab; wait until both are green.
5. **Check:** open <https://brainsnn.com/api/world/processing>. You should see:

   ```json
   {"available":false,"passcode":false,"visitors":false,"visitorJobsPerDay":null}
   ```

   That is correct at this point: the new code is live and waits for Parts 2–4. A page that says "Not found" means the
   deploy has not finished.

Nothing changes for visitors until Part 4. The page looks exactly as before.

## Part 2: Store the passcode once (2 minutes)

1. Open the Railway project → **Settings** (the project's, not a service's) → **Shared Variables**.
2. Choose the **production** environment.
3. Add a variable:
   - **Name:** `WORLD_SITE_PASSCODE`;
   - **Value:** your passcode.
4. Save. Shared variables are not used until a service references them, so nothing redeploys yet.

## Part 3: Create the worker service (5 minutes, then a 10–20 minute first build)

1. **New service.** On the project canvas: **+ New** (or **Create**) → **GitHub Repo** → `slavazeph-coder/the-brain`.
   - Railway may start building straight away. That first build uses the wrong configuration (step 3.3 fixes it), so
     cancel it or let it fail.
2. **Name it.** Open the new service → **Settings** → **Service name** → `world-worker`. The site finds it by exactly this
   name.
3. **Config file (required).** Settings → **Config-as-code** (or "Railway Config File") → enter:

   ```
   /robotics/world_worker/deploy/railway/railway.toml
   ```

   - **Keep the leading slash**: Railway reads the path from the repository root.
   - **Why this matters:** without it, the service uses the root `railway.toml`, which builds and starts the **website**.
     Its log would then show `vite build` and `node dist/server.cjs` instead of the worker.
4. **Source.** Settings → **Source** → branch `main`. Leave **Root Directory** empty.
5. **Networking.** Do **not** press "Generate Domain". The worker must have no public address: only the site reaches it,
   over the private network, and Railway gives every service `world-worker.railway.internal` automatically.
6. **Volume.** On the canvas: **+ New** → **Volume** → attach it to `world-worker`:
   - **Mount path:** `/data`;
   - **Size:** 20 GB.

   If your plan's maximum is smaller, note the size: it sets `WORLD_STORAGE_BYTES` in the next step.
7. **Variables.** `world-worker` → **Variables** → **Raw Editor**. Paste these lines exactly, then save:

   ```
   PORT=8080
   WORLD_SITE_PASSCODE=${{shared.WORLD_SITE_PASSCODE}}
   WORLD_STORAGE_BYTES=19000000000
   WORLD_CPU_THREADS=4
   ```

   - **`WORLD_STORAGE_BYTES`:** a little below the volume size, in bytes.
     - 20 GB volume: `19000000000`;
     - 10 GB: `9000000000`;
     - 8 GB: `7000000000` (the minimum: each job reserves 4 GiB beside its video, up to 2 GiB).
   - **`WORLD_CPU_THREADS`:** the vCPUs Railway gives the service (Settings → Resources). More threads make each job
     faster, but don't set it above what the service has.
8. **Deploy.** Press **Deploy** (or **Redeploy**). The first build takes 10–20 minutes, mostly downloading Blender
   (about 400 MB) and COLMAP. Later builds reuse the cached layers.
9. **What success looks like** in **Deployments → View logs**:
   - **Build log:**
     - `FROM ubuntu:24.04`;
     - `pip install ... bpy==4.2.23`;
     - finally `Successfully built` / `Build complete`.
   - **Deploy log**, ending with:

     ```
     INFO:     Started server process [..]
     INFO:     Application startup complete.
     INFO:     Uvicorn running on http://[::]:8080 (Press CTRL+C to quit)
     ```

   - **Status:** the service shows **Active** with a passing health check (`/healthz`).
10. **What failure looks like:** see the troubleshooting table below. The most common one is the config file path from
    step 3.3.

## Part 4: Point the site at the worker (2 minutes, then about 3 minutes of redeploy)

1. Open the **existing** site service (the one that serves brainsnn.com) → **Variables** → **Raw Editor**.
2. Add these two lines, leaving everything else as it is, then save:

   ```
   WORLD_WORKER_INTERNAL_URL=http://world-worker.railway.internal:8080/
   WORLD_SITE_PASSCODE=${{shared.WORLD_SITE_PASSCODE}}
   ```

   - It is `http`, not `https`: the private network is already encrypted.
   - Keep the port `8080` and the trailing slash.
3. Railway redeploys the site. Wait for **Active**.
4. **Check:** <https://brainsnn.com/api/world/processing> now reads:

   ```json
   {"available":true,"passcode":true,"visitors":false,"visitorJobsPerDay":null}
   ```

## Part 5: Check it works (5 minutes)

### On your phone

1. Open <https://brainsnn.com/world/>.
2. Tap **Choose walkthrough video** → **Choose Files**, and pick a short video (any 5–30 s walk round a room).
   - On iPhone, the fast route skips Photos' conversion: in Photos, Share → **Save to Files** first.
   - The status line reads "Walkthrough ready …".
3. Open **Process a walkthrough / use an API worker** → tap **Process on BrainSNN**.
4. In the dialog, type the passcode → **Use BrainSNN processing**. The dialog closes and the status reads
   "BrainSNN processing connected. Tick the consent box, then Process all capture files."
5. Engine: **Multi-view spatial reconstruction (CPU)**, which is already selected → tick **I approve sending …** →
   **Process all capture files**.
6. **Wait.** The upload goes first, then the job:
   - a 10 s video takes about 2 minutes;
   - a 2-minute video several minutes (about 140 frames).
7. **Success:** "Reconstruction loaded. Compare with the source; …" and a point cloud you can orbit.
   - "This reconstruction contradicts its own frames: the room is likely folded onto itself" is the fold check: process
     it again, or re-film (Part 6).

### From a computer, without a browser

Run this from a checkout of the repository. It needs Python 3.10 or newer and nothing else:

```sh
python3 scripts/world-demo/site_processing_check.py --site https://brainsnn.com
# asks for the passcode without echo (or reads BRAINSNN_PASSCODE); prints PASS/FAIL per step:
#   PASS  site says processing is set up
#   PASS  passcode opens a session
#   PASS  worker answers through the site  owner site-owner, engines ['colmap-sparse', 'scene-usd']

python3 scripts/world-demo/site_processing_check.py --site https://brainsnn.com --video ~/Desktop/garage.mov --scene
# uploads, reconstructs, downloads every result through the site with its SHA-256 checked, and prints, for example,
#   frames 140, registered 138, points 21000, reprojection 0.80 px, fold check consistent
# results go to ./brainsnn-check-<time>/ (never into the repository)
```

Exit codes:
- **0:** everything passed;
- **1:** a step failed, and the FAIL line says which;
- **2:** the site is not set up yet (Part 4).

## Part 6: The first real capture (the garage)

**Film** (about 10 minutes):
- Phone in **landscape**, 1080p or 4K, 30 fps, lights on.
- **Walk the walls first:** about 1 m from each wall, camera level, slowly (a step a second), so every wall is seen floor
  to ceiling. Then cross the middle once. Never spin on the spot.
- 60–120 s for one garage; at most 5 minutes and 2 GB.
- Keep people, mirrors and moving things out of frame. Corners, doors and fixtures in view help. Blank walls do not.

**Measure** with a tape or laser, and write each down with what it is between:
1. **Calibration:** one long wall, end to end. This is the one you type into the site.
2. **Withheld checks:** a door width and one fixed object (the cart's length, a workbench). Do not type these in to
   scale anything: they are how you find out whether the model is right.

**Process and scale:**
1. Process the video as in Part 5.
2. In the cloud, tap the two ends of the measured wall and type its length. The site now uses metres.
3. Press **Build metric simulation scene (GLB, USD, IFC) →**. This runs the scene engine on the measured cloud.
4. **Read the "Fit" line** in the scene dialog, and compare your withheld measurements with the model's:
   - **2 cm or less on a few metres:** good;
   - **10 cm or more:** re-film.

**Send back** (to whoever asked; never the passcode):
- frames registered of frames sampled;
- the fold check status;
- processing time;
- the three tape readings, and the model's value for each;
- the Fit line.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `/api/world/processing` says "Not found" | The site has not deployed #248 yet | Wait for "Verify BrainSNN live deploy" (Part 1) |
| `"available":false` after Part 4 | A site variable is missing, misspelt, or the passcode is under 12 characters | Check both lines in Part 4 and the shared variable; the site redeploys after a change |
| No "Process on BrainSNN" button | The page loaded before the site redeployed | Reload the page |
| "Wrong passcode." | Typo, or the shared variable differs between services | Both services must reference `${{shared.WORLD_SITE_PASSCODE}}` |
| "Too many wrong passcodes. Try again in an hour." | Ten wrong tries from your connection within an hour | Wait an hour, or redeploy the site (sessions and counters reset) |
| "BrainSNN processing is unavailable right now." (502) | The site cannot reach the worker | Worker Active? `PORT=8080` on the worker? URL exactly `http://world-worker.railway.internal:8080/`? Service named `world-worker`? |
| "Unauthorized." from the worker, or the check script's step 3 fails | The two services derive different credentials | The same passcode on both (shared variable), then redeploy **both** |
| Worker build log shows `vite build` / `node dist/server.cjs` | The root `railway.toml` was used | Step 3.3: config file `/robotics/world_worker/deploy/railway/railway.toml` |
| Worker log: `Set WORLD_SITE_PASSCODE (12 characters or more …)` | The worker cannot see the passcode | Step 3.7's `WORLD_SITE_PASSCODE` line, and the shared variable in production |
| Worker log: `WORLD_STORAGE_BYTES must be at least 6979321856 …` | The budget cannot hold one job: the 4 GiB job reservation plus its video | An 8 GB or larger volume, and step 3.7's table. A value that is not a plain number is ignored, and the worker assumes 20 GB |
| Worker log: `could not bind on any address` | The environment has no IPv6 | Add `WORLD_WORKER_HOST=0.0.0.0` on the worker. Newer Railway environments resolve internal names over IPv4 too |
| "Upload quota reached" / "Owner upload quota reached" | Old uploads still within their 24 hours | Wait, or remove the volume's `/data/worker` contents from a Railway shell |
| "Views could not be aligned …" | Too little overlap or texture in the video | Re-film: slower, walls first, more corners in view |
| "…the room is likely folded onto itself" | COLMAP matched repeated surfaces to each other | Process again (COLMAP is not deterministic), or re-film with more distinct views |
| A job ends `failed` after an hour | The 3600 s limit; a 5-minute 4K walk on 2 threads can reach it | More vCPUs and `WORLD_CPU_THREADS`, or a shorter or 1080p video |

## Part 8: Running it

- **Change the passcode:** edit the shared variable, then redeploy **both** services. Old sessions end.
- **Open it to visitors:** on the site service only, add `WORLD_SITE_VISITORS=1`. Optionally also add
  `WORLD_SITE_VISITOR_JOBS_PER_DAY` (default 2 per connection) and `WORLD_SITE_VISITOR_JOBS_TOTAL` (default 20 a day in
  all).
  - Visitors then see "Use BrainSNN processing" with no passcode needed.
  - Their files stay on your volume for up to 24 hours, so add that to the site's privacy note first.
- **Pause it:** remove `WORLD_WORKER_INTERNAL_URL` from the site, and the button disappears. Stop the worker service as
  well to stop its costs.
- **Costs:** Railway bills the worker's CPU time and the volume. Each job is CPU-bound for its whole run.
- **Updates:** a merge to `main` that touches `robotics/world_worker/**` or `robotics/scene_compiler/**` rebuilds the
  worker (`watchPatterns` in its `railway.toml`).
- **Logs:**
  - the worker's deploy log shows each request;
  - each job's own log is `/data/worker/jobs/<id>/operator.log` on the volume.

## Security notes

- **Credentials:**
  - the passcode lives only in Railway's variables;
  - the worker writes SHA-256 hashes of the derived credentials, never the credentials;
  - its operator credential is new on every start, and nobody is given it.
- **Sessions:**
  - a browser session is a random 43-character value, held in page memory and never in storage;
  - it ends after 12 hours (visitors: 2), or when the site restarts.
- **Isolation:**
  - each session reaches only the uploads and jobs it created;
  - a job created but not started within 2 minutes (a closed tab) is cancelled, so it cannot hold the worker's one
    active slot;
  - job listings are refused;
  - download links are signed by the worker, last 60 seconds, and need no session.
- **No public address:** the worker has none. Everything reaches it through the site.
