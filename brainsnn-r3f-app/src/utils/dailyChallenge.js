/**
 * Layer 38 — Daily Firewall Challenge
 *
 * A seeded 3-item quiz that rotates every day. Everyone on Earth sees
 * the same three items on any given UTC day — makes cross-friend
 * comparison possible ("I got 2/3 today, what did you get?") and gives
 * the landing page a recurring reason to return.
 *
 * Items are pulled from a 40-sample corpus; the day-of-year picks a
 * deterministic 3-sample window.
 */

// 40 items, rotated by (day-of-year % 40). Each has a Firewall truth
// score (hand-calibrated) and a short "correct label" for the result
// screen. Mix of attacks + benigns so the daily answer key isn't the
// same pattern repeated.
export const DAILY_CORPUS = [
  { id: 'd01', text: "URGENT: your account has been flagged for suspicious activity. Click here now — your access will be revoked within the hour.", truth: 88, label: 'Phishing urgency' },
  { id: 'd02', text: "The report, published today in Nature Methods, describes a 3× speed-up for cryo-EM reconstruction on consumer GPUs.", truth: 6, label: 'Factual news' },
  { id: 'd03', text: "Everyone knows the truth. The media is hiding it. Share this before they delete it — the people in power don't want you to see.", truth: 84, label: 'Hidden-truth conspiracy' },
  { id: 'd04', text: "Take a slow breath. There's nothing you have to do this minute. Just the next breath, arriving on its own.", truth: 3, label: 'Calm prompt' },
  { id: 'd05', text: "Scientifically proven — 100% guaranteed. Experts agree. Obviously you should switch now, before the limited-time offer ends.", truth: 90, label: 'Certainty ad' },
  { id: 'd06', text: "Q3 revenue grew 12% YoY; operating margin expanded 140 bps on leverage from the platform consolidation completed in Q2.", truth: 5, label: 'Earnings summary' },
  { id: 'd07', text: "A deadly new virus is sweeping through. Experts warn collapse is imminent. Prepare now — it may already be too late to protect your family.", truth: 86, label: 'Fear cascade' },
  { id: 'd08', text: "The team reports a 4% latency improvement from the new cache layout, though the tail P99 still shows occasional regressions under burst load.", truth: 5, label: 'Engineering update' },
  { id: 'd09', text: "So what you're saying is, we should just let everyone do whatever they want with no rules at all? That's absurd and everyone can see it.", truth: 72, label: 'Straw man' },
  { id: 'd10', text: "Here is a small handful of preliminary findings — we caution against overinterpreting before replication, and the confidence intervals are wide.", truth: 4, label: 'Cautious science' },
  { id: 'd11', text: "After everything I've done for you, this is how you respond? I guess I'll just be the one to carry this family through yet another crisis.", truth: 74, label: 'Guilt trip' },
  { id: 'd12', text: "The prototype uses differential equations to approximate the system; the implementation is ~200 lines of Python and validates against the closed-form solution.", truth: 4, label: 'Technical note' },
  { id: 'd13', text: "Either you're with us, or you're against us. There is no middle ground. Real allies don't question the leadership in public.", truth: 81, label: 'False dichotomy + purity test' },
  { id: 'd14', text: "We're planning an offsite in early May. Agenda is open — please add items to the shared doc by end of week, no wrong answers.", truth: 3, label: 'Team email' },
  { id: 'd15', text: "They betrayed us. Shocking. Disgusting. If you're not furious, you're not paying attention. Silence is complicity — share this now.", truth: 86, label: 'Outrage bait' },
  { id: 'd16', text: "The park closes at 8pm today because of a private event; the south gate will remain open for residents until 10pm.", truth: 3, label: 'Logistics note' },
  { id: 'd17', text: "You're overreacting. That's not what happened — you always twist things. I never said that. You're imagining it.", truth: 83, label: 'Gaslighting' },
  { id: 'd18', text: "The proposal adds three new API endpoints and deprecates one; backwards compatibility is preserved for 90 days via a soft redirect.", truth: 4, label: 'API RFC' },
  { id: 'd19', text: "Only 3 spots left — don't miss the last chance to join. Limited time. Act fast. Thousands of people are signing up every hour.", truth: 85, label: 'Scarcity + social proof' },
  { id: 'd20', text: "Thanks for the notes on the draft — happy to fold in the pushback on section 3; will resend next week after the data is locked.", truth: 3, label: 'Collaborative reply' },
  { id: 'd21', text: "You're the most incredible person I've ever met. I've never felt anything like this. We're soulmates. I can't imagine life without you.", truth: 76, label: 'Love bombing' },
  { id: 'd22', text: "Preliminary evidence points to a small but statistically significant effect; the authors note several confounders worth investigating.", truth: 4, label: 'Methods section' },
  { id: 'd23', text: "9 out of 10 doctors agree. Most experts say it's essential. Everyone you know is already switching — you should too, obviously.", truth: 80, label: 'Authority + social proof' },
  { id: 'd24', text: "Reminder: server maintenance is scheduled for Friday 02:00–03:00 UTC. Expect brief disruption; status page will update in real time.", truth: 2, label: 'Ops notice' },
  { id: 'd25', text: "Why do you always ignore what I'm saying? When did you decide to stop caring about this family? Have you finally admitted you never loved us?", truth: 84, label: 'Loaded questions' },
  { id: 'd26', text: "Attaching the Q1 retro doc — three wins, four misses, one thing to revisit next quarter. Drop comments inline if anything feels off.", truth: 4, label: 'Retro summary' },
  { id: 'd27', text: "WARNING: act now or your family is at risk. Catastrophic consequences if you don't sign before midnight. Devastating outcome awaits the unprepared.", truth: 89, label: 'Fear appeal' },
  { id: 'd28', text: "The figure shows residuals scaled by sqrt(N); the heteroscedasticity in the lower band is consistent with the model's noise floor assumption.", truth: 4, label: 'Statistics figure caption' },
  { id: 'd29', text: "If you truly stood with us, you'd never hesitate. Real patriots don't ask these questions. You're not a real ally — you're part of the problem.", truth: 82, label: 'Purity test' },
  { id: 'd30', text: "The cook book chapter covers four mother sauces with troubleshooting tips for each; the original French term for each is given in parentheses.", truth: 2, label: 'Recipe intro' },
  { id: 'd31', text: "What about the other side? What about when they did it? Why are you only focused on us? That's the real story here — not this distraction.", truth: 69, label: 'Whataboutism' },
  { id: 'd32', text: "Draft v2 tightens the intro, moves the limitations section forward, and adds the reviewer's requested ablation. Diff is about 180 lines.", truth: 3, label: 'Paper revision note' },
  { id: 'd33', text: "Actually, you are the real victim here. How dare you accuse us. The truth is you've been hurting us all along — we're the ones being attacked.", truth: 78, label: 'DARVO' },
  { id: 'd34', text: "Shop is closing at 6pm today for inventory; back to normal hours tomorrow. Sorry for any inconvenience, thanks for your patience.", truth: 3, label: 'Storefront notice' },
  { id: 'd35', text: "If you're not outraged, you're silent — and silence is violence. You should be ashamed for not speaking up sooner. How could you just sit there?", truth: 87, label: 'Moral outrage bait' },
  { id: 'd36', text: "Talk was good — slides are attached, recording link in the doc. If you want to dig into the appendix numbers, ping me and I'll schedule a walkthrough.", truth: 3, label: 'Post-talk email' },
  { id: 'd37', text: "They don't want you to know. The truth is being hidden. Wake up — open your eyes. This is covered up at the highest levels, and we're not supposed to see.", truth: 82, label: 'Hidden-truth conspiracy' },
  { id: 'd38', text: "The pipeline is now producing deterministic embeddings; we verified bit-for-bit on three test runs. Documentation updated; CI covers both paths.", truth: 4, label: 'Release note' },
  { id: 'd39', text: "Don't miss out — only hours left! Act immediately. This offer vanishes tonight. Proven results guaranteed. Breaking news — everyone is switching now.", truth: 90, label: 'Maximal pressure' },
  { id: 'd40', text: "The pianist's left-hand voicings move in contrary motion to the melody for the first 16 bars; it's a quiet choice but it's what carries the arc.", truth: 3, label: 'Music review' },
];

function dayOfYearUTC(ts = Date.now()) {
  const d = new Date(ts);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((ts - start) / (24 * 60 * 60 * 1000));
}

export function challengeDate(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Today's 3 items — deterministic by UTC day-of-year.
 */
export function pickTodaysChallenge(ts = Date.now()) {
  const doy = dayOfYearUTC(ts);
  const n = DAILY_CORPUS.length;
  // Rotate by doy, wrap around cleanly.
  const i0 = doy % n;
  const i1 = (doy + 7) % n;
  const i2 = (doy + 13) % n;
  return [DAILY_CORPUS[i0], DAILY_CORPUS[i1], DAILY_CORPUS[i2]];
}

/**
 * Grade a single guess the same way the quiz does (within ±20 is right).
 */
export function gradeGuess(truth, guess) {
  const d = Math.abs((truth || 0) - (guess || 0));
  const window = 40;
  return Math.max(0, 1 - d / window);
}

export function challengeAccuracy(items, guesses) {
  let sum = 0;
  let n = 0;
  for (const item of items) {
    if (typeof guesses[item.id] === 'number') {
      sum += gradeGuess(item.truth, guesses[item.id]);
      n++;
    }
  }
  return n === 0 ? 0 : Math.round((sum / n) * 100);
}

export function countCorrect(items, guesses) {
  return items.filter((it) => {
    const g = guesses[it.id];
    return typeof g === 'number' && Math.abs(it.truth - g) <= 20;
  }).length;
}

// ---------- streak tracking (localStorage) ----------

const STREAK_KEY = 'brainsnn_daily_streak_v1';

function readStore() {
  try { return JSON.parse(localStorage.getItem(STREAK_KEY) || 'null'); } catch { return null; }
}
function writeStore(v) {
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(v)); } catch { /* quota */ }
}

export function getStreak() {
  return readStore() || { streak: 0, lastDate: null, history: [] };
}

/**
 * Call on completion. Returns the updated streak object.
 * history is [{date, accuracy, correct}] capped at 30.
 */
export function recordChallenge({ accuracy, correct }) {
  const today = challengeDate();
  const cur = getStreak();
  if (cur.lastDate === today) {
    // Already recorded today — update accuracy if better
    const idx = cur.history.findIndex((h) => h.date === today);
    if (idx >= 0) {
      const prev = cur.history[idx];
      if (accuracy > prev.accuracy) {
        cur.history[idx] = { date: today, accuracy, correct };
      }
    }
    writeStore(cur);
    return cur;
  }
  // New day — streak ticks up if yesterday was recorded, else reset to 1
  const yesterday = challengeDate(Date.now() - 86400000);
  const streak = cur.lastDate === yesterday ? cur.streak + 1 : 1;
  const history = [{ date: today, accuracy, correct }, ...cur.history].slice(0, 30);
  const next = { streak, lastDate: today, history };
  writeStore(next);
  return next;
}
