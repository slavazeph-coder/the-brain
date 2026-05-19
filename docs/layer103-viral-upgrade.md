# Layer 103 Viral Upgrade

This upgrade turns Social Post Autopsy from a private analysis tool into a growth loop:

`analyze post -> verdict card -> share/copy/export -> recipient curiosity -> run your own post -> archive/deeper scan`

## What changed

- Added `src/utils/socialViralLoop.js`.
  - Normalizes Layer 103 reports into a share-ready verdict model.
  - Builds short share text and X/Threads-style thread drafts.
  - Generates a 1080x1350 SVG verdict card without a canvas dependency.
  - Emits vendor-neutral analytics events through `brainsnn:analytics` and a localStorage fallback queue.

- Added `src/components/SocialVerdictCard.jsx`.
  - Shows the feeling being installed, pressure score, shareability, top tactics, and evidence.
  - Includes Share verdict, Copy summary, Copy thread, Download SVG, Show me why, Open in Brain, Send to Firewall, and Save privately.

- Updated `src/components/SocialPostAutopsyPanel.jsx`.
  - Renders the verdict card as the first result surface.
  - Keeps the detailed report and existing share artifact routes underneath.
  - Adds an evidence drawer so the viral card stays simple while the trust layer stays one click away.

## Product rule

Do not make the full report the viral object. Make the verdict card the viral object.

The card should answer in five seconds:

1. What feeling is this post trying to install?
2. What tactics does it use?
3. How strong is the pressure?
4. What evidence triggered the verdict?
5. How do I try this on my own post?

## Analytics events

The upgrade emits:

- `layer103_verdict_rendered`
- `layer103_evidence_opened`
- `layer103_share_card_clicked`
- `layer103_share_card_exported`
- `layer103_summary_copied`
- `layer103_thread_copied`
- `layer103_open_in_brain`
- `layer103_send_to_firewall`
- `layer103_saved_private`

Bridge them later with:

```js
window.addEventListener('brainsnn:analytics', (event) => {
  console.log('[BrainSNN analytics]', event.detail);
});
```

## Next viral improvements

1. Add a public `/s/:hash` result page CTA that says: “Run your own post.”
2. Add a one-click image export as PNG using `html-to-image` or server-side OG generation.
3. Add remix prompts: “Make this less manipulative,” “Make this stronger but cleaner,” and “Turn this into a trusted post.”
4. Add leaderboard cards: most manipulative carousel, cleanest post, strongest hook.
5. Add creator mode: analyze my own post before I publish.
