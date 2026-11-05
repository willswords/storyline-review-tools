// Storyline Review Tools side panel: the settings, what the course in the current tab locks, and its answer key.
'use strict';
const core = globalThis.__storylineReviewCore;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEYS = { slFree: 'freeNav', slSeek: 'seekbar', slNav: 'nav', slUnhide: 'unhide', slNumbers: 'menuNumbers', slAnswers: 'answers' };

// The tab to show: the active one (or ?tab=<id>, used by the tests, which open this page in a tab)
const params = new URLSearchParams(location.search);
let tabId = params.has('tab') ? Number(params.get('tab')) : null;
const NO_SETTINGS = { freeNav: false, seekbar: false, nav: false, unhide: false, menuNumbers: false, answers: false };
let settings = Object.assign({}, NO_SETTINGS);
let lastCheck = null;   // which options were unavailable when the course in the tab was last fully checked
let state = null;

async function findTab() {
  if (params.has('tab')) return;
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = t ? t.id : null;
}
// Ask the frames in the tab; only a frame running a Storyline course answers
async function askState() {
  if (tabId == null) return render(null);
  let r = null;
  try { r = await chrome.tabs.sendMessage(tabId, { type: 'get-state' }); } catch (e) {}
  render(r && r.state);
}
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'state' && sender.tab && sender.tab.id === tabId) render(msg.state);
});
chrome.tabs.onActivated.addListener(async () => { await findTab(); render(null); askState(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === 'complete') askState(); });
// Until a course answers (it may still be loading), keep asking
setInterval(() => { if (!state) askState(); }, 2000);

// ── Settings ──
chrome.storage.local.get('settings', r => { settings = Object.assign(settings, r && r.settings); render(state); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) { settings = Object.assign({}, NO_SETTINGS, changes.settings.newValue); render(state); }
});
for (const [id, key] of Object.entries(KEYS)) {
  $(id).addEventListener('change', e => {
    // Updated here straight away, so two quick clicks don't save over each other
    settings = Object.assign({}, settings, { [key]: e.target.checked });
    chrome.storage.local.set({ settings });
  });
}
// "Unlock all navigation": turns on (or off) every navigation option the course has something to unlock, saved in one
// go so the course reloads once. Ticked when they're all on, a dash when only some are.
const NAV_IDS = ['slFree', 'slSeek', 'slNav'];   // not "Add Next/Prev buttons where turned off": that adds buttons, it doesn't unlock them
const availableNav = () => NAV_IDS.filter(id => !$(id).disabled);
$('slAllNav').addEventListener('change', e => {
  const on = e.target.checked, change = {};
  for (const id of availableNav()) change[KEYS[id]] = on;
  settings = Object.assign({}, settings, change);
  chrome.storage.local.set({ settings });
  render(state);
});
function renderAllNav() {
  const ids = availableNav(), on = ids.filter(id => $(id).checked).length;
  const all = $('slAllNav');
  all.disabled = !ids.length;
  all.checked = !!ids.length && on === ids.length;
  all.indeterminate = on > 0 && on < ids.length;
}
$('btnReload').addEventListener('click', () => { chrome.tabs.sendMessage(tabId, { type: 'reload' }).catch(() => {}); });

// ── Collapsible sections (remembered in this browser) ──
// A section marked data-start-collapsed starts closed until it's first opened, so a new user isn't shown everything at once
for (const sec of document.querySelectorAll('section')) {
  const btn = sec.querySelector('.sec-toggle'), key = 'collapsed:' + sec.id;
  const set = c => { sec.classList.toggle('collapsed', c); btn.setAttribute('aria-expanded', String(!c)); };
  const saved = localStorage.getItem(key);
  set(saved === null ? sec.hasAttribute('data-start-collapsed') : saved === '1');
  btn.addEventListener('click', () => { const c = !sec.classList.contains('collapsed'); set(c); localStorage.setItem(key, c ? '1' : '0'); });
}

// ── Showing it ──
function render(st) {
  state = st && st.player ? st : null;
  st = state;
  for (const [id, key] of Object.entries(KEYS)) $(id).checked = !!settings[key];
  // A setting the course hasn't been reloaded with yet
  const pending = st && Object.keys(KEYS).some(id => !!settings[KEYS[id]] !== !!st.settings[KEYS[id]]);
  const course = $('course');
  course.classList.toggle('warn', !st);
  course.innerHTML = !st
    ? 'No Storyline course found in this tab. Open a course on Articulate Review (360.articulate.com/review/…); the settings can be changed first.'
    : (st.title ? '<b>' + esc(st.title) + '</b>' : 'Storyline course') + (pending ? ' · reloading with the new settings…' : '');
  $('btnReload').hidden = !st;
  const used = key => st && st.settings[key];   // the course was loaded with this setting on

  // Menu: frame.js menuOptions.flow
  const flow = st && st.frame && st.frame.flow;
  $('slFreeNote').innerHTML = !st ? '' : flow == null ? 'No menu navigation setting found in frame.js.'
    : flow === 'free' ? 'Menu navigation is already "free".'
    : 'Menu navigation is "' + esc(flow) + '"' + (used('freeNav') ? ' <span class="changed">→ opened as "free"</span>.' : '.');
  $('slFree').disabled = !!st && flow !== 'restricted' && flow !== 'locked' && !settings.freeNav;

  // Seekbar: frame.js controls readonly / readonlyOnce, plus any slide trigger that disables it
  const sb = st && st.frame && st.frame.seekbar, locks = st && st.locks;
  const seekLocks = locks ? locks.seek : 0;
  const seekLocked = !!(sb && sb.readonly) || seekLocks > 0;
  $('slSeekNote').innerHTML = !st ? '' : !sb && !seekLocks ? 'No seekbar setting found in frame.js.'
    : (sb && sb.readonly ? (sb.readonlyOnce ? 'Seekbar is read-only until a slide has been viewed once' : 'Seekbar is read-only') : 'Seekbar is already draggable') +
      (seekLocks ? '; ' + seekLocks + ' trigger(s) disable it' : '') +
      (used('seekbar') && seekLocked ? ' <span class="changed">→ opened as draggable</span>.' : '.');
  $('slSeek').disabled = !!st && !seekLocked && !settings.seekbar && !!(locks && locks.checked);

  // Menu numbers: frame.js menuOptions.autonumber (the player's "Number entries automatically")
  const numbered = st && st.frame && st.frame.menuNumbers;
  $('slNumbersNote').innerHTML = !st ? '' : numbered == null ? 'No menu numbering setting found in frame.js.'
    : numbered ? 'Menu entries are already numbered.'
    : 'Menu entries aren’t numbered' + (used('menuNumbers') ? ' <span class="changed">→ numbered (1.1, 1.2…)</span>.' : '.');
  $('slNumbers').disabled = !!st && numbered !== false && !settings.menuNumbers;

  // Unlock Next/Prev: slide triggers that disable (grey out) the buttons
  $('slNavNote').innerHTML = !st ? '' : !locks || !locks.checked ? 'Checking the slides…'
    : locks.nav ? locks.nav + ' trigger(s) in ' + locks.slidesWithNav + ' slide(s) disable Next/Prev' +
      (used('nav') ? ' <span class="changed">→ kept enabled</span>. Slides whose Next has no destination still won’t move on.' : '.')
    : 'No triggers that disable Next/Prev were found.';
  $('slNav').disabled = !!st && !!locks && locks.checked && !locks.nav && !settings.nav;

  // Add Next/Prev buttons where turned off: slides whose Player features (slide properties) leave the buttons out
  const hidden = locks ? locks.slidesHidingNav || 0 : 0;
  $('slUnhideNote').innerHTML = !st ? '' : !locks || !locks.checked ? 'Checking the slides…'
    : hidden ? hidden + ' slide(s) turn off Next/Prev in their Player features' +
      (used('unhide') ? ' <span class="changed">→ added</span>; Next goes to the next slide, Prev goes back.' : '.')
    : 'No slides turn off Next/Prev.';
  $('slUnhide').disabled = !!st && !!locks && locks.checked && !hidden && !settings.unhide;

  // Quiz answers
  const qs = st && st.quiz ? st.quiz.questions : [];
  const can = qs.filter(q => q.prefill).length;
  $('slAnswersNote').innerHTML = !st ? '' : !qs.length ? 'No quiz questions found in this course.'
    : !can ? 'None of the ' + qs.length + ' question(s) can be pre-filled (only multiple choice, multiple response, true/false, fill in the blank, numeric and hotspot).'
    : (can === qs.length ? 'All ' + qs.length : can + ' of ' + qs.length) + ' question(s)' +
      (used('answers') ? ' <span class="changed">open with the correct answer filled in</span>; you still press Submit.' : ' can open with the correct answer filled in.') +
      (can < qs.length ? ' The others (such as drag-and-drop and drop-down questions) are answered by hand; see Quiz answers.' : '');
  $('slAnswers').disabled = !!st && !!locks && locks.checked && !can && !settings.answers;

  // While a reloaded course is still being checked, the options keep what the last check of the same course found
  // (otherwise each would count as available for a moment, and Unlock all navigation would show a dash)
  if (st && st.locks && st.locks.checked) lastCheck = { tabId, title: st.title, disabled: Object.fromEntries(Object.keys(KEYS).map(id => [id, $(id).disabled])) };
  else if (st && lastCheck && lastCheck.tabId === tabId && lastCheck.title === st.title) {
    for (const id of Object.keys(KEYS)) if (!$(id).checked) $(id).disabled = lastCheck.disabled[id];
  }
  renderAllNav();
  renderSlide(st && st.current);
  renderVersions(st && st.versions);
  renderCompletion(st && st.completion);
  renderQuiz(st && st.quiz);
}

// Copy text: all the slide's text in a box, to select part of and paste into a Review comment. The box keeps what's
// in it (and any selection) while the same slide is showing; it's filled again when the slide changes.
let textFor = null;
// The slide's text by layer, then the closed captions of its audio and video, then its notes (under the Notes tab's
// name in the course, such as "Transcript")
const slideTextOf = cur => {
  const caps = cur.captions || [];
  const parts = cur.text.map(l => (cur.text.length > 1 || l.layer !== 'Base layer' || cur.notes || caps.length ? '— ' + l.layer + ' —\n' : '') + l.texts.join('\n\n'));
  for (const c of caps) parts.push('— Closed captions: ' + c.name + (c.layer !== 'Base layer' ? ' (' + c.layer + ')' : '') + ' —\n' + c.text);
  if (cur.captionsLoading) parts.push('(Loading the closed captions…)');
  if (cur.notes) parts.push('— ' + cur.notes.label + ' (notes) —\n' + cur.notes.text);
  return parts.length ? parts.join('\n\n') : '(No text on this slide.)';
};
let filledWith = '';
function fillSlideText(cur) {
  textFor = cur.slideId;
  $('slideTextLabel').textContent = 'Text on slide ' + cur.number + (cur.title ? ' “' + cur.title + '”' : '');
  $('slideText').value = filledWith = slideTextOf(cur);
}
function showSlideText(open) {
  $('slideTextBox').hidden = !open;
  $('btnCopyText').setAttribute('aria-expanded', String(open));
  if (open && state && state.current) { fillSlideText(state.current); $('slideText').focus(); $('slideText').setSelectionRange(0, 0); }
}
$('btnCopyText').addEventListener('click', () => showSlideText($('slideTextBox').hidden));
$('btnCloseText').addEventListener('click', () => showSlideText(false));
$('btnCopyAll').addEventListener('click', async e => {
  const btn = e.currentTarget, box = $('slideText');
  try { await navigator.clipboard.writeText(box.value); } catch (err) { box.select(); document.execCommand('copy'); }
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy all'; }, 1500);
});

// This slide: why Next and Prev are (or aren't) there, and what would get past them
function renderSlide(cur) {
  $('slideSec').hidden = !cur;
  if (!cur) { showSlideText(false); return; }
  // Filled again for a new slide, or when the captions arrive (unless the reviewer has edited the text meanwhile)
  if (!$('slideTextBox').hidden && (textFor !== cur.slideId || ($('slideText').value === filledWith && slideTextOf(cur) !== filledWith))) fillSlideText(cur);
  $('slideName').innerHTML = 'Slide <b>' + esc(cur.number) + '</b>' + (cur.title ? ' “' + esc(cur.title) + '”' : '');
  const on = key => state && state.settings[key];
  const part = (btn, label) => {
    const b = cur.buttons[btn], live = cur.live[btn];
    const status = !live.shown ? ['off', 'Not showing'] : !live.enabled ? ['off', 'Greyed out'] : ['ok', 'Available'];
    const items = [];
    if (b.off) items.push({ cls: 'lock', text: 'Turned off in this slide’s Player features (slide properties)' + (on('unhide') ? ', added by Add Next/Prev buttons where turned off.' : '.') });
    for (const t of b.triggers) items.push({ cls: t.effect === 'enable' ? 'free' : 'lock', text: t.text });
    if (btn === 'prev' && b.autoPrev && live.shown && !live.enabled && !b.triggers.some(t => t.effect !== 'enable'))
      items.push({ cls: 'lock', text: 'Storyline disables Prev on the first slide you open, as there’s nothing to go back to yet.' });
    const dest = b.goesTo.length ? b.goesTo : [];
    items.push({ cls: 'free', text: dest.length === 1 ? 'Goes to ' + dest[0] + '.' : dest.length ? 'Goes to ' + dest.slice(0, -1).join(', ') + ' or ' + dest[dest.length - 1] + ', depending on conditions.'
      : b.off && !on('unhide') ? 'Has nowhere to go: the slide was published without a ' + label + ' trigger.'
      : label + ' has no trigger on this slide, so it does nothing.' });
    // What would get past it
    const tips = [];
    if (b.off && !on('unhide')) tips.push('<b>Add Next/Prev buttons where turned off</b> adds it.');
    if (b.triggers.some(t => t.effect === 'disable') && !on('nav')) tips.push('<b>Unlock Next/Prev buttons</b> keeps it enabled.');
    if (b.triggers.some(t => t.effect === 'disable') && on('nav')) tips.push('Unlock Next/Prev buttons is on, so its Disabled triggers don’t take effect.');
    if (b.triggers.some(t => t.effect === 'hide')) tips.push('No option overrides a trigger that hides it' + (on('freeNav') ? '; jump on from the menu.' : '; <b>Free navigation (menu)</b> lets you jump on from the menu.'));
    return '<div><div class="btn-head">' + label + ' <span class="badge ' + status[0] + '">' + status[1] + '</span></div><ul>' +
      items.map(i => '<li class="' + i.cls + '">' + esc(i.text) + '</li>').join('') + '</ul>' +
      (tips.length && status[0] === 'off' ? '<div class="tip">' + tips.join(' ') + '</div>' : '') + '</div>';
  };
  const vals = Object.entries(cur.values || {});
  $('slideNav').innerHTML = part('next', 'Next') + part('prev', 'Prev') +
    (cur.jumps.length ? '<div><div class="btn-head">Buttons on this slide</div><ul>' + cur.jumps.map(j => '<li class="free">“' + esc(j.name) + '” goes to ' + esc(j.to) + '.</li>').join('') + '</ul></div>' : '') +
    (vals.length ? '<div class="now">Now: ' + vals.map(([k, v]) => esc(k) + ' = ' + esc(typeof v === 'boolean' ? (v ? 'True' : 'False') : JSON.stringify(v))).join(', ') + '</div>' : '');
}

// Changes since an earlier version: the versions of this course opened in this browser, and what changed
// "Published 10/31/2026 at 8:09 PM", as Review's version menu shows it
const publishedOn = iso => {
  const d = new Date(iso);
  return isNaN(d) ? 'an earlier version' : 'Published ' + d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
$('versPick').addEventListener('change', e => { chrome.tabs.sendMessage(tabId, { type: 'compare', folder: e.target.value }).catch(() => {}); });
const quoted = s => '“' + esc(s.length > 400 ? s.slice(0, 399) + '…' : s) + '”';
// Old text, then the new text on its own line after the arrow, so the two line up for reading. Word by word
// (core.wordChanges): in the old text the removed words are bold; in the new text the added words are bold and
// highlighted, and "[…]" marks where words were removed without a replacement (pointing at it shows them).
const marked = (text, cls) => { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text); return m[1] + (m[2] ? '<b class="' + cls + '">' + esc(m[2]) + '</b>' : '') + m[3]; };
function wasNow(was, now) {
  const parts = core.wordChanges(was, now);
  if (was.length + now.length > 1600 || parts.filter(p => p.op === 'same').reduce((n, p) => n + p.text.trim().length, 0) < 3)   // nothing in common, or very long
    return '<span class="was">' + quoted(was) + '</span> →<br><span class="now">' + quoted(now) + '</span>';
  let old = '', neu = '';
  parts.forEach((p, k) => {
    if (p.op === 'same') { old += esc(p.text); neu += esc(p.text); }
    else if (p.op === 'add') neu += marked(p.text, 'ins');
    else {
      old += marked(p.text, 'del');
      // Removed with nothing added in its place: a marker in the new text
      if (!(parts[k + 1] && parts[k + 1].op === 'add') && !(parts[k - 1] && parts[k - 1].op === 'add'))
        neu += '<span class="cut" title="Removed: ' + esc(p.text.trim()) + '" aria-label="removed: ' + esc(p.text.trim()) + '">[…]</span>' + (/\s$/.test(p.text) && !/\s$/.test(neu) ? ' ' : '');
    }
  });
  return '<span class="was">“' + old + '”</span> →<br><span class="now">“' + neu + '”</span>';
}
function renderVersions(v) {
  $('versSec').hidden = !v;
  if (!v) return;
  const has = v.others.length > 0;
  $('versNone').hidden = has;
  $('versSome').hidden = !has;
  const d = v.diff;
  const total = d ? d.added.length + d.removed.length + d.changed.length : 0;
  $('versCount').hidden = !d;
  $('versCount').textContent = total;
  if (!has) return;
  // The list of versions to compare with (kept as it is while the user is choosing)
  const pick = $('versPick');
  const opts = v.others.map(o => '<option value="' + esc(o.folder) + '"' + (o.folder === v.comparedWith ? ' selected' : '') + '>' +
    esc(publishedOn(o.published) + ' · ' + o.slides + ' slide' + (o.slides === 1 ? '' : 's')) + '</option>').join('');
  if (pick.dataset.opts !== opts) { pick.innerHTML = opts; pick.dataset.opts = opts; }
  if (!d) { $('versSummary').textContent = ''; $('versList').innerHTML = ''; return; }
  const parts = [d.changed.length && d.changed.length + ' changed', d.added.length && d.added.length + ' added', d.removed.length && d.removed.length + ' removed'].filter(Boolean);
  $('versSummary').innerHTML = (v.thisIsNewer ? 'From that version to this one: ' : 'This version is the older one. From this version to that one: ') +
    (parts.length ? '<b>' + parts.join(', ') + '</b> slide' + (total === 1 ? '' : 's') : '<b>no changes</b> in the text') + (d.unchanged ? '; ' + d.unchanged + ' unchanged' : '') + '.' +
    (d.notChecked ? ' ' + d.notChecked + ' slide(s) couldn’t be read.' : '') +
    (d.captionsCompared === false ? ' Closed captions weren’t compared: one of the versions was saved before captions were, or they couldn’t be read. Open it again to update it.' : '');
  // A slide in the version showing is a link that goes to it; one only in the other version is plain text
  const name = s => 'Slide ' + esc(s.number) + (s.title ? ' “' + esc(s.title) + '”' : '');
  // The slide showing in the course is highlighted, with a tag (only a slide in this version can be showing)
  const showing = state && state.current && state.current.slideId;
  const isShowing = (s, here = true) => here && !!s.id && s.id === showing;
  const slide = (s, here = true) => (here && s.id ? '<a href="#" class="go" data-slide="' + esc(s.id) + '" title="Go to this slide">' + name(s) + '</a>' : name(s)) +
    (isShowing(s, here) ? ' <span class="here-tag">You’re on this slide</span>' : '');
  const li = (s, here = true) => '<li' + (isShowing(s, here) ? ' class="here" aria-current="true"' : '') + '>';
  const html =
    d.changed.map(c => li(c) + slide(c) +
      [c.moved ? 'moved from slide ' + esc(c.moved) : '', c.renamed ? 'renamed from “' + esc(c.renamed) + '”' : ''].filter(Boolean).map(t => '<div class="what">' + t + '</div>').join('') +
      c.text.map(t => '<div class="pair">' + changeLine(t) + '</div>').join('') +
      // Captions and notes under one heading each (per layer for captions), with their changes listed below it
      labelled(c.captions || [], 'Captions') + labelled(Array.isArray(c.notes) ? c.notes : [], 'Notes') +
      '</li>').join('') +
    d.added.map(s => li(s, v.thisIsNewer) + '<span class="add">Added</span> ' + slide(s, v.thisIsNewer) + '</li>').join('') +
    d.removed.map(s => li(s, !v.thisIsNewer) + '<span class="del">Removed</span> ' + slide(s, !v.thisIsNewer) + ' <span class="what">(its number in the older version)</span></li>').join('');
  // (only when it changed, so the list isn't rebuilt under the reviewer's pointer as the course plays)
  if ($('versList').dataset.html !== html) { $('versList').innerHTML = html; $('versList').dataset.html = html; }
}
// One change: old → new, or Added / Removed
const changeLine = t => t.was != null && t.now != null ? wasNow(t.was, t.now)
  : t.now != null ? '<span class="add">Added</span> ' + quoted(t.now) : '<span class="del">Removed</span> ' + quoted(t.was);
// Changes under a heading shown once: "Captions:", or "Captions (Layer 2):" for a layer's captions (each line's
// "[Layer 2] " label goes into the heading)
function labelled(lines, name) {
  const groups = new Map();
  for (const t of lines) {
    const layer = (/^\[([^\]]+)\] /.exec(t.now != null ? t.now : t.was) || [])[1] || '';
    const strip = s => s == null ? s : s.replace(/^\[[^\]]+\] /, '');
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push({ was: strip(t.was), now: strip(t.now) });
  }
  return [...groups].map(([layer, list]) => '<div class="pair"><div class="pair-head">' + name + (layer ? ' (' + esc(layer) + ')' : '') + ':</div>' +
    list.map(t => '<div class="pair-item">' + changeLine(t) + '</div>').join('') + '</div>').join('');
}
// A slide link: go to that slide in the course
$('versList').addEventListener('click', e => {
  const a = e.target.closest('a.go');
  if (!a) return;
  e.preventDefault();
  chrome.tabs.sendMessage(tabId, { type: 'goto', slide: a.dataset.slide }).catch(() => {});
});

// Estimated seat time (core.seatTime): rounded to the minute, as a catalogue would list it
const minutes = ms => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
};
const exact = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : ''); };
function renderSeat(seat) {
  const how = $('compSeatHow');
  if (!seat) { $('compSeat').textContent = 'Reading the course…'; how.hidden = true; return; }
  const upTo = seat.layersMs >= 30000 ? ' (up to ' + esc(minutes(seat.ms + seat.layersMs)) + ' if every layer is opened)' : '';
  $('compSeat').innerHTML = 'About <b>' + esc(minutes(seat.ms)) + '</b>' + upTo + (seat.unread ? ' · still reading ' + seat.unread + ' slide(s)…' : '');
  how.hidden = false;
  $('compSeatList').innerHTML = [
    'Slide timelines: ' + exact(seat.timelineMs) + ' across ' + seat.slides + ' slide(s)' + (seat.drawn ? ', including ' + seat.drawn + ' drawn from a question bank' : '') + '.',
    seat.readingMs >= 1000 ? 'Reading time: ' + exact(seat.readingMs) + ' more, for slides whose text takes longer to read than their timeline (at ' + seat.wpm + ' words a minute).' : '',
    seat.layersMs >= 1000 ? 'Layers: up to ' + exact(seat.layersMs) + ' more, if every layer (feedback, tabs, pop-ups) is opened.' : '',
    seat.questions ? 'Not included: time spent answering ' + seat.questions + ' question(s).' : '',
    'Assumes every slide is viewed once, without pauses or replays.'
  ].filter(Boolean).map(t => '<li>' + esc(t) + '</li>').join('');
}

// Completion: the status the course has reported in this session, what an LMS would get, and how the course completes
const mmss = ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
const onSlide = sl => sl && sl.number ? 'slide ' + esc(sl.number) + (sl.title ? ' “' + esc(sl.title) + '”' : '') : sl && sl.title ? '“' + esc(sl.title) + '”' : '';
function renderCompletion(c) {
  $('compSec').hidden = !c;
  if (!c) return;
  const words = core.STATUS_WORDS;
  const last = [...c.history].reverse().find(h => h.kind === 'status' || h.kind === 'reset');
  const done = c.status && c.status !== 'incomplete';
  const cls = !done ? '' : c.status === 'fail' ? 'fail' : 'ok';
  $('compNow').innerHTML = '<span class="badge ' + cls + '">' + (done ? (c.status === 'fail' ? '✕ ' : '✓ ') + esc(words[c.status]) : c.status ? 'Incomplete' : 'Not reported yet') + '</span>' +
    '<span class="when">' + (c.watching === false ? 'Can’t follow this course’s status: its Storyline player isn’t one this extension knows.'
      : done && last ? 'From the ' + esc(last.reason || 'course') + (onSlide(last.slide) ? ', on ' + onSlide(last.slide) : '') + ', ' + mmss(last.at) + ' into the session.'
      : c.status === 'incomplete' && last ? 'Set back to incomplete on ' + (onSlide(last.slide) || 'a slide') + ', ' + mmss(last.at) + ' into the session (such as when a quiz is retried).'
      : c.watching ? 'Watching the course. A message shows over the course when its status changes.' : 'Waiting for the course to start…') +
      (!done && c.score != null ? ' Score so far: ' + esc(c.score) + '%.' : '') + '</span>';
  // What an LMS would get, for the status reported now: under "LMS details", closed until opened (its contents are
  // replaced, never the element itself, so it stays open as the state updates)
  const calls = c.status && core.LMS_CALLS[c.status], score = c.score != null ? core.SCORE_CALLS(c.score) : null;
  $('compLms').hidden = !calls;
  $('compCalls').innerHTML = !calls ? '' :[['SCORM 1.2', 'scorm12'], ['SCORM 2004', 'scorm2004'], ['xAPI', 'xapi']].map(([label, k]) =>
    '<span>' + label + '</span><span><code>' + esc(calls[k]) + '</code>' + (score && k !== 'xapi' ? '<br><code>' + esc(score[k]) + '</code>' : '') + '</span>').join('');
  $('compHistory').innerHTML = c.history.map(h => '<li><span class="t">' + mmss(h.at) + '</span>' + (
    h.kind === 'reset' ? 'Back to Incomplete'
    : '<span class="' + (h.status === 'fail' ? 'fail' : 'ok') + '">' + esc(words[h.status]) + '</span>' + (h.score != null ? ' · score ' + esc(h.score) + '%' : '') + (h.reason ? ' · ' + esc(h.reason) : '')) +
    (onSlide(h.slide) ? ' · ' + onSlide(h.slide) : '') + '</li>').join('');

  renderSeat(c.seat);
  // How the course completes, from data.js
  const info = c.info;
  if (!info) { $('compHow').innerHTML = '<div class="rep">Reading the course…</div>'; return; }
  const where = w => w.map(x => '<div class="where">' + (x.number ? 'Slide ' + esc(x.number) + ' “' + esc(x.title) + '”' : esc(x.title)) + ', ' + esc(x.when) + '</div>').join('');
  const list = info.criteria.map(x => '<li>' + esc(x.text) + where(x.where) + (x.detail && !x.where.length ? '<div class="where">' + esc(x.detail) + '</div>' : '') + '</li>');
  const rep = info.reports;
  const hasQuiz = info.criteria.some(x => x.kind === 'quiz');
  $('compHow').innerHTML = (info.criteria.length ? (info.any ? 'Complete when <b>any one</b> is met (the first one met gives the status):' : 'Complete when:') + '<ul>' + list.join('') + '</ul>' : '') +
    (info.incompleteTriggers.length ? '<div class="rep">Incomplete Course triggers (report ' + esc(rep ? rep.notMetWord : 'not met') + '):' + where(info.incompleteTriggers) + '</div>' : '') +
    (rep ? '<div class="rep">Reports <b>' + esc(rep.metWord) + '</b> when met' + (hasQuiz ? ', and <b>' + esc(rep.notMetWord) + '</b> when the quiz is failed' : '') +
      '. These words come from the course’s Reporting setting; check it’s the same under Publish › LMS › Reporting and Tracking.</div>' : '') +
    (info.checked ? '' : '<div class="rep">Still reading some slides…</div>') +
    info.problems.map(p => '<div class="problem">⚠ ' + esc(p) + '</div>').join('');
}

// The answer key, as the course scores it
function renderQuiz(key) {
  $('quizSec').hidden = !key;
  if (!key) return;
  const qs = key.questions, manyQuizzes = key.quizzes.length > 1;
  $('quizCount').textContent = qs.length;
  $('quizInfo').innerHTML = key.quizzes.map(q => esc(q.name) + (q.survey ? ' · survey' : q.passPercent != null ? ' · pass mark ' + esc(q.passPercent) + '%' : '')).join('<br>') +
    (key.quizzes.length ? '<br>' : '') + 'Correct answers as the course scores them (from <code>data.js</code>).' +
    (qs.some(q => q.bank) ? ' Questions marked “bank” come from a question bank, so the quiz may use only some of them, in any order.' : '');
  $('quizList').innerHTML = qs.map(q => {
    const pts = q.correct.length ? q.correct[0].points : null;
    // The slide title tells apart copies of a question (such as "1st Attempt" and "2nd Attempt" slides)
    const meta = [q.slideTitle && q.slideTitle !== q.title ? q.slideTitle : '', core.QUESTION_TYPES[q.type] || q.type, pts != null && !q.survey ? pts + ' pt' + (pts === 1 ? '' : 's') : '', q.bank ? 'bank' : '',
      manyQuizzes ? q.quiz : '', q.correct.length && !q.survey && !q.prefill ? 'answer by hand' : ''].filter(Boolean).map(esc).join(' · ');
    // Each part of an answer on its own line (all needed); alternative correct answers separated by "or"
    const ans = q.survey ? '<div class="none">Survey question: no correct answer</div>'
      : !q.correct.length ? '<div class="none">No answer is marked correct</div>'
      : (q.type === 'fillin' && q.correct.length > 1 ? '<div class="meta">Any of' + (q.note ? ' (' + esc(q.note) + ')' : '') + ':</div>' : '') +
        q.correct.map((c, i) => (i && q.type !== 'fillin' ? '<div class="meta">or</div>' : '') + c.parts.map(p => '<div class="ans">' + esc(p) + '</div>').join('')).join('');
    return '<li><div class="q">' + esc(q.title) + '</div><div class="meta">' + meta + '</div>' + ans + '</li>';
  }).join('');
}

findTab().then(askState);
