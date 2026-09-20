// Public placement URLs intentionally exclude all applicant and artwork data.
export function placementFromSearch(search, ids) {
  const allowed = Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && /^[a-z]+$/.test(id)) : [];
  const fallback = allowed.includes('chest') ? 'chest' : allowed[0] || null;
  if (typeof search !== 'string' || search.length > 4096) return fallback;
  const values = new URLSearchParams(search).getAll('placement');
  return values.length === 1 && allowed.includes(values[0]) ? values[0] : fallback;
}

export function placementLink(id, ids) {
  if (typeof id !== 'string' || !/^[a-z]+$/.test(id) || !Array.isArray(ids) || !ids.includes(id)) throw new Error('Choose an available placement first.');
  const url = new URL('https://www.brainsnn.com/sponsor/');
  url.searchParams.set('placement', id);
  url.hash = 'studio';
  return url.href;
}

const oneLine = value => String(value || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0, 160);
export function applicationConfirmation(reference, submitted, ids) {
  if (typeof reference !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reference)) throw new Error('A confirmed application reference is required.');
  if (!submitted || !['offer', 'fixed', 'waitlist'].includes(submitted.mode)) throw new Error('Submitted application details are required.');
  const waitlist = submitted.mode === 'waitlist';
  if (!waitlist && (!Array.isArray(ids) || !ids.includes(submitted.zone))) throw new Error('The submitted placement is not recognized.');
  if (!waitlist && (!Number.isSafeInteger(submitted.budgetCents) || submitted.budgetCents < 0 || submitted.budgetCents > 100000000)) throw new Error('A valid proposed amount is required.');
  const company = oneLine(submitted.company);
  if (!company) throw new Error('The submitted company is required.');
  const money = new Intl.NumberFormat('en-CA', {style:'currency', currency:'CAD', minimumFractionDigits:2}).format((submitted.budgetCents || 0) / 100).replace(/^\$/, 'C$');
  const lines = [
    'BrainSNN by XIO | Application confirmation', '',
    'Application reference: ' + reference,
    'Submitted details (your browser copy):',
    'Company: ' + company,
    'Request: ' + ({offer:'Private sponsorship offer', fixed:'Fixed-price request', waitlist:'Future fleet interest'})[submitted.mode],
    'Placement: ' + (waitlist ? 'Future fleet' : oneLine(submitted.placementName || submitted.zone)),
    ...(waitlist ? ['Price: Not applicable. Free expression of interest.'] : ['Proposed price: ' + money + ' before applicable tax.', 'Proposed term: 90 days from the first activation in a signed agreement.']),
    '', 'Status: Application received for review.',
    'No payment collected. No placement or robot reserved.',
    'This is not an invoice, tax receipt, contract or winning-bid notice.',
    'Hardware, venue access, staffing, dates, artwork and deliverables require written agreement before payment.',
    'No automatic email acknowledgment was sent.',
    '', 'Questions: info@xioai.ca', 'Studio: https://www.brainsnn.com/sponsor/', ''
  ];
  return {filename:'BrainSNN-application-' + reference.toLowerCase() + '.txt', text:lines.join('\n')};
}
