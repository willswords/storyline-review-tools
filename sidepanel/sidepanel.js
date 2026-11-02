// Storyline Review Tools side panel: the settings, what the course in the current tab locks, and its answer key.
'use strict';
const core = globalThis.__storylineReviewCore;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEYS = { slFree: 'freeNav', slSeek: 'seekbar', slNav: 'nav', slUnhide: 'unhide', slAnswers: 'answers' };

// The tab to show: the active one (or ?tab=<id>, used by the tests, which open this page in a tab)
const params = new URLSearchParams(location.search);
let tabId = params.has('tab') ? Number(params.get('tab')) : null;
const NO_SETTINGS = { freeNav: false, seekbar: false, nav: false, unhide: false, answers: false };
let settings = Object.assign({}, NO_SETTINGS);
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
const NAV_IDS = ['slFree', 'slSeek', 'slNav', 'slUnhide'];
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
for (const sec of document.querySelectorAll('section')) {
  const btn = sec.querySelector('.sec-toggle'), key = 'collapsed:' + sec.id;
  const set = c => { sec.classList.toggle('collapsed', c); btn.setAttribute('aria-expanded', String(!c)); };
  set(localStorage.getItem(key) === '1');
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

  renderAllNav();
  renderCompletion(st && st.completion);
  renderQuiz(st && st.quiz);
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
