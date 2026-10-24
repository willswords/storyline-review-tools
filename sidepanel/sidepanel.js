// Storyline Review Tools side panel: the settings, what the course in the current tab locks, and its answer key.
'use strict';
const core = globalThis.__storylineReviewCore;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEYS = { slFree: 'freeNav', slSeek: 'seekbar', slNav: 'nav', slAnswers: 'answers' };

// The tab to show: the active one (or ?tab=<id>, used by the tests, which open this page in a tab)
const params = new URLSearchParams(location.search);
let tabId = params.has('tab') ? Number(params.get('tab')) : null;
let settings = { freeNav: false, seekbar: false, nav: false, answers: false };
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
  if (area === 'local' && changes.settings) { settings = Object.assign({ freeNav: false, seekbar: false, nav: false, answers: false }, changes.settings.newValue); render(state); }
});
for (const [id, key] of Object.entries(KEYS)) {
  $(id).addEventListener('change', e => {
    // Updated here straight away, so two quick clicks don't save over each other
    settings = Object.assign({}, settings, { [key]: e.target.checked });
    chrome.storage.local.set({ settings });
  });
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

  // Next/Prev: slide triggers that disable the buttons
  $('slNavNote').innerHTML = !st ? '' : !locks || !locks.checked ? 'Checking the slides…'
    : locks.nav ? locks.nav + ' trigger(s) in ' + locks.slidesWithNav + ' slide(s) disable Next/Prev' +
      (used('nav') ? ' <span class="changed">→ kept enabled</span>. Slides whose Next has no destination still won’t move on.' : '.')
    : 'No triggers that disable Next/Prev were found.';
  $('slNav').disabled = !!st && !!locks && locks.checked && !locks.nav && !settings.nav;

  // Quiz answers
  const qs = st && st.quiz ? st.quiz.questions : [];
  const can = qs.filter(q => q.prefill).length;
  $('slAnswersNote').innerHTML = !st ? '' : !qs.length ? 'No quiz questions found in this course.'
    : !can ? 'None of the ' + qs.length + ' question(s) can be pre-filled (only multiple choice, multiple response, true/false, fill in the blank, numeric and hotspot).'
    : (can === qs.length ? 'All ' + qs.length : can + ' of ' + qs.length) + ' question(s)' +
      (used('answers') ? ' <span class="changed">open with the correct answer filled in</span>; you still press Submit.' : ' can open with the correct answer filled in.') +
      (can < qs.length ? ' The others (such as drag-and-drop and drop-down questions) are answered by hand; see Quiz answers.' : '');
  $('slAnswers').disabled = !!st && !!locks && locks.checked && !can && !settings.answers;

  renderQuiz(st && st.quiz);
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
