// Storyline Review Tools: runs in the course frame's own JavaScript world, before the Storyline player.
// The player loads each data file by calling window.globalProvideData(kind, json). This wraps that function
// and changes the JSON on its way in, so the course on Articulate Review is never changed, only what this
// browser loads. Settings come from the frame's localStorage, which bridge.js keeps in step with the
// extension's settings (it has to be readable synchronously, before the player's first file arrives).
(function () {
  'use strict';
  const core = window.__storylineReviewCore;
  if (!core || window.__storylineReviewHook) return;
  Object.defineProperty(window, '__storylineReviewHook', { value: true });

  const SETTINGS_KEY = 'storylineReviewTools.settings';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) {}
  // The settings this page load uses (sent with every state, so bridge.js can tell if they're out of date)
  const settings = { freeNav: !!saved.freeNav, seekbar: !!saved.seekbar, nav: !!saved.nav, unhide: !!saved.unhide, answers: !!saved.answers };

  // What the side panel shows: what the course does, and what was changed
  const state = {
    player: false,          // the Storyline player has started in this frame
    settings,
    title: '',
    frame: null,            // { flow, seekbar, hidesNav } as published
    locks: null,            // { nav, seek, slidesWithNav, slidesHidingNav, slideFiles, checked } across all slides
    quiz: null,             // the answer key (core.buildQuizKey)
    changed: { frame: 0, nav: 0, seek: 0, answers: 0, slides: 0 },
    // How the course completes (core.completionInfo), and what it has reported in this session
    completion: { info: null, watching: null, status: null, score: null, history: [] },
    // The slide showing now: what it does to Next and Prev (core.explainSlide), their state on screen, variable values
    current: null,
    // This version of the course, the earlier versions opened in this browser, and what changed (see compareVersions)
    versions: null,
    errors: []
  };
  const startedAt = Date.now();
  let data = null;                      // data.js, as published
  let notes = null;                     // each slide's notes, from frame.js (core.slideNotes)
  const slideCache = new Map();         // html5url → slide JSON as published
  const fileOfSlide = new Map();        // slide id → html5url
  const lockCounts = new Map();         // html5url (or '#data' for slides inside data.js) → { nav, seek, layouts }
  const lockInfo = slide => Object.assign(core.countLocks(slide), { layouts: core.slideLayouts(slide) });

  // ── Talking to bridge.js (the extension side), through events on the document ──
  let sendTimer = 0;
  function sendState() {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      if (document.title) state.title = document.title;   // Storyline sets it to the course title
      document.dispatchEvent(new CustomEvent('storyline-review-tools:state', { detail: JSON.stringify(state) }));
    }, 50);
  }
  document.addEventListener('storyline-review-tools:get-state', sendState);
  const fail = (where, e) => { state.errors.push(where + ': ' + (e && e.message || e)); sendState(); };

  function updateLocks(done) {
    let nav = 0, seek = 0, slidesWithNav = 0, slidesHidingNav = 0;
    const hiding = new Set((state.frame && state.frame.hidesNav) || []);
    for (const c of lockCounts.values()) {
      nav += c.nav; seek += c.seek; if (c.nav) slidesWithNav++;
      if (c.layouts.some(l => hiding.has(l))) slidesHidingNav++;   // the slide's Player features hide Prev or Next
    }
    state.locks = { nav, seek, slidesWithNav, slidesHidingNav, slideFiles: data ? core.slideFiles(data).length : 0, checked: !!done };
  }
  function updateQuiz() {
    if (data) state.quiz = core.buildQuizKey(data, f => slideCache.get(f) || null);
  }
  function updateCompletion() {
    if (!data) return;
    state.completion.info = core.completionInfo(data, f => slideCache.get(f) || null);
    state.completion.seat = core.seatTime(data, f => slideCache.get(f) || null);
  }

  // ── Completion: what the course would report to an LMS ──
  // On Review the player has no LMS to report to, but it still works out the course's status and announces each change
  // on its event bus (DS.pubSub). This listens to the same events as the player's SCORM interface and follows its rules,
  // so it reports what that interface would send: the first Passed, Failed or Completed (again after the scored quiz is
  // retried), Incomplete whenever the status falls back to it, and the quiz score until a status is sent.
  function watchCompletion() {
    let tries = 0;
    const timer = setInterval(() => {
      const DS = window.DS;
      if (DS && DS.pubSub && typeof DS.pubSub.on === 'function' && DS.events && DS.presentation && typeof DS.presentation.scorings === 'function') {
        clearInterval(timer);
        try { listenForStatus(DS); } catch (e) { state.completion.watching = false; fail('completion', e); }
        watchSlide(DS);
      } else if (++tries > 1200) { clearInterval(timer); state.completion.watching = false; sendState(); }   // 2 minutes: a player this doesn't know
    }, 100);
  }
  function listenForStatus(DS) {
    const E = DS.events, ev = (group, name, fallback) => (E[group] && E[group][name]) || fallback;
    const scorings = () => DS.presentation.scorings();
    const isQuiz = t => !!t && typeof t.isType === 'function' && t.isType('quiz');
    const lms = { sent: false, lastStatus: null, lastScore: null, scored: null };
    // The slide showing now, numbered as in the menu
    const currentSlide = () => {
      try {
        const s = DS.windowManager.getCurrentWindow().getCurrentSlide();
        const hit = data && core.slideOf(core.slideIndex(data), s.absoluteId);
        return hit ? { number: hit.number, title: hit.title } : { number: '', title: String(s.get('title') || '').replace(/<[^>]*>/g, '').trim() };
      } catch (e) { return null; }
    };
    // Which tracking option the status comes from: the first one met, as the player's getStatus picks it
    const reason = () => {
      try {
        const first = scorings().find(s => s.isCourseComplete());
        return !first ? '' : first.isAction() ? 'Complete Course trigger' : first.isView() ? 'slides viewed' : 'quiz result';
      } catch (e) { return ''; }
    };
    // The history of status changes. The score isn't listed on its own: the player sends the running score after every
    // question (5%, 10%, … 100% for a 20-question quiz), so it's kept as the current score and in each status entry.
    const record = entry => {
      entry.at = Date.now() - startedAt;
      entry.slide = currentSlide();
      state.completion.history.push(entry);
      sendState();
      return entry;
    };
    function updateScore(t) {
      if (lms.sent) return;
      if (t == null) t = scorings().guessCurrentScoring();
      if (!isQuiz(t)) return;
      const pct = t.prop('PercentScore');
      if (lms.lastScore === pct) return;
      lms.lastScore = pct; lms.scored = t;
      state.completion.score = pct;
      sendState();
    }
    function send(status) {
      if (status === 'incomplete') {
        const was = state.completion.status;
        state.completion.status = 'incomplete';
        if (was && was !== 'incomplete') record({ kind: 'reset', status });
        return;
      }
      if (!core.LMS_CALLS[status] || lms.sent) return;
      lms.sent = true;
      state.completion.status = status;
      showAlert(record({ kind: 'status', status, reason: reason(), score: state.completion.score }));
    }
    function reportStatus(t) {
      updateScore(t);
      const s = scorings().getStatus();
      if (lms.lastStatus !== s) { lms.lastStatus = s; send(s); }
    }
    const on = (name, fn) => DS.pubSub.on(name, function () { try { fn.apply(null, arguments); } catch (e) { fail('completion', e); } });
    on(ev('status', 'UPDATED', 'status:updated'), t => reportStatus(t));
    on(ev('course', 'COMPLETED', 'course:completed'), t => reportStatus(t));
    on(ev('course', 'MANUALLY_COMPLETED', 'course:manuallyCompleted'), (t, scoring) => reportStatus(scoring));
    on(ev('course', 'VIEWED', 'course:viewed'), () => send(scorings().getStatus()));
    on(ev('quiz', 'RETRIED', 'quiz:retried'), t => { if (lms.scored === t) lms.sent = false; });
    state.completion.watching = true;
    // Already met before this started listening (such as a course resumed where it was complete)
    if (scorings().getStatus() !== 'incomplete') reportStatus();
    sendState();
  }

  // ── This slide: "why can't I move on?" ──
  // Twice a second: which slide is showing, and whether its Next and Prev are on screen and enabled. The slide's
  // triggers are explained once per slide, from its file as published (so what the settings change still shows).
  function watchSlide(DS) {
    let explainedFor = null, explained = null, last = '';
    const button = id => {
      const el = document.getElementById(id);
      if (!el) return { shown: false, enabled: false };
      const r = el.getBoundingClientRect(), st = getComputedStyle(el);
      const shown = !!r.width && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
      return { shown, enabled: shown && !el.classList.contains('cs-disabled') && el.getAttribute('aria-disabled') !== 'true' };
    };
    setInterval(() => {
      try {
        const s = DS.windowManager.getCurrentWindow().getCurrentSlide();
        const id = s && String(s.absoluteId || '').split('.').pop();
        if (!id || !data) return;
        if (id !== explainedFor) {
          const file = fileOfSlide.get(id);
          let slide = file ? slideCache.get(file) : null;
          if (!slide && !file) for (const sc of data.scenes || []) for (const x of sc.slides || []) if (x.id === id && x.slideLayers) slide = x;
          if (!slide) return;   // not read yet: tried again on the next tick
          const note = notes && notes.bySlide[id];
          explained = Object.assign(core.explainSlide(slide, data, state.frame), { text: core.slideText(slide), notes: note ? { label: notes.label, text: note } : null, captions: null });
          explainedFor = id;
          loadCaptions(slide, explained);
        }
        const player = window.GetPlayer && window.GetPlayer();
        const values = {};
        for (const v of explained.vars) { try { values[v] = player.GetVar(v); } catch (e) {} }
        const cur = Object.assign({}, explained, { live: { next: button('next'), prev: button('prev') }, values });
        const json = JSON.stringify(cur);
        if (json !== last) { last = json; state.current = cur; sendState(); }
      } catch (e) { /* the player is between slides */ }
    }, 500);
  }

  // The closed captions of the slide's audio and video, from their captions files (each read once); captions is
  // [] while they're loading, then [{ layer, name, text }] (the watch above sends them on its next tick)
  const captionFiles = new Map();
  function loadCaptions(slide, into) {
    const media = core.slideMedia(slide, data);
    if (!media.length) return;
    into.captions = [];
    into.captionsLoading = true;
    Promise.all(media.map(m => {
      if (!captionFiles.has(m.file)) captionFiles.set(m.file, fetch(new URL(m.file, location.href), { credentials: 'same-origin' })
        .then(r => r.ok ? r.text() : '').then(core.captionsText).catch(() => ''));
      return captionFiles.get(m.file).then(text => text ? { layer: m.layer, name: m.name, text } : null);
    })).then(list => { into.captions = list.filter(Boolean); into.captionsLoading = false; });
  }

  // A message over the course when the status changes, like the SCORM Test LMS's. In its own shadow DOM, so the
  // course's styles don't reach it; it never takes clicks meant for the course except on its own close button.
  const ALERT_CSS = `
    :host{all:initial}
    .flash{--c:#137a43;position:fixed;inset:0;z-index:2147483646;pointer-events:none;opacity:0;
      background:color-mix(in srgb,var(--c) 12%,transparent);box-shadow:inset 0 0 0 6px var(--c),inset 0 0 140px 40px color-mix(in srgb,var(--c) 50%,transparent)}
    .flash.go{animation:pulse 2.2s ease-out}
    @keyframes pulse{0%{opacity:0}10%{opacity:1}30%{opacity:.2}50%{opacity:1}70%{opacity:.2}85%{opacity:.8}100%{opacity:0}}
    .toast{--c:#137a43;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:flex-start;gap:12px;
      width:max-content;max-width:min(560px,calc(100vw - 32px));padding:12px 12px 12px 16px;border-radius:10px;background:#fff;color:#1b2030;
      border:2px solid var(--c);box-shadow:0 10px 30px rgba(0,0,0,.3);font:13px/1.45 'Segoe UI',system-ui,-apple-system,sans-serif}
    .toast[hidden]{display:none}
    .toast.go{animation:drop .35s ease-out}
    @keyframes drop{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}
    .fail{--c:#b42318}
    .icon{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--c);color:#fff;font-size:18px;font-weight:700}
    .from{font-size:11px;color:#5d6577;text-transform:uppercase;letter-spacing:.06em}
    strong{display:block;font-size:16px;color:var(--c)}
    .detail{font-size:12.5px;color:#5d6577;margin-top:2px}
    details{margin-top:6px;font-size:12px}
    summary{cursor:pointer;color:#5d6577;width:max-content}
    summary:hover{color:#1b2030}
    summary:focus-visible{outline:2px solid #1d5fd1;outline-offset:2px;border-radius:3px}
    .calls{margin:4px 0 0 14px;display:grid;grid-template-columns:auto 1fr;gap:1px 10px;font-size:12px}
    .calls span:nth-child(odd){color:#5d6577}
    code{font:12px ui-monospace,'Cascadia Mono',Consolas,monospace;color:#1b2030;overflow-wrap:anywhere}
    button{all:unset;flex:none;cursor:pointer;padding:0 6px;font-size:18px;line-height:24px;color:#5d6577;border-radius:4px}
    button:hover{color:#1b2030;background:#eceef3}
    button:focus-visible{outline:2px solid #1d5fd1}
    @media (prefers-reduced-motion:reduce){.flash.go{animation:fade 2.5s ease-out}@keyframes fade{0%,40%{opacity:.9}100%{opacity:0}}.toast.go{animation:none}}`;
  let alertParts = null, alertTimer = 0;
  function showAlert(entry) {
    try {
      if (!alertParts) {
        const host = document.createElement('storyline-review-tools-alert');
        const root = host.attachShadow({ mode: 'open' });   // open so the tests can check it
        root.innerHTML = '<style>' + ALERT_CSS + '</style><div class="flash"></div><div class="toast" role="status" aria-live="assertive" hidden>' +
          '<span class="icon" aria-hidden="true"></span><div><div class="from">Storyline Review Tools</div><strong></strong><div class="detail"></div>' +
          '<details><summary>LMS details</summary><div class="calls"></div></details></div>' +
          '<button aria-label="Dismiss">×</button></div>';
        (document.body || document.documentElement).appendChild(host);
        alertParts = { flash: root.querySelector('.flash'), toast: root.querySelector('.toast'), icon: root.querySelector('.icon'),
          title: root.querySelector('strong'), detail: root.querySelector('.detail'), calls: root.querySelector('.calls') };
        root.querySelector('button').addEventListener('click', () => { alertParts.toast.hidden = true; clearTimeout(alertTimer); });
      }
      const ok = entry.status !== 'fail', p = alertParts;
      const text = (el, s) => { el.textContent = s; return el; };
      text(p.icon, ok ? '✓' : '✕');
      text(p.title, { pass: 'Marked passed', complete: 'Marked complete', fail: 'Marked failed' }[entry.status]);
      const m = Math.floor(entry.at / 60000), s = Math.floor(entry.at / 1000) % 60;
      const from = [entry.reason ? 'From the ' + entry.reason : '', entry.slide && entry.slide.number ? 'on slide ' + entry.slide.number + (entry.slide.title ? ' “' + entry.slide.title + '”' : '') : ''].filter(Boolean).join(' ');
      text(p.detail, (from ? from + ', ' : '') + m + ':' + String(s).padStart(2, '0') + ' into the session' + (entry.score != null ? ', score ' + entry.score + '%' : '') + '.');
      const calls = core.LMS_CALLS[entry.status];
      p.calls.textContent = '';
      for (const [label, k] of [['SCORM 1.2', 'scorm12'], ['SCORM 2004', 'scorm2004'], ['xAPI', 'xapi']]) {
        p.calls.appendChild(text(document.createElement('span'), label));
        p.calls.appendChild(document.createElement('span')).appendChild(text(document.createElement('code'), calls[k]));
      }
      for (const el of [p.flash, p.toast]) { el.classList.remove('go', 'fail'); if (!ok) el.classList.add('fail'); void el.offsetWidth; el.classList.add('go'); }
      p.toast.hidden = false;
      clearTimeout(alertTimer);
      alertTimer = setTimeout(() => { p.toast.hidden = true; }, 15000);
    } catch (e) { fail('alert', e); }
  }

  // After data.js arrives: read every slide file (as data, never run) for the answer key and the lock counts.
  // The player loads slides only as they're shown, so without this the panel would only know about slides already seen.
  async function readAllSlides() {
    const files = core.slideFiles(data).filter(f => !slideCache.has(f));
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < files.length) {
        const f = files[i++];
        try {
          const r = await fetch(new URL(f, location.href), { credentials: 'same-origin' });
          const p = r.ok ? core.readProvided(await r.text()) : null;
          if (p && p.kind === 'slide' && !slideCache.has(f)) { slideCache.set(f, p.data); lockCounts.set(f, lockInfo(p.data)); }
        } catch (e) { /* counted as unchecked; the slide is still read when the player loads it */ }
      }
    }));
    updateLocks(true);
    updateQuiz();
    updateCompletion();
    try { saveVersion(); } catch (e) { fail('versions', e); }
    sendState();
  }

  // ── Versions: what changed since an earlier version ──
  // Review serves each version of a course from its own folder (/review/items/<folder>/), and the course frame can't
  // see Review's list of versions. So each version's text is kept in this frame's localStorage (shared by every
  // Review course frame in this browser) when it's opened, and compared with the version showing.
  const VERSIONS_KEY = 'storylineReviewTools.versions', KEEP_VERSIONS = 30, MAX_STORED = 3e6;
  const thisFolder = (/\/review\/items\/([^/]+)\//.exec(location.pathname) || [])[1] || '';
  let snapshot = null, compareWith = null;
  function storedVersions() {
    try { const v = JSON.parse(localStorage.getItem(VERSIONS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveVersion() {
    if (!data || !thisFolder) return;
    const g = window.globals || {};
    snapshot = Object.assign(core.courseSnapshot(data, f => slideCache.get(f) || null, notes), {
      folder: thisFolder, title: document.title || '', published: g.publishTimestamp || '', savedAt: new Date().toISOString()
    });
    // Newest first; the oldest go when there are too many, or they'd take too much room
    let all = [snapshot].concat(storedVersions().filter(v => v && v.folder !== thisFolder)).slice(0, KEEP_VERSIONS);
    for (;;) {
      const text = JSON.stringify(all);
      if (text.length < MAX_STORED || all.length <= 1) { try { localStorage.setItem(VERSIONS_KEY, text); } catch (e) { if (all.length > 1) { all = all.slice(0, -1); continue; } } break; }
      all = all.slice(0, -1);
    }
    compareVersions();
  }
  // Compare with the chosen version (by default the latest one published before this one), from older to newer
  function compareVersions() {
    if (!snapshot) return;
    const others = storedVersions().filter(v => v && v.folder !== thisFolder && v.courseId === snapshot.courseId)
      .sort((a, b) => String(b.published).localeCompare(String(a.published)));
    let other = others.find(v => v.folder === compareWith) || others.find(v => String(v.published) < String(snapshot.published)) || others[0] || null;
    compareWith = other ? other.folder : null;
    const thisIsNewer = !other || String(snapshot.published) >= String(other.published);
    state.versions = {
      published: snapshot.published,
      others: others.map(v => ({ folder: v.folder, title: v.title, published: v.published, savedAt: v.savedAt, slides: (v.slides || []).length })),
      comparedWith: compareWith, thisIsNewer,
      diff: other ? (thisIsNewer ? core.compareSnapshots(other, snapshot) : core.compareSnapshots(snapshot, other)) : null
    };
  }
  // Go to a slide (from a link in the side panel), as Review does when a comment is clicked: requestSlideForReview,
  // or in older players (it's in 3.121, not 3.65) the request Next makes. Neither waits for the menu's restrictions.
  document.addEventListener('storyline-review-tools:goto', e => {
    try {
      const wm = window.DS && DS.windowManager, id = String(e.detail || '');
      const slide = wm && DS.presentation.getFlatSlides().find(s => s.id === id);
      if (!slide) return;
      if (typeof wm.requestSlideForReview === 'function') Promise.resolve(wm.requestSlideForReview(slide, '_frame')).catch(err => fail('go to slide', err));
      else wm.onRequestingSlide(slide.absoluteId, null, 'push');
    } catch (err) { fail('go to slide', err); }
  });
  document.addEventListener('storyline-review-tools:compare', e => {
    compareWith = typeof e.detail === 'string' ? e.detail : null;
    try { compareVersions(); } catch (err) { fail('versions', err); }
    sendState();
  });

  // Text-box answers (fill in the blank, numeric) are course variables bound to the box. They're set through
  // the player's own JavaScript API as the slide loads. Storyline only reads a box's text once the learner
  // types in it, so each filled-in box also gets one key release when it appears, as if typed.
  function setCourseVariables(vars) {
    const names = Object.keys(vars);
    if (!names.length) return;
    const set = () => {
      try { const p = window.GetPlayer && window.GetPlayer(); if (!p) return false; for (const n of names) p.SetVar(n, vars[n]); return true; } catch (e) { return false; }
    };
    if (!set()) setTimeout(set, 0);
    watchFilledText();
  }
  let watching = false;
  function watchFilledText() {
    if (watching) return;
    watching = true;
    setInterval(() => {
      for (const el of document.querySelectorAll('input, textarea')) {
        if (['radio', 'checkbox', 'range', 'button', 'submit', 'hidden'].includes(el.type) || !el.value || el.dataset.storylineReviewFilled) continue;
        el.dataset.storylineReviewFilled = '1';
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }
    }, 400);
  }

  // The answers for one slide: checked choices, a hotspot click, and text-box variables
  function answersFor(slideId) {
    updateQuiz();
    return state.quiz ? state.quiz.questions.filter(q => q.slideId === slideId && q.apply).map(q => q.apply) : [];
  }

  function change(kind, json) {
    if (kind === 'frame') {
      const frame = JSON.parse(json);
      state.frame = core.frameInfo(frame);
      notes = core.slideNotes(frame);
      const n = core.changeFrame(frame, settings);
      state.changed.frame = n;
      sendState();
      return n ? JSON.stringify(frame) : json;
    }
    if (kind === 'data') {
      const published = JSON.parse(json);
      data = JSON.parse(json);   // kept unchanged for the answer key
      for (const scene of data.scenes || []) for (const s of scene.slides || []) if (s.html5url) fileOfSlide.set(s.id, s.html5url);
      for (const s of (data.slideBank && data.slideBank.slides) || []) if (s.html5url) fileOfSlide.set(s.id, s.html5url);
      // Slides embedded in data.js have their triggers here
      lockCounts.set('#data', lockInfo(published));
      let n = core.changeSlideLocks(published, settings);
      // Embedded slides whose Player features hide Next/Prev: the triggers the buttons need
      if (settings.unhide) for (const scene of published.scenes || []) for (const s of scene.slides || []) {
        if (!s.html5url && s.slideLayers) n += core.addMissingNav(s, core.nextSlidePath(data, s.id), core.hiddenNav(s, state.frame));
      }
      updateLocks(false);
      updateQuiz();
      updateCompletion();
      if (settings.answers) {
        // Question slides embedded in data.js
        const vars = {};
        for (const scene of published.scenes || []) for (const s of scene.slides || []) {
          if (s.html5url || !s.slideLayers) continue;   // only slides embedded in data.js (no file of their own)
          const applies = answersFor(s.id);
          n += core.applyAnswers(s, applies);
          for (const a of applies) Object.assign(vars, a.projectVars || {});
        }
        if (Object.keys(vars).length) setTimeout(() => setCourseVariables(vars), 0);
      }
      state.changed.nav += n;
      sendState();
      readAllSlides().catch(e => fail('reading slides', e));
      return n ? JSON.stringify(published) : json;
    }
    if (kind === 'slide') {
      const slide = JSON.parse(json);
      const file = fileOfSlide.get(slide.id);
      if (file && !slideCache.has(file)) { slideCache.set(file, JSON.parse(json)); lockCounts.set(file, lockInfo(slide)); updateCompletion(); }
      let n = core.changeSlideLocks(slide, settings);
      // Next/Prev shown on a slide whose Player features hide them: the triggers the buttons need
      if (settings.unhide && data) n += core.addMissingNav(slide, core.nextSlidePath(data, slide.id), core.hiddenNav(slide, state.frame));
      if (n) { state.changed.nav += n; state.changed.slides++; }
      if (settings.answers) {
        const applies = answersFor(slide.id);
        const a = core.applyAnswers(slide, applies);
        const vars = Object.assign({}, ...applies.map(x => x.projectVars || {}));
        if (a || Object.keys(vars).length) state.changed.answers++;
        n += a;
        setCourseVariables(vars);
      }
      sendState();
      return n ? JSON.stringify(slide) : json;
    }
    return json;
  }

  // ── The hook: catch the player's globalProvideData as it's defined, and wrap it ──
  let wrapped;
  Object.defineProperty(window, 'globalProvideData', {
    configurable: true,
    enumerable: true,
    get() { return wrapped; },
    set(fn) {
      if (typeof fn !== 'function') { wrapped = fn; return; }
      if (!state.player) watchCompletion();
      state.player = true;
      wrapped = function (kind, json) {
        let out = json;
        if (typeof json === 'string' && kind !== 'paths') {
          try { out = change(kind, json); } catch (e) { out = json; fail(kind, e); }   // on any problem, the course gets its file unchanged
        }
        return fn.call(this, kind, out);
      };
      sendState();
    }
  });
})();
