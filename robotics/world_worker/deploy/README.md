# Running the worker for brainsnn.com

brainsnn.com is served over HTTPS, so the browser can only call a worker that has a valid certificate. That worker also
needs a hostname that stays the same between restarts. A quick tunnel works for a test, but its URL changes on every
restart. This folder holds a setup for a long-running worker on a GPU host such as the GB10.

1. **Service account and state.** Create a `brainsnn-worker` user without a login shell. Make
   `/var/lib/brainsnn-world-worker` writable by it, and nothing else. Check out the repository at the commit you
   qualified, and install `robotics/world_worker/requirements.txt` into its own virtual environment.
2. **Settings.** Copy `world-worker.env.example` to `/etc/brainsnn/world-worker.env` (mode 600). Generate the token
   there, and point `WORLD_ADAPTERS_FILE` at the reviewed adapters, for example a copy of `adapters.gb10.json`.
3. **Service.** Install `brainsnn-world-worker.service` and adjust its paths. It listens on `127.0.0.1:8010` only.
4. **Hostname and TLS.** Use a Cloudflare named tunnel (`cloudflared.example.yml`), or a reverse proxy with a
   certificate, in front of `127.0.0.1:8010`.
5. **Check it from outside** with the token in the environment:

   ```sh
   WORLD_WORKER_TOKEN=... python -m robotics.world_worker.check_worker \
     --url https://world-worker.example.com --require scene-usd:video,cloud --upload-probe
   ```

   The worker passes when every line reads PASS:
   - a valid certificate;
   - `/healthz` answers;
   - a request without the token is refused;
   - the required engines are offered;
   - browser calls from brainsnn.com are allowed and calls from other sites are not;
   - an upload chunk passes through the proxy (the probe uploads a tiny image, then deletes it).

   Add `--require mapanything-apache` once the dense engine is configured.
6. **Hand over.** Send the owner the URL and the token directly, never through the repository. In World Builder, use
   Capture → Process a walkthrough / use an API worker → Worker connection.

Adapters run as child processes of this service. Systemd does not isolate them from each other, so keep the
per-adapter guards (memory, time, output size) in place.

## Enable dimensional checks and reviewed BIM openings

Deploy the browser, worker and scene compiler from the same qualified revision. The `scene-usd` entry in the supplied
adapter examples declares `dimension_checks: true` and `bim_review: true`; copy those boolean fields only after the
matching code and dependencies are installed. Older workers omit the capabilities and the browser requests an
upgrade. A capability declaration is not evidence of successful execution.

Use an actual Blender executable with the scene compiler's dependencies, including IfcOpenShell for IFC and
`requirements-cad.txt` for CAD. Run the tests in [the demo acceptance checklist](../../../docs/world-demo-release-checklist.md),
then perform an authenticated cloud job and inspect the resulting `scene-measurements.json`, IFC and matching visual
exports. Reviewed openings must cut the same host wall across formats. Retain the input/output hashes and failures.

The browser recompiles a reviewed opening using the previous same-owner scene job as `source_job`. Unchanged cloud
points and scale allow the adapter to reuse that job's exact `object-names.json`, with a reuse receipt and no new model
call. It never upgrades unreviewed name suggestions into approvals. A different source, point order, scale or host
snapshot requires a new review. Contract and placement details are in [BIM review](../../../docs/world-bim-review.md).
