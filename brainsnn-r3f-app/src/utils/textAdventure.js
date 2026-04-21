/**
 * Layer 73 — Text Adventure Training
 *
 * Choose-your-reply manipulation scenarios. Each scenario is a tree:
 *   node = { id, from, text, choices }
 *   choice = { label, reply, scoreDelta, next, feedback }
 *
 * Score accumulates as you play. Positive deltas = resilient reply;
 * negative = you got hooked. End screen shows your immunity delta +
 * the "ideal path" analysis.
 */

export const SCENARIOS = [
  {
    id: 'phish-1',
    title: 'The urgent security email',
    start: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        from: 'IT Support',
        text: 'URGENT: Your account has been flagged for suspicious activity. Click here within the hour or access will be permanently revoked. — IT Support',
        choices: [
          {
            label: 'Click the link immediately',
            scoreDelta: -2,
            next: 'n-fail',
            feedback: 'Classic urgency + authority phishing combo. The Firewall catches this kind at 80%+ pressure.',
          },
          {
            label: 'Reply asking for the ticket number',
            scoreDelta: +1,
            next: 'n2',
            feedback: 'Good. Legitimate IT always has a ticket reference.',
          },
          {
            label: 'Forward to the security team',
            scoreDelta: +2,
            next: 'n-win',
            feedback: 'Best answer. Never debug suspicious messages on your own.',
          },
        ],
      },
      n2: {
        id: 'n2',
        from: 'IT Support',
        text: 'Ticket? There isn\'t time. The breach is active. Just verify your credentials now and we can trace it after.',
        choices: [
          {
            label: 'Verify credentials',
            scoreDelta: -3,
            next: 'n-fail',
            feedback: 'Doubling down on urgency is a tell. Legit IT can wait 5 minutes for a ticket lookup.',
          },
          {
            label: 'Refuse and escalate internally',
            scoreDelta: +2,
            next: 'n-win',
            feedback: 'Right. "We don\'t have time" is not a reason to skip procedure.',
          },
        ],
      },
      'n-win': {
        id: 'n-win',
        terminal: true,
        win: true,
        text: 'You did not take the bait. The message was a phishing attempt — the real IT team confirmed no such flag existed.',
      },
      'n-fail': {
        id: 'n-fail',
        terminal: true,
        win: false,
        text: 'You submitted credentials to a fake portal. In a real scenario, the attacker now has session access to your account.',
      },
    },
  },
  {
    id: 'gaslight-1',
    title: 'The re-written memory',
    start: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        from: 'Morgan',
        text: "You're imagining it. That never happened. You always twist what I say — I never said that.",
        choices: [
          {
            label: 'Apologize and drop it',
            scoreDelta: -2,
            next: 'n2',
            feedback: 'Gaslighting wins when you concede your own memory. Don\'t apologize for noticing something real.',
          },
          {
            label: "Restate what you observed, calmly and specifically",
            scoreDelta: +2,
            next: 'n-win',
            feedback: 'Correct. Name the specific behavior. Don\'t argue about whether it happened.',
          },
          {
            label: 'Escalate the argument',
            scoreDelta: 0,
            next: 'n2',
            feedback: 'Engaging the framing is what the gaslighter wants. Stay on the original issue instead.',
          },
        ],
      },
      n2: {
        id: 'n2',
        from: 'Morgan',
        text: "See? You can\'t even remember what you said five minutes ago. Maybe you should take a break.",
        choices: [
          {
            label: 'Accept the "take a break" framing',
            scoreDelta: -2,
            next: 'n-fail',
            feedback: 'The "you need rest" deflection is a wrapper on the original denial. Don\'t accept the frame.',
          },
          {
            label: 'Return to the specific behavior, in writing',
            scoreDelta: +2,
            next: 'n-win',
            feedback: 'Right. Once a gaslighter denies reality out loud, move the conversation to a written record.',
          },
        ],
      },
      'n-win': {
        id: 'n-win',
        terminal: true,
        win: true,
        text: 'You held your ground without arguing about reality. The pattern became clearer over subsequent conversations.',
      },
      'n-fail': {
        id: 'n-fail',
        terminal: true,
        win: false,
        text: 'You ended up doubting yourself. The pattern continued and became harder to name later.',
      },
    },
  },
];

export function startRun(scenarioId) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return null;
  return {
    scenarioId,
    node: scenario.start,
    path: [],
    score: 0,
    feedbacks: [],
  };
}

export function chooseOption(run, choiceIdx) {
  const scenario = SCENARIOS.find((s) => s.id === run.scenarioId);
  if (!scenario) return run;
  const node = scenario.nodes[run.node];
  if (!node || !node.choices) return run;
  const choice = node.choices[choiceIdx];
  if (!choice) return run;
  return {
    ...run,
    score: run.score + (choice.scoreDelta || 0),
    path: [...run.path, { nodeId: node.id, choiceIdx, label: choice.label }],
    feedbacks: [...run.feedbacks, { nodeId: node.id, label: choice.label, feedback: choice.feedback }],
    node: choice.next,
  };
}

export function currentNode(run) {
  const scenario = SCENARIOS.find((s) => s.id === run.scenarioId);
  if (!scenario) return null;
  return scenario.nodes[run.node];
}

export function runSummary(run) {
  const node = currentNode(run);
  const terminal = !!node?.terminal;
  const verdict = !terminal ? { label: 'In progress', color: '#77dbe4' }
    : run.score >= 3 ? { label: 'Resilient', color: '#5ee69a' }
    : run.score >= 1 ? { label: 'Sharp', color: '#77dbe4' }
    : run.score >= -1 ? { label: 'Wobbled', color: '#fdab43' }
    : { label: 'Hooked', color: '#dd6974' };
  return { terminal, verdict };
}
