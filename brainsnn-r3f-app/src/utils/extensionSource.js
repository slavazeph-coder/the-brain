/**
 * Layer 81 — Browser Extension Source
 *
 * Returns the file contents of a minimal Chrome/Edge MV3 extension that
 * adds a "Scan with BrainSNN" right-click menu and a popup button.
 * On click, the selected text (or the page title + URL if nothing is
 * selected) opens `brainsnn.com/?scan=<text>` in a new tab.
 *
 * We return the source strings rather than zipping in-browser so the
 * bundle stays small and users can manually drop the files into a
 * folder for Load Unpacked.
 */

const MANIFEST = {
  manifest_version: 3,
  name: 'Scan with BrainSNN',
  version: '1.0.0',
  description: 'Right-click any selected text and scan it through the BrainSNN Cognitive Firewall.',
  icons: {
    16: 'icon16.png',
    48: 'icon48.png',
    128: 'icon128.png',
  },
  permissions: ['contextMenus', 'activeTab'],
  background: { service_worker: 'background.js' },
  action: {
    default_title: 'Scan page with BrainSNN',
  },
};

const BACKGROUND = `// Layer 81 — BrainSNN extension worker
const MENU_ID = 'brainsnn-scan';
const BASE = 'https://brainsnn.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Scan with BrainSNN',
    contexts: ['selection', 'page'],
  });
});

function openScan(text) {
  const target = BASE + '/?scan=' + encodeURIComponent(text.slice(0, 4000));
  chrome.tabs.create({ url: target });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = info.selectionText
    ? info.selectionText
    : (tab?.title || '') + (tab?.url ? '. ' + tab.url : '');
  openScan(text || '(no content)');
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection ? window.getSelection().toString() : ''),
    });
    const text = (res && res.result) || (tab.title + '. ' + tab.url);
    openScan(text);
  } catch {
    openScan(tab.title + '. ' + tab.url);
  }
});
`;

const README = `# Scan with BrainSNN — browser extension

A minimal Manifest V3 extension that adds a right-click menu item
"Scan with BrainSNN" to selected text or the current page. Clicking
opens https://brainsnn.com with the text pre-loaded into the
Cognitive Firewall.

## Install (Chrome / Edge / Brave — Load Unpacked)

1. Save the four files below into an empty folder, e.g. \`~/brainsnn-ext/\`:
   - manifest.json
   - background.js
   - icon16.png, icon48.png, icon128.png  (any PNG icons — the three
     small BrainSNN logos in the repo work)
2. Open chrome://extensions (or edge://extensions)
3. Toggle "Developer mode" on
4. Click "Load unpacked" and select the folder
5. Pin the extension for quick access

## Use

- Select any text on any page → right-click → "Scan with BrainSNN"
- Or click the toolbar icon to scan the current selection / page

Everything still runs in brainsnn.com — the extension is just a
launcher.
`;

export function extensionFiles() {
  return [
    { name: 'manifest.json', content: JSON.stringify(MANIFEST, null, 2), mime: 'application/json' },
    { name: 'background.js', content: BACKGROUND, mime: 'application/javascript' },
    { name: 'README.md', content: README, mime: 'text/markdown' },
  ];
}

export const EXTENSION_PERMISSIONS = ['contextMenus', 'activeTab'];
export const EXTENSION_NAME = 'Scan with BrainSNN';
export const EXTENSION_VERSION = '1.0.0';
