import { placementFromSearch, placementLink, applicationConfirmation } from './launch-utils.js';

// Progressive enhancements only. app.js remains the sole owner of the
// application POST, validation, CSRF, idempotency and success transition.
const picker = document.getElementById('zone-picker');
const form = document.getElementById('sponsor-form');
const success = document.getElementById('application-success');
const reference = document.getElementById('application-reference');
const ids = () => [...picker.querySelectorAll('button[data-zone]')].map(button => button.dataset.zone);
const selected = () => picker.querySelector('button[aria-pressed="true"]')?.dataset.zone;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const button = (id, label) => {
  const node = el('button', 'button outline', label);
  node.type = 'button'; node.id = id; return node;
};
const status = id => {
  const node = el('p', 'fine-print sponsor-handoff-status');
  node.id = id; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); return node;
};

if (picker && form && success && reference) {
  const styles = el('style');
  styles.textContent = '.sponsor-handoff{padding:0 20px 12px}.sponsor-handoff .button,.confirmation-actions .button{min-height:44px}.sponsor-handoff-status{margin:6px 0 0;min-height:0}.sponsor-handoff-status:empty{display:none}.sponsor-handoff .field{margin-top:12px}.sponsor-handoff input{width:100%;min-width:0;font-size:13px}.confirmation-actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.confirmation-actions .button{flex:1 1 160px}.confirmation-actions+[role=status]{margin-bottom:12px}';
  document.head.append(styles);
  const panel = el('div', 'sponsor-handoff');
  const share = button('share-placement', 'Share this placement ↗');
  share.disabled = true;
  const shareStatus = status('share-placement-status');
  const fallback = el('label', 'field', 'Placement link'); fallback.hidden = true;
  const linkInput = el('input'); linkInput.type = 'text'; linkInput.readOnly = true; linkInput.id = 'placement-share-link';
  fallback.append(linkInput); panel.append(share, fallback, shareStatus);
  document.querySelector('.showroom .model-note').before(panel);
  const sync = () => {
    const available = ids();
    if (!available.length) return;
    share.disabled = false;
    if (!sync.initialized) {
      sync.initialized = true;
      const id = placementFromSearch(location.search, available);
      picker.querySelector(`button[data-zone="${id}"]`)?.click();
    }
  };
  new MutationObserver(sync).observe(picker, {childList:true});
  sync();
  picker.addEventListener('click', () => { fallback.hidden = true; shareStatus.textContent = ''; });
  share.addEventListener('click', async () => {
    try {
      const url = placementLink(selected(), ids());
      linkInput.value = url;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
        fallback.hidden = true;
        shareStatus.textContent = 'Placement link copied. Your logo and application details are not included.';
      } catch {
        fallback.hidden = false; linkInput.focus(); linkInput.select();
        shareStatus.textContent = 'Copy the link above. It shares the placement only, not your logo or application details.';
      }
    } catch (error) { shareStatus.textContent = error.message; }
  });

  const controls = el('div', 'confirmation-actions');
  const copy = button('copy-application-reference', 'Copy reference');
  const download = button('download-application-confirmation', 'Save confirmation ↓');
  copy.disabled = true; download.disabled = true;
  const receiptStatus = status('confirmation-status');
  controls.append(copy, download);
  document.getElementById('done-dialog').before(controls, receiptStatus);
  let submitted = null;
  let confirmation = null;
  // Capture the user's submitted values before the existing handler sends them.
  // No network interception, storage, extra requests or private query parameters.
  form.addEventListener('submit', () => {
    if (!form.checkValidity() || document.getElementById('submit-application').disabled) return;
    const waitlist = document.getElementById('amount-field').hidden;
    submitted = {
      company:form.elements.company.value.trim(),
      mode:waitlist ? 'waitlist' : form.elements.amount.readOnly ? 'fixed' : 'offer',
      zone:waitlist ? 'fleet' : selected(),
      placementName:document.getElementById('placement-name').textContent,
      budgetCents:waitlist ? 0 : Math.round(Number(form.elements.amount.value) * 100)
    };
  }, true);
  new MutationObserver(() => {
    if (success.hidden) {
      submitted = null; confirmation = null;
      copy.disabled = true; download.disabled = true; receiptStatus.textContent = '';
      return;
    }
    try {
      // app.js reveals this panel only after a successful server response, and
      // writes the server-returned reference before this observer runs.
      confirmation = applicationConfirmation(reference.value, submitted, ids());
      copy.disabled = false; download.disabled = false;
    } catch {
      confirmation = null; copy.disabled = true; download.disabled = true;
      receiptStatus.textContent = 'Keep the on-screen reference for your records.';
    }
  }).observe(success, {attributes:true, attributeFilter:['hidden']});
  copy.addEventListener('click', async () => {
    if (!confirmation || success.hidden) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(reference.value);
      receiptStatus.textContent = 'Application reference copied.';
    } catch {
      reference.focus(); reference.select();
      receiptStatus.textContent = 'Select and copy the application reference above.';
    }
  });
  download.addEventListener('click', () => {
    if (!confirmation || success.hidden) return;
    const url = URL.createObjectURL(new Blob([confirmation.text], {type:'text/plain;charset=utf-8'}));
    const anchor = el('a'); anchor.href = url; anchor.download = confirmation.filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    receiptStatus.textContent = 'Confirmation prepared for download. No payment was collected.';
  });
}
