// The local vocabulary maps only to the tabletop tasks the simulator can execute.
const examples = 'Try “Push the puck 30 cm” or “Reach the target 20 cm away”.';
const units = '(?:centimet(?:er|re)s?|cm|met(?:er|re)s?|m)';
const measurement = new RegExp('(?:^|\\s)(\\d*\\.?\\d+)\\s*(' + units + ')(?:\\s+away)?$', 'u');
const push = /^push(?: (?:the |a )?puck)?(?: (?:to|toward|towards) (?:the |a )?(?:target|spot|goal|marker))?$/u;
const reach = /^reach(?: (?:for |to )?(?:the |a )?(?:target|spot|goal|marker))?$/u;

export function parseTaskInstruction(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error(examples);
  let words = text.toLowerCase().trim().replace(/[.!?]+$/u, '').replace(/\s+/gu, ' ').replace(/^please /u, '');
  const amount = measurement.exec(words);
  if (amount) words = words.slice(0, amount.index).trimEnd();
  const task = push.test(words) ? 'push' : reach.test(words) ? 'reach' : null;
  if (!task) throw new Error(examples);
  if (!amount) return {task};

  const centimeters = Number(amount[1]) * (amount[2].startsWith('m') ? 100 : 1);
  const rounded = Math.round(centimeters);
  if (rounded < 14 || rounded > 72 || Math.abs(rounded - centimeters) > 1e-8) {
    throw new Error('Choose a whole number of centimetres from 14 to 72.');
  }
  return {task, distance: rounded / 100};
}

const extensions = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
  ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'],
]);
export const referenceTypes = [...extensions.keys()].join(',');
export function referencePath(file) {
  if (!file) return null;
  if (!extensions.has(file.type)) throw new Error('Choose a JPG, PNG, WebP, MP4, WebM or MOV file.');
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('Choose a reference between 1 byte and 32 MiB.');
  return 'reference/media.' + extensions.get(file.type);
}

export async function exportTaskWorkspace({brief = '', reference = null, result}) {
  if (!result && !String(brief).trim() && !reference) throw new Error('Write your idea or choose a reference first.');
  if (result && (!result.modelXML || !result.config || !result.score || !result.frames?.length)) {
    throw new Error('Run the task again to save its recording.');
  }
  const path = referencePath(reference);
  const {zipSync} = await import('./vendor/robot-task-zip.mjs');
  const encode = text => new TextEncoder().encode(text);
  // The user's brief lives in its own data file. TASK.md describes the files and the workflow.
  const files = {
    'brief.txt': encode(brief),
    'TASK.md': encode([
      '# My World Builder robot task',
      '',
      'Open this folder in Google Antigravity with the Robotics plugin installed.',
      'Start a chat and ask “Use the Robotics plugin in simulation only. Read my brief and examine the included files. Build my requested MuJoCo task, run a trial and show me where it succeeds or misses.”',
      '',
      '## What is here',
      '',
      '- brief.txt contains your written request.',
      ...(result ? [
        '- scene.xml contains the standalone MuJoCo scene used for the recorded tabletop trial.',
        '- episode.json contains the trial settings, sampled actions and observations, and the measured outcome. The built-in controller runs in World Builder. Opening the XML alone loads its starting scene.',
      ] : []),
      ...(path ? ['- ' + path + ' contains the original image or video you selected as a visual reference.'] : []),
      '',
      ...(result ? [
        'Open scene.xml in a MuJoCo viewer to inspect the starting scene. To reproduce the trial in World Builder, choose the task, distance, controller and seed recorded in episode.json and run it again.',
        '',
        'From the BrainSNN repository, use this command to run the Google Robotics plugin static asset audit on this export.',
        '',
        '`uv run --python 3.12 scripts/world-mujoco/audit_scene.py --scene /path/to/scene.xml --output-dir /new/path/to/audit`',
      ] : ['Ask the plugin to create a self-contained scene.xml and keep the test results beside it.']),
      '',
      '[Google Robotics plugin and setup](https://github.com/google-deepmind/robotics-antigravity-plugin)',
    ].join('\n') + '\n'),
  };
  if (result) {
    const {modelXML, ...episode} = result;
    files['scene.xml'] = encode(modelXML);
    files['episode.json'] = encode(JSON.stringify(episode, null, 2) + '\n');
  }
  if (reference) files[path] = new Uint8Array(await reference.arrayBuffer());
  return new Blob([zipSync(files, {level: 0})], {type: 'application/zip'});
}

/** Called only from the explicit cloud-draft button. Site sessions never go to a custom worker. */
export async function requestRobotTaskDraft({brief, reference, token, signal}) {
  if (!token) throw new Error('Gemini needs a BrainSNN owner connection. Choose Connect processing and sign in on the site that hosts your workspace.');
  const request = {consent: true, brief: String(brief ?? '').trim()};
  if (!request.brief && !reference) throw new Error('Write a short request or choose a reference first.');
  if (reference) {
    referencePath(reference);
    if (reference.size > 2 * 1024 * 1024) throw new Error('Choose a reference of 2 MiB or less to send to Gemini.');
    const bytes = new Uint8Array(await reference.arrayBuffer());
    // Each chunk ends on a complete base64 triplet except for the last.
    const encoded = [];
    for (let at = 0; at < bytes.length; at += 12_288) {
      encoded.push(btoa(String.fromCharCode(...bytes.subarray(at, at + 12_288))));
    }
    request.reference = {mimeType: reference.type, data: encoded.join('')};
  }
  signal?.throwIfAborted();
  const response = await fetch('/api/world/robot-task-draft', {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
    body: JSON.stringify(request), signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  const answer = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = answer?.detail || answer?.error;
    throw new Error(typeof detail === 'string' ? detail.slice(0, 250) : 'Gemini drafting is unavailable on this site.');
  }
  if (answer?.task === 'unsupported' || answer?.supported === false) {
    throw new Error('That idea needs a different scene. Save your brief and use it in the Antigravity Robotics plugin.');
  }
  if (!['push','reach'].includes(answer?.task) || !Number.isInteger(answer.distanceCm) || answer.distanceCm < 14 || answer.distanceCm > 72) {
    throw new Error('The service could not return a usable tabletop task. Your settings are still available.');
  }
  return {task: answer.task, distance: answer.distanceCm / 100};
}
