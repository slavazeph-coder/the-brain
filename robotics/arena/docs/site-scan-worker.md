# Connect a private site scan worker

Turn a short phone walkthrough or overlapping photographs into a real, reviewable 3D reconstruction. This worker runs on your own Linux machine and connects directly to BrainSNN Arena. The website does not receive or store your capture or access token.

The bundled path is **FFmpeg + COLMAP sparse reconstruction**. It extracts camera positions and colored 3D points from the uploaded images. A separately installed, pinned NVIDIA 3DGRUT adapter can produce an additional Gaussian visual export. Neither path invents a finished floor map, collision mesh, robot controller or successful AI run.

## What is available

- Input: MP4/MOV video, 2–180 seconds, or a ZIP of 8–120 JPEG/PNG photos. Maximum upload is 256 MiB. HEIC photos need conversion to JPEG first.
- Output: private `scan.json`, `point-cloud.json` and `sparse.ply` downloads. Optional `visual.ply` and `visual.usdz` are visual exports for external tools.
- Preview: at most 50,000 colored points for the browser. COLMAP coordinates have arbitrary scale and orientation. The preview is visual context; drawing a reviewed map is a separate step.
- Required review: confirm metric scale using a known distance, align the ground plane, inspect missing areas and author the navigable floor and obstacles.
- Capacity: one upload or reconstruction at a time; three retained jobs, 3 GiB per job, 5 GiB total monitored storage, a 30-minute reconstruction budget and 24-hour retention. Delete a scan to release its files earlier.
- Privacy: a dedicated private directory with mode 0700, exact browser origins, bearer authentication and no public artifact URLs. A worker restart discards old captures. A process lock prevents two workers from owning the same store.

These limits are conservative defaults, not a benchmark. Filesystem quotas or a bounded container volume should also cap disk usage because subprocess monitoring runs periodically. Run this service under a dedicated unprivileged account with no unrelated sensitive files or credentials. One worker access token grants access to every job on that worker; this is a private operator service, not a multi-tenant public upload endpoint.

## Capture a usable space

Walk slowly around one well-lit space, keeping adjacent views overlapping. Include walls, floor boundaries, doorways and stationary details. Avoid fast pans, reflective surfaces and moving crowds. Record a real distance, such as the width of a doorway, for later scale confirmation. Do not assume a scan of glass or a plain white wall is complete.

The worker rejects unreadable, blank and very dark frames. Reconstruction can still fail if images lack overlap or texture. A completed reconstruction means cameras and points were calculated, not that the floor or robot behavior has been validated. The manifest flags low camera registration.

## RTX 4090 setup

Preserve the existing BrainSNN inference services on ports 8000/8787 and the robot worker on 8081. This service uses **127.0.0.1:8082**. Inspect GPU memory, disk space and existing processes before installing or starting anything. Queue reconstruction separately from large model inference until measured memory use proves they can coexist. This kit does not rent compute, install weights or change existing services.

Use Python 3.11 on Linux. From the repository's `robotics/arena` directory, or the extracted kit root:

```bash
python3.11 -m venv .venv-site-scan
.venv-site-scan/bin/pip install -r workers/site_scan/requirements.txt
.venv-site-scan/bin/pip install httpx==0.28.1
.venv-site-scan/bin/python -m unittest discover -s tests -p 'test_site_scan*.py' -v
```

Install FFmpeg, FFprobe and COLMAP using their official instructions. Build COLMAP from a recorded source revision. The integration uses `feature_extractor`, `sequential_matcher` or `exhaustive_matcher`, `mapper`, and `model_converter`. Its CLI must support these commands and the SIMPLE_RADIAL camera model. Verify the binary against a real capture on your machine before relying on it.

A reviewed upstream COLMAP source snapshot is `6db3867f60771f34fa66d166dcc00fee7d5c6dc0`. Record the actual commit used for your build. The manifest includes the installed binary's SHA-256 and an explicitly operator-attested source revision; it cannot prove that the binary was compiled from that revision.

Copy `workers/site_scan/.env.example` to a private file outside the repository. Set a random token of at least 32 characters, a dedicated empty data directory and the installed tool paths. Do not paste the token into issues or commit it. Load the environment using your existing service manager, then start:

```bash
.venv-site-scan/bin/uvicorn workers.site_scan.app:create_app --factory --host 127.0.0.1 --port 8082 --workers 1
```

Start with `BRAIN_SITE_ENABLED=0`. The authenticated capabilities response will list missing dependencies. Set `BRAIN_SITE_ENABLED=1` only after installing the tools and validating their operation. A capability marked available means the prerequisites are configured and the worker can accept a reconstruction attempt; it is not proof of an earlier GPU run.

Expose port 8082 only through your existing trusted HTTPS reverse proxy if connecting from the public website. Keep the worker itself bound to loopback. Use an exact allowed origin, normally `https://www.brainsnn.com` or `https://brainsnn.com`. The browser's Worker URL is the HTTPS base URL and its token remains in memory. Do not invent DNS settings or expose a raw unauthenticated GPU port.

## Optional 3DGRUT visual export

Sparse COLMAP reconstruction works without this step. NVIDIA 3DGRUT adds a trained visual representation. It requires a separate compatible CUDA/PyTorch environment and substantially more compute. Install from NVIDIA's instructions and review its license before commercial deployment.

The provided adapter targets source commit `e6f4552b408af020a96de09ab5757f9b57430aaa`. It refuses a different HEAD or modified tracked checkout. It calls the pinned `apps/colmap_3dgut.yaml` training configuration, enables PLY and USD export, and copies a completed PLY export to `visual.ply`. If the upstream run also creates a USDZ package, it is offered as `visual.usdz`. It does not convert a Gaussian export into collision geometry. USD/ParticleField output is not directly rendered by the current browser viewer.

Set these operator-controlled values in the service environment:

```text
BRAIN_SITE_VISUAL_ADAPTER=/absolute/path/robotics/arena/workers/site_scan/3dgrut_adapter.py
BRAIN_SITE_VISUAL_ADAPTER_SHA256=<sha256 of that exact local adapter file>
BRAIN_SITE_3DGRUT_ROOT=/absolute/path/to/pinned/3dgrut
BRAIN_SITE_3DGRUT_PYTHON=/absolute/path/to/3dgrut-env/bin/python
BRAIN_SITE_3DGRUT_REVISION=e6f4552b408af020a96de09ab5757f9b57430aaa
```

No browser request can choose a command, executable, filesystem path or source URL. Every subprocess uses an argument array without a shell. MP4/MOV decoding forces the MOV demuxer, disables external data references and permits local file/pipe protocols only. ZIP files are decoded into generated names and are bounded by file count, byte size, compression ratio and pixel count.

The optional adapter has not been executed on the target 4090 in the website implementation environment. Validate a small sample, inspect the exported file and measure peak VRAM before enabling it for users. If it exceeds the worker budget, keep sparse reconstruction enabled while tuning the optional pipeline in isolation.

## Browser API contract

API requests require `Authorization: Bearer <worker token>`, except the native download POST described below, which consumes a single-use ticket. Requests carrying an Origin must exactly match the configured allowlist. CORS permits only GET, POST and DELETE plus Authorization, Content-Type and X-Filename headers. Responses use `Cache-Control: private, no-store`.

- `GET /v1/site-scans/capabilities`: `{version:1, available, missing, acceptedTypes, maxUploadBytes, maxImages, maxVideoSeconds, retentionSeconds, requiresReview:true}`.
- `POST /v1/site-scans`: raw file bytes, an accepted Content-Type and optional URL-encoded X-Filename. The service streams to private storage with a byte limit even when Content-Length is absent. Returns HTTP 202 and the job state.
- `GET /v1/site-scans/{id}`: `{version:1, id, status, stage, progress, error, artifacts, requiresReview:true}`. Progress is 0–1. Status is uploading, queued, running, complete, failed or cancelled. A finished scan still requires geometry review.
- `GET /v1/site-scans/{id}/artifacts/{name}`: authorized file download. Only artifacts listed on a completed job can be fetched. Original capture, command logs and COLMAP working files are never exposed by this route.
- `POST /v1/site-scans/{id}/artifacts/{name}/download-ticket`: bearer-authenticated issuance of `{version:1,ticket,expiresInSeconds:60}` for one artifact. Tickets are random, single-use, held only in worker/browser memory, and bounded to 128 outstanding tickets per worker.
- `POST /v1/site-scans/{id}/artifacts/{name}/download`: native browser download with an `application/x-www-form-urlencoded` body containing only `ticket`. No bearer token, cookie or credential URL is needed. The worker atomically consumes the ticket, rechecks the completed artifact and streams an attachment from disk. Explicit foreign/null origins, expired/replayed tickets, a mismatched artifact, or a deleted job cannot download. Form bodies are limited to 1 KiB and 10 seconds.
- `DELETE /v1/site-scans/{id}`: cancels work and deletes the job. Child processes are killed as a group. The old job ID stops resolving immediately; processing files are removed when its worker exits.

### Saving large artifacts

Artifact downloads and browser previews have separate budgets. `point-cloud.json` and other JSON responses remain bounded to 8 MiB in the page; worker error bodies are bounded to 64 KiB. Full artifacts can be saved up to the smaller of 3 GiB and the configured per-job storage limit, without collecting the full file in JavaScript memory.

- Browsers exposing `showSaveFilePicker` open the save dialog directly from the Download click. The page reads one network chunk, waits for its disk write, then reads the next chunk. It checks actual bytes even without Content-Length, verifies artifact size when supplied, and closes the file only after a complete response. Progress appears in Capture. **Cancel download**, disconnecting, reconnecting, deleting the job or leaving the workspace aborts the transfer and requests disposal of the temporary file. Slow disks may finish their current write before cleanup; final file commit cannot be undone after it completes. A resettable 60-second inactivity deadline replaces the short JSON request deadline for this path.
- Other browsers use the updated worker's `artifactDownloads.nativePost` capability. Click Download, then **Save in browser** within 60 seconds. The second click submits a private, one-use ticket to the same worker in a new tab; the browser download manager handles streaming, completion and cancellation. Arena reports a handoff, not a completed save. Check the browser for transfer failures; HTTP errors open in the new tab. Download again to obtain a fresh ticket after failure. The long-lived bearer token never appears in the form, URL, download filename or report. No resumable ticket replay is offered.
- When using the public HTTPS website, native downloads require an HTTPS worker. A browser may send an opaque Origin for a form posted to HTTP localhost, which the worker deliberately rejects. Chrome/Edge direct-to-disk saving remains available for localhost development.
- Older workers without the ticket capability remain compatible: direct-to-disk saving still works. A browser without that disk API can save only bounded downloads up to 64 MiB until the worker is updated with the latest kit. A larger or unknown-length overflow fails with guidance instead of allocating a multi-GiB Blob.

The capabilities response includes `artifactDownloads: {nativePost:true,maxArtifactBytes}`. Keep authorization headers on API requests, reject redirects, and use the locally constructed artifact path, never an arbitrary artifact URL returned by a job. Native form submissions intentionally use `rel="noopener"` without `noreferrer`: a cross-origin POST with a no-referrer policy can acquire an opaque Origin and be rejected. Tickets are never placed in query strings. CORS exposes Content-Encoding so decoded response bytes are not incorrectly compared to a compressed Content-Length.

Regression tests exercise virtual 3 GiB browser streams with a reusable chunk and sparse worker files without allocating a 3 GiB buffer. They cover backpressure, size enforcement, authentication, bounded errors, network/disk failures, cancellation, stale UI operations, ticket scope/expiry/replay and worker disconnects. Real save-picker and native browser download UI behavior should also be smoke-tested in the target browsers; CPU and DOM fixtures do not validate those browser surfaces.

Errors return `{version:1,error:{code,message}}`. Unconfigured pipelines return 503; an active upload/reconstruction returns 409; size limits return 413; exhausted job count returns 429. Expired or deleted jobs return 404.

`point-cloud.json` uses `{version:1, kind:"colmap-sparse-point-cloud", units:"arbitrary", coordinateFrame:"colmap", points:[[x,y,z,r,g,b], ...]}`. XYZ are finite numbers in the reconstruction's frame; RGB values are integers 0–255. These points must never be silently treated as meter-scaled collision geometry.

## Validate before offering a customer scan

1. Run the CPU test suite and confirm authentication, origin rejection, overflow, deletion and expiry.
2. Reconstruct one consented, measured space with COLMAP on the real worker. Verify camera registration, non-empty points, source hash and known dimensions after review.
3. Open the actual point cloud in BrainSNN, confirm orientation, review the floor and mark obstacles. Keep uncertain regions explicit.
4. Delete the scan in the UI and verify its files and artifact endpoint are gone. Start a second scan, cancel it and verify processes stop.
5. Record peak VRAM, duration, storage and failure cases. Do not report a robot-policy result until an independently compatible simulation worker actually consumes the reviewed scene in its sensors and physics.

The current Panda π0.5/LIBERO worker and G1/GR00T catalogue entries do not automatically accept customer scenes. Their separate, exact scene and policy contracts must be implemented and validated before calling this a real G1 or learned-policy trial. The browser's measured-space route preview remains a planning approximation.

## Prompt for the agent on your 4090

```text
Pull the current main branch of slavazeph-coder/the-brain and read
robotics/arena/docs/site-scan-worker.md. Implement the private site scan
worker setup on this RTX 4090 machine. Inspect existing processes, GPU
memory and services first; preserve ports 8000, 8787 and 8081. Use a
separate Python 3.11 environment and loopback port 8082. Keep secrets
outside the repository. Install and record the required FFmpeg/COLMAP
versions, run the CPU contracts, then reconstruct one real, measured
phone capture and verify its actual points and provenance. Connect the
worker to BrainSNN through the existing trusted HTTPS arrangement;
do not invent DNS or expose a raw GPU port. Test authenticated upload,
opening the reconstruction, cancellation and deletion. Start with
sparse reconstruction; validate the optional 3DGRUT adapter separately
before enabling it. Report commands, measured VRAM/time and remaining
blockers. Never label a scan preview as GR00T or physics execution.
```

## Official references

- [COLMAP command line and reconstruction pipeline](https://colmap.github.io/cli.html)
- [COLMAP output formats](https://colmap.github.io/format.html)
- [NVIDIA 3DGRUT installation and training](https://github.com/nv-tlabs/3dgrut)
- [NVIDIA 3DGRUT export formats](https://github.com/nv-tlabs/3dgrut/tree/main/threedgrut/export)
- [Apple RoomPlan dimensional capture](https://developer.apple.com/augmented-reality/roomplan/)
