import './launch.js?v=20260920-launch1';

// Progressive navigation and pricing presentation only.
// The approved robot model, applications and Stripe contracts remain in app.js.
const menu = document.getElementById('menu-toggle');
const navigation = document.getElementById('section-navigation');
if (menu && navigation) {
  const setOpen = open => {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.dataset.open = String(open);
  };
  menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { setOpen(false); menu.focus(); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.site-header')) setOpen(false); });
  matchMedia('(max-width: 700px)').addEventListener('change', () => setOpen(false));
  const links = [...navigation.querySelectorAll('a[href^="#"]')];
  const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  let scheduled = false;
  const markSection = () => {
    scheduled = false;
    let current = null;
    for (const section of sections) if (section.getBoundingClientRect().top <= innerHeight * .3) current = section.id;
    for (const link of links) {
      if (link.hash === '#' + current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(markSection); } };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  markSection();
}

// Prices are fetched from the same authoritative catalogue used by app.js.
// A failure leaves the working original placement buttons in place. No static
// availability, fabricated bids, application writes or financial actions here.
const picker = document.getElementById('zone-picker');
if (picker) {
  const money = cents => new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
  }).format(cents / 100).replace(/^\$/, 'C$');
  const prices = fetch('/api/sponsors/catalog', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
  const decorate = async () => {
    const catalog = await prices;
    if (!Array.isArray(catalog?.zones)) return;
    for (const button of picker.querySelectorAll('.zone-button')) {
      if (button.dataset.priced === 'true') continue;
      const zone = catalog.zones.find(item => item.id === button.dataset.zone);
      if (!zone || !Number.isSafeInteger(zone.opening)) continue;
      const label = document.createElement('span');
      label.className = 'zone-name'; label.textContent = zone.name;
      const price = document.createElement('span');
      price.className = 'zone-price';
      price.textContent = zone.status === 'open' ? 'From ' + money(zone.opening) : 'Under agreement';
      button.replaceChildren(label, price);
      button.setAttribute('aria-label', zone.name + ', ' + price.textContent);
      button.dataset.priced = 'true';
    }
  };
  new MutationObserver(decorate).observe(picker, { childList: true });
  void decorate();
}
