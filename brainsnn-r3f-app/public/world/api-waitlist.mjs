// API access waitlist form. Progressive: without this module the form posts
// nowhere useful, so the page also names the email fallback in plain text.
const FALLBACK = 'hello@brainsnn.com';

function message(status, data) {
  if (status === 429) return 'Too many sign-ups from this network. Please try again in an hour.';
  if (data && typeof data.error === 'string' && data.error.length < 300) return data.error;
  return `The waitlist is not available right now. Please email ${FALLBACK}.`;
}

export function mountWaitlist(form, { fetchImpl = globalThis.fetch } = {}) {
  if (!form) return;
  const status = form.querySelector('[data-waitlist-status]');
  const button = form.querySelector('button[type=submit]');
  const say = (text, kind) => { status.textContent = text; status.dataset.kind = kind; };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const body = {
      email: String(values.get('email') || '').trim(),
      name: String(values.get('name') || '').trim(),
      company: String(values.get('company') || '').trim(),
      use_case: String(values.get('use_case') || ''),
      monthly_volume: String(values.get('monthly_volume') || ''),
      details: String(values.get('details') || '').trim(),
      source: 'api',
      consent: values.get('consent') === 'yes',
      website: String(values.get('website') || ''),
    };
    button.disabled = true;
    say('Sending…', 'pending');
    try {
      const response = await fetchImpl('/api/world/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      let data = null;
      try { data = await response.json(); } catch { /* a proxy error page is not JSON */ }
      if (response.status === 202) {
        form.classList.add('is-done');
        for (const field of form.querySelectorAll('input,select,textarea,button')) field.disabled = true;
        say(data?.message || 'Thanks. You are on the API access waitlist.', 'done');
        return;
      }
      say(message(response.status, data), 'error');
    } catch {
      say(`Could not reach BrainSNN. Check your connection or email ${FALLBACK}.`, 'error');
    }
    button.disabled = false;
  });
}

if (typeof document !== 'undefined') mountWaitlist(document.getElementById('waitlist-form'));
