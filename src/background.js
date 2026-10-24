// Storyline Review Tools: opens the side panel from the toolbar button, and shows "ON" on the button
// while any setting is on (they apply to every Review course until turned off).
'use strict';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function showBadge(settings) {
  const on = !!settings && ['freeNav', 'seekbar', 'nav', 'answers'].some(k => settings[k]);
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
  chrome.action.setTitle({ title: on ? 'Storyline Review Tools (on)' : 'Storyline Review Tools' });
}
chrome.storage.local.get('settings', r => showBadge(r && r.settings));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) showBadge(changes.settings.newValue); });
