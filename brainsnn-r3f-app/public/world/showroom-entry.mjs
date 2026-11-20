const host = document.querySelector('#showroom');
let page;
let opening;

async function openFromLink() {
  if (location.hash !== '#showroom' || !host) return;
  host.hidden = false;
  host.focus({preventScroll: true});
  host.scrollIntoView({block: 'start'});
  if (page || opening) return;
  const status = host.querySelector('[data-room-status]');
  status.textContent = 'Opening the showroom…';
  try {
    opening = import('./showroom-page.mjs');
    const {mountShowroomPage} = await opening;
    page = mountShowroomPage(host);
  } catch {
    status.textContent = 'The showroom could not open. Refresh the page to try again.';
  } finally {
    opening = undefined;
  }
}

host?.querySelector('[data-close-showroom]')?.addEventListener('click', () => {
  page?.pause();
  host.hidden = true;
});
window.addEventListener('hashchange', openFromLink);
openFromLink();
