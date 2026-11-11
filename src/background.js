// Storyline Review Tools: opens the side panel from the toolbar button, and shows "ON" on the button
// while any setting is on (they apply to every Review course until turned off).
'use strict';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function showBadge(settings) {
  const on = !!settings && ['freeNav', 'seekbar', 'nav', 'unhide', 'menuNumbers', 'answers'].some(k => settings[k]);
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
  chrome.action.setTitle({ title: on ? 'Storyline Review Tools (on)' : 'Storyline Review Tools' });
}
chrome.storage.local.get('settings', r => showBadge(r && r.settings));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) showBadge(changes.settings.newValue); });

// ── Added sites (the Options page) ──
// Besides Articulate Review (the manifest's content_scripts), the extension runs on the sites added in Options, such as
// an LMS that serves Storyline courses, once Chrome has given it access to each (chrome.permissions). Each site gets the
// same scripts, at the same point and in every frame, registered here and kept in step with the list and the access.
const SITE_SCRIPTS = [
  { id: 'srt-added-hook', js: ['src/core.js', 'src/hook.js'], world: 'MAIN' },
  { id: 'srt-added-bridge', js: ['src/bridge.js'], world: 'ISOLATED' }
];
// Review sites with a switch of their own in Options (storage key → the courses' address)
const REVIEW_SITES = { reviewMyElearning: 'https://reviewmyelearning.com/content/*' };
async function syncSites() {
  const stored = await chrome.storage.local.get(['extraSites'].concat(Object.keys(REVIEW_SITES)));
  const wanted = new Set(Array.isArray(stored.extraSites) ? stored.extraSites : []);
  for (const [key, p] of Object.entries(REVIEW_SITES)) if (stored[key]) wanted.add(p);
  const allowed = [];
  for (const p of wanted) {
    if (await chrome.permissions.contains({ origins: [p] }).catch(() => false)) allowed.push(p);
  }
  const ids = (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  if (allowed.length) {
    await chrome.scripting.registerContentScripts(SITE_SCRIPTS.map(s => ({
      id: s.id, js: s.js, world: s.world, matches: allowed, runAt: 'document_start', allFrames: true, persistAcrossSessions: true
    })));
  }
}
// (one at a time, so two quick changes can't register the same ids twice)
let syncing = Promise.resolve();
const resyncSites = () => { syncing = syncing.then(syncSites).catch(e => console.warn('Storyline Review Tools: added sites:', e)); return syncing; };
chrome.runtime.onInstalled.addListener(resyncSites);
chrome.runtime.onStartup.addListener(resyncSites);
chrome.permissions.onAdded.addListener(resyncSites);
chrome.permissions.onRemoved.addListener(resyncSites);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.extraSites || Object.keys(REVIEW_SITES).some(k => changes[k]))) resyncSites();
});
