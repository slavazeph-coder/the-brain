# BrainSNN Playground — content playbook

Zero ad spend. Each week: record four short clips, one per toy. Post each clip everywhere, with the hook as the first words. Tag every link so you can see which clip brought which visitor. The toys funnel visitors to the Sponsor page (`/sponsor/gt3/`) and to Enterprise builds (`/arcade#brief`).

## The hooks (verbatim — never reword)

| Toy | Hook | Page |
|---|---|---|
| 01 Poke the Brain | **poke the brain and watch the signal travel** | brainsnn.com |
| 02 Fool the Detector | **can you fool our AI detector?** | brainsnn.com/toys/fool-the-detector |
| 03 Draft Duel | **make two drafts fight** | brainsnn.com/toys/draft-duel |
| 04 Defend the Brain | **can you keep the brain from getting hijacked?** | brainsnn.com/toys/defend-the-brain |
| 05 Feed the Fly Brain | **will the fly eat it?** | brainsnn.com/toys/fly-brain |

The hook must be the first words on screen, the first line of the caption, and the first thing said if there is voice-over.

## Honesty guardrails (read before every post)

- **Say "simulation".** Never say "real brain", "neural data", "EEG", "brain scan" or "reads your mind". The brain is a seven-region spiking model inside a 3D shell. It is not a recording of anyone's brain.
- **The detector is beatable, and we say so.** Its published evaluation says it missed every paraphrased technique on held-out text. That is the game. Never caption it "unbeatable" or "catches all manipulation".
- **A Duel win is a game result from heuristic signals.** It is not proof one draft is better or will perform better.
- **Defend scores are 0–100 indices, not probabilities.** Results describe tested conditions, not universal capability.
- **The fly's wiring is real; its activity is not.** Say "a slice of the published FlyWire fruit-fly connectome, simulated" — never "a real fly brain", "a whole brain", "brain upload" or anything implying a recording. Credit FlyWire and Shiu et al. on every fly post. Don't post the fly until its data licence is confirmed (see `brainsnn-r3f-app/public/fly/ATTRIBUTION.md`).
- **No invented numbers.** Do not claim a user count, "10k people tried it" or a sponsor you don't have.

## Links (tag every one)

The in-app Share buttons already tag links `?src=toyN-share` (a visitor sharing). Links you post yourself get their own tag so the two can be compared.

| Where | Link |
|---|---|
| Bio (one link, all platforms) | `https://www.brainsnn.com/?src=bio-tiktok` · `?src=bio-ig` · `?src=bio-yt` · `?src=bio-x` |
| Poke post (where links work) | `https://www.brainsnn.com/?src=toy1-post` |
| Fool post | `https://www.brainsnn.com/toys/fool-the-detector?src=toy2-post` |
| Duel post | `https://www.brainsnn.com/toys/draft-duel?src=toy3-post` |
| Defend post | `https://www.brainsnn.com/toys/defend-the-brain?src=toy4-post` |
| Fly post | `https://www.brainsnn.com/toys/fly-brain?src=toy5-post` |

Visitors are recorded first-touch in `from.share`. Read the numbers in the Monday review below.

## Recording setup (once)

- **Poke clips.** Use the built-in recorder: **Share this brain → Record a 6-second clip**. It exports a 9:16 file with the hook, counter, watermark and outro already on it. For a longer 20–30 s cut, screen-record desktop Chrome with the window at about 1080×1920 (or a phone held vertically) and trim.
- **Fool, Duel and Defend clips.** Screen-record the page (desktop Chrome at 1080×1920 via DevTools device mode, or a phone). End each clip on the toy's **Share score card** PNG, held for about 1.5 s.
- **Audio.** No talking head. Add a short trending sound, or a soft click/"boing" on each poke. Keep captions burned in, because most people watch muted.
- **Before recording.** Hide the cursor or use a large touch indicator. Use a clean browser profile with no bookmarks bar and no extensions visible.

---

## Clip scripts

### 01 Poke the Brain — 18 s ("the satisfying one")

| Time | What's on screen | On-screen text |
|---|---|---|
| 0–2 s | Brain idle and slowly rotating. Counter reads 0000. | **poke the brain and watch the signal travel** |
| 2–6 s | Three quick pokes, left to right. Ring pulses spread and comets run along pathways. Counter climbs. | — |
| 6–10 s | Grab the frontal lobe, stretch it slowly to the side, hold, then **let go**. Full-body jelly wobble. | *wait for it* |
| 10–13 s | Tap **Shake**. A burst of pokes, and the brain jiggles. | — |
| 13–16 s | Counter close-up: "142 signals fired". | how many can you fire? |
| 16–18 s | Outro card (built-in). | brainsnn.com |

**Caption:**
> poke the brain and watch the signal travel 🧠⚡
> it's a jelly brain wrapped around a 7-region spiking simulation — every poke fires signals down real pathways in the model.
> link in bio · best on a laptop, works on phones

**Hashtags:** `#satisfying #threejs #webgl #creativecoding #interactive #brain #oddlysatisfying`

**Variations** (rotate one per week): "slow-mo stretch and release only" · "one poke, follow a single signal across the brain" · "phone version, thumb pokes" · "try to hit 500 signals in 10 seconds".

### 02 Fool the Detector — 24 s ("the challenge")

| Time | What's on screen | On-screen text |
|---|---|---|
| 0–2 s | Page heading. | **can you fool our AI detector?** |
| 2–7 s | Round 1, "Invent a deadline". Type the obvious line: *Only 3 spots left — the offer ends tonight, so act now.* Submit. Result: **Caught**. | the obvious version gets caught |
| 7–14 s | Type: *The window shuts Friday and we are not reopening it.* Submit. Result: **Slipped past, +20**. | …but this one slips past |
| 14–20 s | Rounds 2–5 at fast-forward. Final rank reveal (e.g. **Ghostwriter**). | 5 rounds. what's your rank? |
| 20–24 s | Score card PNG held on screen. | brainsnn.com — link in bio |

**Caption:**
> can you fool our AI detector?
> 5 rounds. sneak a manipulation trick past it without it noticing. we published where it fails — use that.
> I got Ghostwriter. beat it 👇 (link in bio)

**Hashtags:** `#ai #promptengineering #copywriting #aitools #challenge #marketing`

**Pinned comment:** `the detector is keyword-based and we publish its blind spots — it missed every paraphrased trick in our own test. that's the game.`

### 03 Draft Duel — 20 s ("the fight")

| Time | What's on screen | On-screen text |
|---|---|---|
| 0–2 s | Two text boxes. | **make two drafts fight** |
| 2–5 s | Paste Draft A (salesy: "LAST CHANCE…") and Draft B (plain and specific). Tap **Fight**. | A: hype · B: plain |
| 5–15 s | The five rounds clash one by one: trust, calm, clean play, warmth, spark. | round 1: trust… |
| 15–18 s | Verdict slams in: **Draft B wins 4–1**. | the hype lost |
| 18–20 s | Verdict card PNG. | brainsnn.com — link in bio |

**Caption:**
> make two drafts fight 🥊
> paste two versions of an email, post or pitch. they go 5 rounds: trust, calm, clean play, warmth, spark.
> the hype version lost 4–1. try yours (link in bio)

**Hashtags:** `#copywriting #writingtips #emailmarketing #marketing #linkedin #contentcreator`

**LinkedIn version** (same clip, text post). Duel is the toy most likely to reach B2B buyers:
> Make two drafts fight.
> I put a "LAST CHANCE" sales email against a plain, specific one. Five rounds — trust, calm, clean play, warmth, spark — scored by a deterministic engine, in the browser, no signup.
> The hype draft lost 4–1.
> Try it with your own: https://www.brainsnn.com/toys/draft-duel?src=toy3-post

### 04 Defend the Brain — 25 s ("the game")

| Time | What's on screen | On-screen text |
|---|---|---|
| 0–2 s | Brain model with packets incoming. | **can you keep the brain from getting hijacked?** |
| 2–10 s | The "Deadline pressure" level. The hijack meter climbs as packets hit the amygdala loop. | fake urgency, going straight for the threat loop |
| 10–18 s | Cut a pathway, silence the threat loop, boost judgment. The meter drops. | cut. silence. boost. |
| 18–22 s | Run ends: **Held the line — defense 78**. | 6 moves. held the line. |
| 22–25 s | Score card PNG. | brainsnn.com — link in bio |

**Caption:**
> can you keep the brain from getting hijacked?
> persuasion tricks from real text attack a brain simulation. you get 6 moves to keep judgment online.
> I held the line at 78. your turn (link in bio)

**Hashtags:** `#browsergame #indiegame #gamedev #brain #puzzle #persuasion`

---

## Weekly cadence (about 2 hours a week)

| Day | Post | Platforms |
|---|---|---|
| Mon | Review last week's numbers (15 min). Record all four clips (60 min). | — |
| Tue | 01 Poke | TikTok, IG Reels, YT Shorts, X |
| Wed | 03 Draft Duel | TikTok, IG Reels, YT Shorts, **LinkedIn** |
| Thu | 02 Fool the Detector | TikTok, IG Reels, YT Shorts, X |
| Fri | 04 Defend the Brain | TikTok, IG Reels, YT Shorts |
| Sat | Repost the week's best clip as a variation (new hook visual, same hook text). | the platform where it did best |

**Rules:**

- Post the same clip natively to each platform. Upload the file; don't share a link to another platform.
- Reply to every comment in the first hour. Challenge replies ("beat my score") are the growth loop.
- If someone posts a score card, repost it with credit.

## Monday review (15 min)

For each toy, check:

- **Visits by `from.share`.** Compare `toyN-post` (your posts) with `toyN-share` (visitors sharing).
- **The poke funnel:** `toy_first_poke`, then `toy_share_opened`, then `toy_clip_saved`.
- **Score-card saves:** `toy_card_saved`.
- **CTA clicks:** `toy_cta_clicked` (Sponsor vs Enterprise).

**Decide one thing:**

- Double the posting frequency of the toy whose clips bring the most `toyN-share` visits (people sharing it onward).
- Cut or re-script any clip with under 1 s average watch time on its first two seconds. That means the hook frame failed.

## Sponsor outro (when the first sponsor signs)

Set `SPONSORS` in `brainsnn-r3f-app/src/features/toys/toyConfig.js`, as described in BUILD-NOTES §3. Every new clip and score card then carries "Brought to you by \<name\>" automatically. Don't re-edit old clips. The sponsor pitch is the four toys' weekly clip count plus `toyN-share` visits, and the page is `/sponsor/gt3/`.
