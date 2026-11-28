# Site-to-sim pilot: offer, statement of work and acceptance

The first thing BrainSNN sells: one real site, captured with a phone, delivered as a checked, metric scene a mobile-robot
team can load into its own simulator and planner. Sold as a fixed-fee, prepaid pilot and invoiced by hand from the usage
meter. Basis: [the Nov 24 research](../research/brainsnn-best-next-move-2026-11-24.md) and the claims sheet in
[world-builder-handoff.md](../world-builder-handoff.md#what-you-can-and-cannot-claim).

## The offer (one page, for prospects)

**For:** teams that deploy mobile robots (AMRs, delivery, inspection, cleaning, security) into customer buildings and need
to know, before the robot ships, whether it fits and where it can drive.

**You send:** a phone walkthrough video of one site (or photos), one tape-measured distance for scale, and at least three
more tape readings we hold back to check the result. Capture with any phone camera, or with BrainSNN Walk.

**You get, within 48 hours of a usable capture, through your own API key:**

| File | What it is | What it is not |
| --- | --- | --- |
| `scene.glb`, `scene.usda` | Metric scene: floor, walls, openings and furniture as boxes | Not a photoreal or manipulation-ready scene (boxes at 3-6 cm) |
| `scene.ifc` | IFC4 for BIM software | Not native Revit; validate in your target application |
| `scene-plan.dxf`, `scene.3dm`, `quantities.csv` | Plan, Rhino model and quantities | Not LOD 300; no MEP |
| `nav2-map.pgm` / `.yaml` / `.json` | Occupancy map in the Nav2 map format, with byte hashes | Format tested; a live Nav2 run is yours to confirm |
| `fit-check.json` | Every reconstructed point checked against the model; misfits flagged | Model-to-points fit, not real-world accuracy |
| `scene-measurements.json` | Your scale span and held-out readings, with the error at each | The only real-world accuracy figure, and it is measured on your site |
| Route report | Your robot's footprint routed through the model: blocked doorways, tight turns | A planning preview, not execution or safety certification |

**How you know it is right:** the held-out tape readings. We report the error at each one, median and worst, before you
pay for anything beyond the pilot. If a capture cannot be reconstructed, we say so and ask for a recapture; we do not fill
gaps.

**Price:** fixed fee per site, prepaid, credited in full toward a site package signed within 30 days. The per-site price
after the pilot is written into the statement of work before work starts.

**Not included:** photoreal splats, articulated objects, physics properties beyond static colliders, robot policy
evaluation, on-site visits.

## Statement of work (template)

> **Statement of work: site-to-sim pilot**
>
> **Parties:** BrainSNN (invoicing entity: _[owner to set]_) and _[Customer]_.
> **Site:** _[address / site name]_, approximately _[m²]_, captured by _[customer / BrainSNN]_ on _[date]_.
> **Robot:** _[model]_, footprint _[w × d m]_, clearance margin _[m]_, max speed _[m/s]_.
>
> **Deliverables** (through the customer's API key, project _[id]_): the files in the offer table above, plus a short
> summary of the held-out error and the route findings.
>
> **Timeline:** delivery within 48 hours of receiving a usable capture. Pilot ends _[start + 30 days]_.
>
> **Success metric (one):** _[for example: median held-out error at or below X cm and worst at or below Y cm on the
> customer's readings; X and Y set from BrainSNN's published real-room result]_.
>
> **Fee:** _[USD 3,000-5,000; owner to set per prospect]_, prepaid on signature. Credited 100% toward a site package
> signed by _[pilot end + 30 days]_.
> **After the pilot:** _[N]_ sites at _[USD per site]_, or _[monthly]_ for _[scope]_. Decision date: _[date]_.
>
> **Data:** capture files are stored in BrainSNN's object storage under the customer's project, used only to produce the
> deliverables, and deleted on written request within _[7]_ days (manual procedure; the API has no delete endpoint yet).
> Processing runs on a shared worker without per-customer process isolation; no other customer can read the project.
>
> **Limits:** everything in "What it is not" above. No claims of survey-grade, millimetre, native Revit, LOD 300 or
> manipulation-ready output.

## Running a pilot (operator steps)

1. **Before signature:** confirm the site, robot and success metric; send the SOW; invoice from the agreed entity.
2. **Provision:** issue the customer's project key the same way the `pilot-owner` tenant was provisioned (worker tenant
   digest and limits, then site bootstrap). Target: under an hour. One active pilot at a time on the shared CPU slot.
3. **Capture check:** reject captures without the scale span or with fewer than three held-out readings, before
   processing.
4. **Process:** reconstruct, then `scene-usd` with the measured span ([handoff steps](../world-builder-handoff.md)).
   Review openings and the route in World Builder before delivery.
5. **Deliver:** artifacts through the customer's key, plus the held-out error summary. Export the usage CSV.
6. **Record:** analyst minutes, failed captures, held-out error, time from capture to delivery.

## Real-room acceptance (do this before the first outreach email)

The repository's launch checklist leaves the metric acceptance unticked
([processing setup](../brainsnn-processing-setup.md#remaining-acceptance-checklist)). Until it is done, the only accuracy
figures are synthetic or dataset results, and they must be labelled that way.

1. Pick one permitted room or corridor. Tape-measure one long span (the scale) and at least three others (held out);
   write them down before capture.
2. Walk it with a phone (Walk, or the camera app), steady, with overlap; include the measured spans in view.
3. Run it through the `pilot-owner` tenant to a metric scene; enter the scale span only.
4. Enter the held-out readings; download `scene-measurements.json`, `fit-check.json`, the Nav2 map and the exports.
5. Publish the median and worst held-out error as measured, even if disappointing, with the room type and capture time.
   That result sets the success metric in every SOW.

## Safe database restore drill

Railway's backup tab restores **in place and overwrites production**; do not use it for the drill. Instead:

1. In the Railway dashboard, open the Postgres volume's **Backups** tab and confirm a schedule exists (enable daily if
   not). Nov 24: the volume config shows no schedule, and no tool here can list backups.
2. Create a separate test Postgres service from the template; do not attach it to production.
3. From a machine with `pg_dump`/`psql`, dump production read-only into the test service; compare row counts on the
   key tables (projects, uploads, jobs, usage, waitlist).
4. Delete the test service. Record the date and counts.
