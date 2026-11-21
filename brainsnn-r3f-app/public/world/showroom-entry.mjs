const host = document.querySelector('#showroom');
let page;
let opening;

async function openFromLink() {
  if (!host || !['#showroom', '#showroom-walk'].includes(location.hash)) return;
  host.hidden = false;
  host.focus({preventScroll: true});
  host.scrollIntoView({block: 'start'});
  if (!page) {
    const status = host.querySelector('[data-room-status]');
    status.textContent = 'Opening the showroom…';
    try {
      opening ??= import('./showroom-page.mjs').then(({mountShowroomPage}) => mountShowroomPage(host));
      page = await opening;
    } catch {
      status.textContent = 'The showroom could not open. Refresh the page to try again.';
      return;
    } finally {
      opening = undefined;
    }
  }
  if (location.hash === '#showroom-walk' && !host.hidden) {
    const walk = host.querySelector('[data-el="walk"]');
    if (walk) {
      walk.open = true;
      walk.querySelector('summary').focus({preventScroll:true});
      walk.scrollIntoView({block:'start'});
    }
  }
}

host?.querySelector('[data-close-showroom]')?.addEventListener('click', () => {
  page?.pause();
  host.hidden = true;
});
window.addEventListener('hashchange', openFromLink);
openFromLink();
