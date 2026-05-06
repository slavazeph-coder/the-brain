# Recording Day Prep — TechEx MP4

Use this checklist on recording day (target: May 17, 2026). Goal:
ship a 5-min MP4 ≤ 100 MB at 1080p that walks through all 5 tracks
on `brainsnn.com` per [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## ~T-30 min: environment

- [ ] Mac plugged in to power (avoids thermal throttling and dimming)
- [ ] Wi-Fi swap to wired ethernet if available; phone hotspot ready
      as backup
- [ ] All other apps quit (Slack, Mail, Calendar, etc.)
- [ ] System sound notifications muted (System Settings → Notifications
      → Do Not Disturb on)
- [ ] System sound output: external speakers OK, but route demo audio
      (robot voice prompts) through the same speaker stack so the mic
      can pick it up cleanly during the Layer 59 beat
- [ ] Camera covered (no accidental webcam in screen recording)
- [ ] Set screen resolution to 1440 × 900 (or whatever 16:9 your
      Mac supports natively at 100% scaling — mixed scaling causes
      blurry capture on retina displays)

## ~T-25 min: browser setup

```bash
# Quit Chrome cleanly
killall "Google Chrome"

# Launch Chrome with a clean profile so plugins / autofill / saved
# tabs don't bleed into the recording
open -na "Google Chrome" --args \
  --user-data-dir=/tmp/brainsnn-recording-profile \
  --window-size=1440,900 \
  --window-position=0,0 \
  https://brainsnn.com
```

In the new Chrome window:

1. Open DevTools (⌥⌘I) → Console.
2. Paste:
   ```js
   localStorage.setItem("brainsnn-tour-dismissed", "true");
   localStorage.setItem("brainsnn-onboarding", "done");
   localStorage.setItem("brainsnn-quality", "high");
   localStorage.setItem("brainsnn-mode", "simulation");
   // Pre-warm intent classifier cache from materialized example
   const example = await fetch(
     "https://raw.githubusercontent.com/slavazeph-coder/the-brain/hackathon-techex/hackathon/cache/intent-scores.example.json",
   ).then((r) => r.json());
   localStorage.setItem(
     "brainsnn-firewall-intent-cache-v1",
     JSON.stringify(example),
   );
   location.reload();
   ```
3. Close DevTools (Cmd+Opt+I again). The reload re-renders without
   the tour modal.
4. Verify quality tier shows "high" in the hero strip; mode shows
   "Simulation".
5. Grant microphone permission **before** recording starts so no
   permission popover appears mid-take. Click Layer 59's `● Listen`
   once, allow mic, click `■ Stop` immediately.
6. Press F11 (or ⌃⌘F) to enter fullscreen — hides URL bar, tabs,
   bookmarks. Cleaner recording frame.

## ~T-20 min: corpus pre-stage

In a second Chrome tab (don't switch in the recording — switch via
keyboard if needed):

- Open `hackathon/demo-corpus/phishing/phishing-002-ceo-wire.md` in raw
  view on GitHub. You'll copy this body to paste into the firewall in
  Beat 1. Same for the other 5 anchor samples per
  [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

For Beat 2 (live audio scan), prepare three audio files in QuickTime
Player ready to play:

- `robot-001-warehouse-urgent.mp3` (legitimate urgent — for contrast)
- `robot-002-warehouse-coercive.mp3` (coercive — Beat 2 main)
- `robot-003-medical-soothing.mp3` (soothing — for contrast)

Generate audio from the corpus markdown via macOS `say` if you don't
have pre-recorded audio:

```bash
cd /Users/slavaz/the-brain/hackathon/demo-corpus/robot-prompts
for f in *.md; do
  body=$(awk '/^---$/{c++;next} c==2{print}' "$f")
  out="${f%.md}.aiff"
  echo "$body" | say -v Samantha -o "$out"
done
```

Use a soothing voice (`-v Karen`) for medical, an urgent voice
(`-v Daniel`) for warehouse-urgent, and a flat voice (`-v Alex`) for
warehouse-coercive to make the contrast easier to hear.

## ~T-15 min: OBS configuration

Recommended: OBS Studio (free, open-source, more reliable than
QuickTime for long captures).

1. **Settings → Output**:
   - Recording Format: MP4
   - Recording Quality: Indistinguishable Quality
   - Encoder: Apple VT H.264 Hardware (HEVC at the same quality is
     half the bitrate but iOS QuickTime sometimes can't preview)

2. **Settings → Video**:
   - Base Resolution: 1440 × 900 (your screen)
   - Output Resolution: 1920 × 1080 (upscale to 1080p target)
   - FPS: 30

3. **Settings → Audio**:
   - Sample Rate: 48 kHz
   - Desktop Audio: Enabled (captures the speaker output for the
     Layer 59 beat)
   - Mic / Auxiliary Audio: Enabled (captures your voice if
     narrating live; otherwise mute and add VO in post)

4. **Sources** (in order, top to bottom):
   - Display Capture (the Chrome fullscreen)
   - Audio Input Capture (Mic, muted unless live VO)
   - Audio Output Capture (Desktop Audio, for Layer 59 mic pickup)

5. **Hot keys** (Settings → Hotkeys):
   - Start Recording: ⌃⌘R
   - Stop Recording: ⌃⌘S
   - Pause Recording: ⌃⌘P (useful if a beat fails mid-take)

6. **Test recording**: hit ⌃⌘R, do something on screen for 5 seconds,
   ⌃⌘S. Check the output `.mp4` plays cleanly in QuickTime, audio is
   in sync, file size is reasonable (~2 MB per 5 seconds at 30fps
   1080p H.264).

## ~T-10 min: voice-over prep

Two options:

### Option A: live narration during screen capture

- Record narration in OBS at the same time as screen
- Pros: faster, no post-processing needed
- Cons: harder to hit exact timestamps; more retakes; mouth noise

### Option B: separate VO track

- Record narration in QuickTime (File → New Audio Recording) using
  the script in [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- Trim each beat to its target length
- Layer over screen capture in iMovie or DaVinci Resolve
- Pros: cleaner audio, easier retakes, polished pacing
- Cons: longer post-process time

**Recommendation: Option B**. Voice-over takes ~30 min to record
clean; layering takes ~20 min in iMovie. Total ~50 min vs. Option A
which can spiral if you have ambient noise or trip on words mid-beat.

Voice-over recording tips:

- Use the laptop's built-in mic at arm's length, NOT a USB mic with
  unknown gain settings (unless you've calibrated it before)
- Record in a quiet room (your bedroom closet is canonical)
- Record at peak -3 dB (most VO software shows the peak meter)
- Wear noise-isolating headphones to avoid echo
- Read the DEMO_SCRIPT verbatim; you can edit pacing in post but
  re-recording words is faster than a smooth on-the-fly read

## ~T-5 min: final pre-flight

- [ ] All Chrome tabs closed except the brainsnn.com tab
- [ ] Notification banner test: send yourself a Slack message and
      verify it doesn't show
- [ ] Cursor magnification on (System Settings → Accessibility →
      Display → Cursor Size: large) — judges can follow what you
      click much more easily
- [ ] Cursor highlight (Mouseposé or similar) — optional but
      reviewer-friendly
- [ ] Bezel.app or similar mouse-click visualizer ON — every click
      shows a subtle ripple. Helpful for the recording.
- [ ] Final corpus paste-clipboard test: copy phishing-002 body from
      the GitHub raw view, ⌘V into the firewall textarea, verify
      it pastes clean (no leading "—" character)

## ~T-0: roll

1. Hit OBS ⌃⌘R.
2. Wait 3 seconds (gives you a clean head you can trim).
3. Walk through DEMO_SCRIPT.md beat by beat. Don't pause between
   beats — keep mouse moving. Pacing matters more than perfection.
4. Hit ⌃⌘S at the end.
5. Save the raw recording somewhere outside `the-brain/` (e.g.,
   `~/Desktop/brainsnn-techex-raw-N.mp4`). You'll likely do 3–5
   takes; preserve all of them until the final cut is locked.

## Post-process

1. Import raw + VO into iMovie (or your editor of choice).
2. Trim head + tail.
3. Cut to 5:00 ± 0:15. If you're at 6:00, trim Beat 5 (Counter-Draft
   - Persona Simulator) — it's the easiest to drop without losing
     the arc.
4. Add lower-third title cards at:
   - 0:00 — "BrainSNN — Affective Intelligence for Online Content"
   - 0:18 — "BEAT 1 · Hybrid Cognitive Firewall · Security Track"
   - 1:30 — "BEAT 2 · Live Audio Scan · Physical AI Track"
   - 2:30 — "BEAT 3 · XIO-Evolve Arms Race · Agentic Workflows Track"
   - 3:15 — "BEAT 4 · Knowledge Brain · Data Intelligence Track"
   - 4:15 — "BEAT 5 · Persona Simulator · Enterprise Problem-Solving Track"
   - 4:45 — "Five enterprise faces · One engine · brainsnn.com"
5. Export H.264 1080p, target file size 80 MB (gives you headroom
   under the 100 MB lablab.ai limit).
6. Verify final file:
   - Plays cleanly in QuickTime + Chrome video tag (some iMovie
     exports won't seek properly in browser players)
   - Audio in sync across all 5 minutes
   - No silent gaps > 2 seconds
   - File size < 100 MB
   - Resolution 1920 × 1080 (right-click → Get Info)

## Backup plan: brainsnn.com is down

If Railway is unhealthy on recording day, fall back to localhost.
Audience won't know.

```bash
cd /Users/slavaz/the-brain
git checkout hackathon-techex
npm install --prefix brainsnn-r3f-app    # if not already
npm run dev --prefix brainsnn-r3f-app
# open http://localhost:5173 in Chrome (use the same recording
# profile, same fullscreen, same localStorage prep)
```

The URL bar is hidden in fullscreen mode, so the recording will look
identical to brainsnn.com. Same JS bundle. Same behavior.

If you want, you can hosts-file alias `localhost` → `brainsnn.com`
for the recording session so even DevTools shows the right hostname.
Not necessary; not worth the risk of breaking your normal browsing
later.

## Backup plan: mic permission rejected mid-take

Layer 59 audio scan needs Web Speech API which needs mic permission.
If Chrome lost the grant between pre-flight and Beat 2:

1. Pause OBS (⌃⌘P)
2. Click `● Listen`, grant mic
3. ⌃⌘P to resume
4. Re-do Beat 2 from the top

The pause splits the recording into two MP4 segments which you'll
need to splice in post. Worth the cleanliness.

## Backup plan: Gemma quota hit during recording

If the intent classifier toggle goes to "fallback_to_regex" mid-demo,
the cached responses (from `intent-scores.example.json` pre-loaded
into localStorage at T-25 min) will carry the demo. Verify before
recording that cache is loaded:

```js
console.log(
  JSON.parse(localStorage.getItem("brainsnn-firewall-intent-cache-v1")),
);
// Should print object with ~20 entries
```
