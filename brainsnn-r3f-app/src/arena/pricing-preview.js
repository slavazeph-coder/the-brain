import { PRICING_DEFAULTS, estimateRuntimePrice, formatUSD } from '../lib/arenaPricing.js';

// This preview is deliberately independent of campaigns, workers and pilot data.
// It edits hypothetical assumptions in this DOM only; it does not save or emit them.
const FIELDS = [
  ['episodes', 'Episodes', 1, 100000, '1', 'Use 1–100,000 whole episodes.'],
  ['episodesPerWorkerHour', 'Assumed episodes / worker-hour', 0.001, 10000000, 'any', 'Use a positive throughput from 0.001 to 10,000,000.'],
  ['hourlyRateUSD', 'Worker rate · USD / hour', 0.000001, 10000, 'any', 'Use a positive hourly rate from US$0.000001 to US$10,000.'],
  ['grossMarginPercent', 'Gross margin (% of price)', 0, 75, 'any', 'Use a gross margin from 0% to 75%.'],
];
const decimal = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);
const cents = value => Math.round(Number(new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)) * 100);

export function mountPricingPreview(root) {
  if (!root || root.dataset.pricingMounted === 'true') return;
  root.dataset.pricingMounted = 'true';
  const prefix = root.id || 'arena-runtime-pricing';
  root.innerHTML = `<section class="pricing-preview" aria-labelledby="${prefix}-heading">
    <div class="pricing-heading"><div><p class="campaign-kicker">TRANSPARENT ASSUMPTIONS</p><h2 id="${prefix}-heading">Illustrative runtime price · USD</h2></div><p class="pricing-availability">Illustrative budget. Hosted runs pending GPU qualification.</p></div>
    <div class="pricing-layout"><div class="pricing-controls">
      <div class="pricing-presets" role="group" aria-label="Pricing episode presets">${[[10, '10'], [1000, '1,000'], [100000, '100,000']].map(([value, label]) => `<button type="button" data-pricing-episodes="${value}" aria-pressed="false">${label}<span> episodes</span></button>`).join('')}</div>
      <div class="pricing-fields">${FIELDS.map(([key, label, min, max, step]) => `<label class="pricing-field" for="${prefix}-${key}"><span>${label}</span><input id="${prefix}-${key}" data-pricing-field="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${key === 'hourlyRateUSD' ? '0.60' : PRICING_DEFAULTS[key]}" inputmode="${key === 'episodes' ? 'numeric' : 'decimal'}" aria-describedby="${prefix}-${key}-error"><small id="${prefix}-${key}-error" data-pricing-error="${key}"></small></label>`).join('')}</div>
    </div><div class="pricing-result" aria-live="polite" aria-atomic="true">
      <p class="pricing-total-label">Runtime component with service margin</p><strong class="pricing-total" data-pricing-total>—</strong>
      <dl class="pricing-breakdown"><div><dt>Runtime compute cost</dt><dd data-pricing-output="runtimeCostUSD">—</dd></div><div><dt>Service margin allowance</dt><dd data-pricing-output="serviceMarginAllowanceUSD">—</dd></div><div><dt>Aggregate worker-hours</dt><dd data-pricing-output="workerHours">—</dd></div><div><dt>Per episode</dt><dd data-pricing-output="pricePerEpisodeUSD">—</dd></div></dl>
      <p class="pricing-status" data-pricing-status role="status"></p><p class="pricing-formula" data-pricing-formula></p>
    </div></div>
    <p class="pricing-assumptions">Episode count means total task attempts, not simultaneous robots. Throughput and rate are assumptions, unmeasured for Panda + π0.5. Worker-hours are total compute time, not a delivery estimate.</p>
    <p class="pricing-exclusions">Excludes startup, storage, transfer, retries, external inference, operator support and tax. Not a quote.</p>
  </section>`;

  function update() {
    const input = {};
    for (const [key, , , , , message] of FIELDS) {
      const field = root.querySelector(`[data-pricing-field="${key}"]`);
      const value = field.value.trim() === '' ? NaN : Number(field.value);
      input[key] = value;
      const invalid = !Number.isFinite(value) || !field.validity.valid;
      field.setAttribute('aria-invalid', String(invalid));
      root.querySelector(`[data-pricing-error="${key}"]`).textContent = invalid ? message : '';
    }
    const result = estimateRuntimePrice(input);
    root.querySelectorAll('[data-pricing-episodes]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.pricingEpisodes) === input.episodes)));
    const total = root.querySelector('[data-pricing-total]'), formula = root.querySelector('[data-pricing-formula]');
    const output = key => root.querySelector(`[data-pricing-output="${key}"]`);
    root.querySelector('[data-pricing-status]').textContent = result ? '' : 'Enter valid assumptions to show a runtime price.';
    if (!result) {
      total.textContent = '—'; formula.textContent = '';
      for (const key of ['runtimeCostUSD', 'serviceMarginAllowanceUSD', 'workerHours', 'pricePerEpisodeUSD']) output(key).textContent = '—';
      return;
    }
    // Round the total and compute independently, then derive the displayed allowance.
    // This keeps the visible dollar breakdown consistent even for sub-cent examples.
    const totalCents = cents(result.runtimePriceUSD), computeCents = cents(result.runtimeCostUSD);
    total.textContent = formatUSD(totalCents / 100);
    output('runtimeCostUSD').textContent = formatUSD(computeCents / 100);
    output('serviceMarginAllowanceUSD').textContent = formatUSD((totalCents - computeCents) / 100);
    output('workerHours').textContent = decimal(result.workerHours);
    output('pricePerEpisodeUSD').textContent = result.pricePerEpisodeUSD < 0.000001 ? '< US$0.000001' : formatUSD(result.pricePerEpisodeUSD, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
    formula.textContent = `${decimal(result.episodes)} ÷ ${decimal(result.episodesPerWorkerHour)} × ${formatUSD(result.hourlyRateUSD, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ÷ (1 − ${decimal(result.grossMarginPercent)}%) = ${formatUSD(totalCents / 100)}`;
  }
  root.addEventListener('input', event => { if (event.target.matches('[data-pricing-field]')) update(); });
  root.addEventListener('change', event => { if (event.target.matches('[data-pricing-field]')) update(); });
  root.addEventListener('click', event => {
    const preset = event.target.closest('[data-pricing-episodes]');
    if (!preset) return;
    root.querySelector('[data-pricing-field="episodes"]').value = preset.dataset.pricingEpisodes;
    update();
  });
  update();
}

window.BrainSNNArenaPricing = Object.freeze({ mount: mountPricingPreview });
function init() { document.querySelectorAll('[data-arena-pricing]').forEach(mountPricingPreview); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
