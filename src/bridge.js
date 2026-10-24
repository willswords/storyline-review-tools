// Storyline Review Tools: the extension side of the course frame (an isolated content script).
// - Copies the extension's settings into the frame's localStorage, where hook.js reads them synchronously
//   before the Storyline player loads anything.
// - Reloads the course when the settings it started with are out of date (a setting was changed, or this is
//   the first time the frame sees them), so the player reads its files again with the new settings.
// - Passes hook.js's state (what the course locks, the answer key, what was changed) to the side panel.
(function () {
  'use strict';
  const SETTINGS_KEY = 'storylineReviewTools.settings';
  const RELOADS_KEY = 'storylineReviewTools.reloads';
  const norm = s => ({ freeNav: !!(s && s.freeNav), seekbar: !!(s && s.seekbar), nav: !!(s && s.nav), answers: !!(s && s.answers) });
  const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

  let wanted = null;      // the extension's settings
  let started = null;     // the settings this page load started with (from hook.js)
  let lastState = null;
  let reloading = false;

  function store(settings) {
    wanted = norm(settings);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(wanted)); } catch (e) {}
  }
  // Reload when this page load used other settings. Guarded so a browser that blocks storage can't loop:
  // at most 3 reloads in 20 seconds.
  function reloadIfOutOfDate() {
    if (reloading || !wanted || !started || same(wanted, started)) return;
    let recent = [];
    try { recent = JSON.parse(sessionStorage.getItem(RELOADS_KEY) || '[]').filter(t => Date.now() - t < 20000); } catch (e) {}
    if (recent.length >= 3) return;
    try { sessionStorage.setItem(RELOADS_KEY, JSON.stringify(recent.concat(Date.now()))); } catch (e) {}
    reloading = true;
    location.reload();
  }

  chrome.storage.local.get('settings', r => { store(r && r.settings); reloadIfOutOfDate(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    store(changes.settings.newValue);
    reloadIfOutOfDate();
  });

  document.addEventListener('storyline-review-tools:state', e => {
    let state;
    try { state = JSON.parse(e.detail); } catch (err) { return; }
    started = state.settings;
    lastState = state;
    reloadIfOutOfDate();
    if (state.player && !reloading) chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});   // fails harmlessly when the side panel is closed
  });

  // The side panel asks every frame in the tab; only a frame running a Storyline course answers
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!lastState || !lastState.player) return;
    if (msg && msg.type === 'get-state') sendResponse({ state: lastState });
    else if (msg && msg.type === 'reload') { sendResponse({ ok: true }); location.reload(); }
  });
})();
