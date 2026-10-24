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
  const settings = { freeNav: !!saved.freeNav, seekbar: !!saved.seekbar, nav: !!saved.nav, answers: !!saved.answers };

  // What the side panel shows: what the course does, and what was changed
  const state = {
    player: false,          // the Storyline player has started in this frame
    settings,
    title: '',
    frame: null,            // { flow, seekbar } as published
    locks: null,            // { nav, seek, slidesWithNav, slideFiles, checked } across all slides
    quiz: null,             // the answer key (core.buildQuizKey)
    changed: { frame: 0, nav: 0, seek: 0, answers: 0, slides: 0 },
    errors: []
  };
  let data = null;                      // data.js, as published
  const slideCache = new Map();         // html5url → slide JSON as published
  const fileOfSlide = new Map();        // slide id → html5url
  const lockCounts = new Map();         // html5url (or '#data' for slides inside data.js) → { nav, seek }

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
    let nav = 0, seek = 0, slidesWithNav = 0;
    for (const c of lockCounts.values()) { nav += c.nav; seek += c.seek; if (c.nav) slidesWithNav++; }
    state.locks = { nav, seek, slidesWithNav, slideFiles: data ? core.slideFiles(data).length : 0, checked: !!done };
  }
  function updateQuiz() {
    if (data) state.quiz = core.buildQuizKey(data, f => slideCache.get(f) || null);
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
          if (p && p.kind === 'slide' && !slideCache.has(f)) { slideCache.set(f, p.data); lockCounts.set(f, core.countLocks(p.data)); }
        } catch (e) { /* counted as unchecked; the slide is still read when the player loads it */ }
      }
    }));
    updateLocks(true);
    updateQuiz();
    sendState();
  }

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
      lockCounts.set('#data', core.countLocks(published));
      let n = core.changeSlideLocks(published, settings);
      updateLocks(false);
      updateQuiz();
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
      if (file && !slideCache.has(file)) { slideCache.set(file, JSON.parse(json)); lockCounts.set(file, core.countLocks(slide)); }
      let n = core.changeSlideLocks(slide, settings);
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
