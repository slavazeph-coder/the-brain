# Week 1: owner-only steps (25 Nov - 1 Dec)

These need your accounts or your hands. Everything else in the plan is ready in this folder.

| # | Step | Where | Why it blocks selling |
| --- | --- | --- | --- |
| 1 | Rotate the Anthropic key that was pasted in chat; set the new one only in the worker environment | console.anthropic.com, then Railway variables | A leaked key can be used against your account |
| 2 | Point the bare domain at Railway: at your DNS provider, replace the forwarding records for `brainsnn.com` with a CNAME (ALIAS/ANAME or "flattened" CNAME at the apex) to `tnoamdbj.up.railway.app`. If your provider cannot do that at the apex, turn on "forward with path" to `https://www.brainsnn.com` instead | Registrar / DNS | Nov 24: `brainsnn.com/` redirects but every deeper link (`brainsnn.com/walk/`, `brainsnn.com/world/api.html`) is a 404 from the forwarder, so links without `www` break. Railway already has the domain verified and is waiting for this record |
| 3 | Check backups and run the safe restore drill | Railway dashboard, Postgres volume, Backups tab; then [the drill](site-to-sim-pilot.md#safe-database-restore-drill) | No customer upload until data can be recovered |
| 4 | Test Walk and a World Builder upload on a physical iPhone and an Android phone | Your phones | Never tested on real devices |
| 5 | Run the real-room acceptance and publish the held-out error | [Acceptance steps](site-to-sim-pilot.md#real-room-acceptance-do-this-before-the-first-outreach-email) | The offer's proof; also sets the SOW success metric |
| 6 | Choose the invoicing entity and price range for the first pilot | You | The SOW and invoice need both |
| 7 | Export the API waitlist (World passcode session, `GET /api/world/waitlist/entries`) and email each entry personally | brainsnn.com | Warmest possible leads |
| 8 | Extend [targets.csv](targets.csv) to 150 named companies, verify each is still operating, find the right person, and start outreach with [the templates](outreach.md): 200 founder-signed touches by 8 Dec | Email, LinkedIn | Gate 2 of the 30-day plan |

Checkpoint Tue 1 Dec: restore succeeded; real-room pack published; SOW and price set; at least 150 named targets;
first non-owner `front_door_viewed` events in the event sink.

Already done (Nov 24): PR #338 merged and live (three-door homepage, Creative Engine at `/app`, Agent Lab, UI fixes);
the site-to-sim pilot offer is on `/world/api.html`, and "Request a site pilot" opens the existing waitlist form with
"Phone scan to robot simulation" pre-selected.
