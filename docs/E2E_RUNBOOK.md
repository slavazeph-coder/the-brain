# BrainSNN — Manual E2E Runbook (TechEx hackathon)

> Use this to verify the 8 UI-bound tests in [issue #42](https://github.com/slavazeph-coder/the-brain/issues/42) before submission.
> Companion to [DEMO_SCRIPT.md](DEMO_SCRIPT.md) — that one is for the recording; this one is for verification.

## Target URL

**Use `https://www.brainsnn.com`** — the apex `brainsnn.com` currently 301s to a typo'd `Www.brainsnn.com` and returns 404 from strict clients (see "Known issues" at bottom).

## Pre-flight (~30 seconds)

1. Open `https://www.brainsnn.com` in a fresh browser tab (or incognito to keep localStorage clean).
2. Open DevTools → Application → Local Storage → `https://www.brainsnn.com` → clear all keys. This guarantees the Lobster Trap audit log and snapshot list start empty on camera.
3. Confirm the 3D brain renders and rotates. If not, hard refresh.
4. Note browser zoom = 100%, theme = dark.

## Test matrix (record pass/fail inline)

### Test 2 — Best Gemini, text analysis

**Panel:** `GeminiAnalysisPanel` (scroll to "Gemini-Powered Manipulation Scanner")
**Action:** Confirm status dot is **green** (Gemini configured). Paste this into the textarea:

```
URGENT: They don't want you to know this — banks are about to collapse, last chance to move your money before everyone else panics. Act now or lose everything.
```

Click **Analyse text**.
**Expected:**

- Source badge shows `gemini:gemini-2.5-flash` (NOT `regex` or `fallback`)
- JSON output includes `reasoning` paragraph + `evidence` array of sentence chips
- All 4 pressure dimensions populated (fear, urgency, scarcity, trust-erosion)
- No console errors
  **Pass/fail:** \_\_\_

### Test 3 — Best Gemini, multimodal

**Panel:** Same `GeminiAnalysisPanel`, mode toggle to image/multimodal (or scroll to multimodal scanner if separate).
**Action:** Upload any image with text content (a screenshot of a phishing email works well, or just any captioned image). Click analyse.
**Expected:**

- Source badge `gemini:gemini-2.5-flash`
- JSON returned with same shape as text scan but `evidence` references visual elements
- No 4xx/5xx network errors in DevTools Network tab
  **Pass/fail:** \_\_\_

### Test 5 — Best Veea, PII redaction toggle

**Panel:** `LobsterTrapPanel` ("Veea Lobster Trap — Deep Prompt Inspection")
**Action:**

1. Find the **"Redact PII (email, SSN, credit card, phone) before send"** checkbox. **Enable it.**
2. Paste this prompt into the tester:

```
Contact me at slava@example.com, my SSN is 123-45-6789, my card is 4111 1111 1111 1111.
```

3. Click **Inspect prompt**.
   **Expected with toggle ON:**

- Decision: `REDACT` (or `ALLOW` with `redacted` field populated)
- Output preview shows `[REDACTED:EMAIL]`, `[REDACTED:SSN]`, `[REDACTED:CARD]` placeholders
- Audit log row appears with action=redact

4. **Disable** the toggle, paste the same text, click **Inspect prompt** again.
   **Expected with toggle OFF:**

- Decision: `BLOCK` (because PII without redaction is policy violation) OR `ALLOW` without redaction depending on policy — but the **behavior must differ** from the toggle-ON case.
  **Pass/fail:** \_\_\_

### Test 7 — Security & Trust headline (Red Team → Brain Evolve loop)

**Panels:** `RedTeamPanel` + `BrainEvolvePanel`
**Action:**

1. Go to **Red Team Simulator**. Click **Run corpus** (or equivalent). Note the F1 score and letter grade.
2. Go to **Brain Evolve**. Click **Start evolution**. Wait until at least one generation completes.
3. Click **Promote winner** on a high-fitness rule.
4. Return to **Red Team Simulator**, click **Run corpus** again.
   **Expected:**

- Second F1 score is **higher** than the first (or at minimum, the count of "new rules contributing" is non-zero)
- Letter grade improves or stays at A
- No errors during evolution
  **Pass/fail:** **_ (record both F1 scores: before _**, after \_\_\_)

### Test 8 — Data & Intelligence (Multimodal RAG)

**Panel:** `MultimodalRagPanel` ("Multimodal RAG Router")
**Action:**

1. Paste a document with `=== Title ===` delimiter and at least one image. Example:

```
=== Q4 financial summary ===
Revenue up 18% YoY, driven by enterprise renewals.
=== Risk analysis ===
Supply chain remains exposed to Asia-Pacific shipping disruptions.
```

2. Optionally drop an image into the upload area.
3. Click **Index** (or equivalent).
4. Drag the **Vector ↔ Graph** slider from left to right.
   **Expected:**

- Chunks listed per modality (text chunks, image captions if image was added)
- Rerank order **visibly shifts** when the slider moves (top results re-order)
- A query in the search box returns ranked chunks
  **Pass/fail:** \_\_\_

### Test 10 — Connected Systems (Session Rooms cross-tab)

**Panel:** `SessionRoomsPanel`
**Action:**

1. Click **Create room**. Copy the share URL (it should contain `?room=<id>`).
2. Open the share URL in a **second browser tab** (same browser is fine).
3. In the original tab, type a message or change state.
4. Observe the second tab.
   **Expected:**

- Second tab loads with the same room ID prefilled / joined automatically
- Cross-tab state sync visible (mini-leaderboard, presence, or whatever the panel shows)
- No "room not found" errors
  **Pass/fail:** \_\_\_

### Test 11 — Onboarding copy

**Panel:** `OnboardingWalkthrough`
**Action:** Trigger onboarding — usually visible on first load if localStorage is clean, or via a "Show walkthrough" button.
**Expected:**

- Onboarding mentions **Gemini** as a real provider (not just "AI" or "LLM")
- Onboarding mentions **Veea Lobster Trap** by name
- Mentions of "100 layers" or "35 layers" — match what HACKATHON.md and README claim (currently both)
- No broken images or placeholder strings (`{{TODO}}`, `[INSERT]`, etc.)
  **Pass/fail:** \_\_\_

### Test 12 — Snapshot report engine attribution

**Panel:** `SnapshotPanel`
**Action:**

1. Save a snapshot (click **Save snapshot**, give it a name).
2. Click **Generate report** (or "Export report" — the panel uses `generateReport` from utils/snapshots).
3. Inspect the exported report (download or modal).
   **Expected:**

- Report includes provider attribution: lists `gemini:gemini-2.5-flash` and `lobster_trap` somewhere in the metadata or summary
- Report is self-contained Markdown or JSON (not just placeholder text)
- Layer count matches the README/HACKATHON.md claim
  **Pass/fail:** \_\_\_

## After running

Paste results into [issue #42](https://github.com/slavazeph-coder/the-brain/issues/42) as a comment, e.g.:

```
E2E runbook results 2026-05-11 (manual):
- Test 2: PASS
- Test 3: PASS
- Test 5: PASS (toggle on=REDACT, off=BLOCK)
- Test 7: PASS (F1 before 0.74, after 0.81)
- Test 8: PASS
- Test 10: PASS
- Test 11: PASS
- Test 12: PASS
```

If any test fails, file a follow-up issue titled `E2E test N failed — <one-liner>` and a branch `claude/e2e-fix-test-N` per the convention in [.agent.md](../.agent.md).

## Known issues found during this submission cycle

1. **Apex `brainsnn.com` is broken.** Returns `301 → https://Www.brainsnn.com` (capital W typo). Strict clients (curl) get 404 on the follow; browsers usually lowercase the hostname per RFC 3986 and reach the live app, but the URL bar will display the typo. The apex is on GitHub Pages (different repo); fix the CNAME / redirect config there, or change DNS to point apex at Railway alongside www. **Until fixed, use `www.brainsnn.com` everywhere in the demo recording and submission form.**
