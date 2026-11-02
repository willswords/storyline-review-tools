// Storyline Review Tools: the Storyline logic, shared by the course-frame hook and the tests.
// Works on the JSON documents the Storyline player loads through window.globalProvideData(kind, json):
//   'frame' (html5/data/js/frame.js)  player settings: menu, seekbar
//   'data'  (html5/data/js/data.js)   course structure, quizzes, course variables
//   'slide' (html5/data/js/<id>.js)   one slide: objects, layers, triggers
// Ported from the SCORM Test LMS (scorm-test-lms.js), which makes the same changes as it serves the files.
// Storyline's format isn't documented by Articulate; field names are what published courses contain.
(function (root) {
  'use strict';

  // ── Reading a data file's text (for slides fetched to build the answer key) ──
  // The files are window.globalProvideData('<kind>', '<JSON in a single-quoted JS string>').
  // They're parsed as data and never run.
  const PROVIDE_RE = /globalProvideData\(\s*'(\w+)'\s*,\s*'([\s\S]*)'\s*\)\s*;?\s*$/;
  function unescapeJsString(s) {
    return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (m, e) => {
      if (e.length > 1 && e[0] === 'u') return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
      if (e.length === 3 && e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r': '', '\r\n': '', ' ': '', ' ': '' };
      return e in map ? map[e] : e;
    });
  }
  function readProvided(text) {
    const m = PROVIDE_RE.exec(String(text).replace(/^﻿/, ''));
    if (!m) return null;
    try { return { kind: m[1], data: JSON.parse(unescapeJsString(m[2])) }; } catch (e) { return null; }
  }

  function walk(o, fn) {
    if (!o || typeof o !== 'object') return;
    fn(o);
    for (const k in o) walk(o[k], fn);
  }

  // ── 1. Menu navigation and the seekbar: frame.js ──
  //   "menuOptions": { "flow": "free" | "restricted" | "locked" }
  //   "controls": { "readonly": true, "readonlyOnce": true }   (seekbar read-only, or until the slide is viewed once)
  // Current Storyline 360 output has both inside "controlOptions"; older output has them at the top level.
  const frameOptions = frame => (frame && frame.controlOptions && typeof frame.controlOptions === 'object' ? frame.controlOptions : frame) || {};
  // Which player buttons each slide shows: a slide's "Player features" (Prev, Next) pick one of the frame's
  // "controlLayouts", and the slide applies it as it loads ({"kind":"set_frame_layout","name":"<layout>"}).
  //   "controlLayouts": { "npnxnanbnsnfns…": { "previous": false, "next": false, "swipeleft": false, "swiperight": false, … } }
  const LAYOUT_NAV = { previous: 'swipeleft', next: 'swiperight' };   // each button, and the swipe that does the same
  const controlLayouts = frame => {
    const l = (frame && frame.controlLayouts) || frameOptions(frame).controlLayouts;
    return l && typeof l === 'object' ? l : {};
  };
  function frameInfo(frame) {
    const o = frameOptions(frame), menu = o.menuOptions, c = o.controls;
    return {
      flow: menu && typeof menu.flow === 'string' ? menu.flow : null,
      seekbar: c && typeof c.readonly === 'boolean' ? { readonly: c.readonly, readonlyOnce: c.readonlyOnce === true } : null,
      // Layouts that hide Prev or Next, and each one
      hidesNav: Object.keys(controlLayouts(frame)).filter(k => { const l = controlLayouts(frame)[k]; return l && (l.previous === false || l.next === false); }),
      hidesPrev: Object.keys(controlLayouts(frame)).filter(k => { const l = controlLayouts(frame)[k]; return l && l.previous === false; }),
      hidesNext: Object.keys(controlLayouts(frame)).filter(k => { const l = controlLayouts(frame)[k]; return l && l.next === false; })
    };
  }
  function changeFrame(frame, settings) {
    const o = frameOptions(frame);
    let n = 0;
    if (settings.freeNav && o.menuOptions && typeof o.menuOptions.flow === 'string' && o.menuOptions.flow !== 'free') { o.menuOptions.flow = 'free'; n++; }
    if (settings.seekbar && o.controls) {
      for (const k of ['readonly', 'readonlyOnce']) if (o.controls[k] === true) { o.controls[k] = false; n++; }
    }
    // Add Next/Prev buttons where turned off: show them on slides whose Player features hide them
    if (settings.unhide) for (const l of Object.values(controlLayouts(frame))) {
      if (!l || typeof l !== 'object') continue;
      for (const [btn, swipe] of Object.entries(LAYOUT_NAV)) if (l[btn] === false) { l[btn] = true; if (l[swipe] === false) l[swipe] = true; n++; }
    }
    return n;
  }
  // A slide whose Player features hide Next (or Prev) is published without the trigger the button runs, so a Next
  // button shown on it would do nothing. Storyline's own triggers for them, as on slides that keep the buttons:
  //   {"kind":"onnextslide","actions":[{"kind":"gotoplay","window":"_current","wndtype":"normal","objRef":{"type":"string","value":"_player.<scene>.<slide>"}}]}
  //   {"kind":"onprevslide","actions":[{"kind":"history_prev"}]}
  // Next goes to the following slide in the menu's order (the next scene's first slide after a scene's last).
  // Only slides whose layout hides the button get one (hidden: { next, prev }); a slide that shows Next with
  // nowhere to go was made that way, and is left alone.
  function nextSlidePath(data, slideId) {
    const order = [];
    for (const scene of data.scenes || []) if (!scene.isMessageScene) for (const s of scene.slides || []) order.push(scene.id + '.' + s.id);
    const i = order.findIndex(p => p.endsWith('.' + slideId));
    return i >= 0 && i < order.length - 1 ? '_player.' + order[i + 1] : null;
  }
  function addMissingNav(slide, nextPath, hidden) {
    if (!slide || typeof slide !== 'object' || !hidden) return 0;
    const events = Array.isArray(slide.events) ? slide.events : (slide.events = []);
    let n = 0;
    if (hidden.next && nextPath && !events.some(e => e && e.kind === 'onnextslide')) {
      events.push({ kind: 'onnextslide', actions: [{ kind: 'gotoplay', window: '_current', wndtype: 'normal', objRef: { type: 'string', value: nextPath } }] });
      n++;
    }
    if (hidden.prev && !events.some(e => e && e.kind === 'onprevslide')) { events.push({ kind: 'onprevslide', actions: [{ kind: 'history_prev' }] }); n++; }
    return n;
  }
  // Which buttons a slide's layout hides, from frameInfo's lists
  function hiddenNav(slide, info) {
    const names = slideLayouts(slide), has = list => names.some(l => (list || []).includes(l));
    return { next: has(info && info.hidesNext), prev: has(info && info.hidesPrev) };
  }
  // The layouts a slide applies (to count the slides whose layout hides Prev or Next)
  function slideLayouts(slide) {
    const names = new Set();
    walk(slide, o => { if ((o.kind === 'set_frame_layout' || o.kind === 'set_window_control_layout') && typeof o.name === 'string') names.add(o.name); });
    return [...names];
  }

  // ── 2. Next/Prev and seekbar triggers: each slide's file (and slides embedded in data.js) ──
  // {"kind":"enable_window_control","name":"next","enable":false} disables Next until something re-enables it.
  // Only disabling triggers are changed; showing/hiding and click actions are left alone.
  const NAV_CONTROLS = ['next', 'prev', 'previous', 'swiperight', 'swipeleft'];
  const isLock = (o, names) => o.kind === 'enable_window_control' && names.includes(o.name) && o.enable === false;
  function countLocks(slide) {
    const out = { nav: 0, seek: 0 };
    walk(slide, o => { if (isLock(o, NAV_CONTROLS)) out.nav++; if (isLock(o, ['seekbar'])) out.seek++; });
    return out;
  }
  function changeSlideLocks(slide, settings) {
    let n = 0;
    walk(slide, o => {
      if ((settings.nav && isLock(o, NAV_CONTROLS)) || (settings.seekbar && isLock(o, ['seekbar']))) { o.enable = true; n++; }
    });
    return n;
  }

  // ── 3. Quiz answers: the answer key Storyline writes into data.js ──
  // Each question ("interaction") lists its choices, which answer is "correct", and which slide object
  // (a radio button or checkbox) records each choice.
  const PRESELECTABLE = ['multiplechoice', 'multipleresponse', 'truefalse'];
  const OPERATOR_WORDS = { eq: '=', noteq: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥' };
  function describeCondition(st) {
    if (!st) return '';
    if (st.kind === 'or' || st.kind === 'and') {
      const parts = st.statements || [];
      const ops = Object.fromEntries(parts.filter(p => p.kind === 'compare').map(p => [p.operator, p.valueb]));
      if (st.kind === 'and' && parts.length === 2 && 'gte' in ops && 'lte' in ops) return 'between ' + ops.gte + ' and ' + ops.lte;
      return parts.map(describeCondition).filter(Boolean).join(st.kind === 'or' ? ' or ' : ' and ');
    }
    if (st.kind === 'compare') return st.operator === 'eq' ? String(st.valueb) : (OPERATOR_WORDS[st.operator] || st.operator) + ' ' + st.valueb;
    return '';
  }
  // A number that meets the condition, to type into the box
  function numberFor(st) {
    if (!st) return null;
    if (st.kind === 'or') { for (const p of st.statements || []) { const n = numberFor(p); if (n != null) return n; } return null; }
    if (st.kind === 'and') {
      let lo = -Infinity, hi = Infinity, eq = null;
      for (const p of st.statements || []) {
        if (p.kind !== 'compare' || typeof p.valueb !== 'number') return null;
        if (p.operator === 'eq') eq = p.valueb;
        else if (p.operator === 'gte') lo = Math.max(lo, p.valueb); else if (p.operator === 'gt') lo = Math.max(lo, p.valueb + 1);
        else if (p.operator === 'lte') hi = Math.min(hi, p.valueb); else if (p.operator === 'lt') hi = Math.min(hi, p.valueb - 1);
      }
      return eq != null ? eq : lo !== -Infinity ? (lo <= hi ? lo : null) : hi !== Infinity ? hi : null;
    }
    if (st.kind === 'compare' && typeof st.valueb === 'number') {
      const v = { eq: st.valueb, gte: st.valueb, lte: st.valueb, gt: st.valueb + 1, lt: st.valueb - 1, noteq: st.valueb + 1 }[st.operator];
      return v === undefined ? null : v;
    }
    return null;
  }
  function findObject(rootObj, id) {
    let hit = null;
    (function find(o) { if (hit || !o || typeof o !== 'object') return; if (o.id === id) { hit = o; return; } for (const k in o) find(o[k]); })(rootObj);
    return hit;
  }
  const GENERIC_TITLE = /^(multiple choice|multiple response|true ?\/? ?false|drag and drop|matching( drag and drop| drop-?down)?|fill[- ]in[- ]the[- ]blanks?|word bank|sequence( drag and drop| drop-?down)?|numeric|hotspot|likert( scale)?|pick (one|many)|ranking( drag and drop| drop-?down)?|how many|essay|short answer|free ?form.*|question( ?\d+)?)$/i;
  // The longest text box on the slide's base layer, leaving out answer choices and buttons
  function questionText(slide) {
    const layer = slide && slide.slideLayers && slide.slideLayers[0];
    let best = '';
    (function find(o) {
      if (!o || typeof o !== 'object') return;
      if (o.accType && o.accType !== 'text') return;
      for (const t of Array.isArray(o.textLib) ? o.textLib : []) {
        const s = ((t && t.vartext && t.vartext.blocks) || []).map(b => (b.spans || []).map(sp => sp.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
        if (s.length > best.length) best = s;
      }
      for (const k in o) if (k !== 'textLib') find(o[k]);
    })(layer && layer.objects);
    return best;
  }

  // All question slides in data.js: in the scenes, or in question banks (slideBank) that a quiz draws from
  function questionSlides(data) {
    const list = [];
    for (const scene of data.scenes || []) for (const slide of scene.slides || []) if ((slide.interactions || []).length) list.push({ slide, bank: false });
    for (const slide of (data.slideBank && data.slideBank.slides) || []) if ((slide.interactions || []).length) list.push({ slide, bank: true });
    return list;
  }
  const slideFiles = data => {
    const out = [];
    for (const scene of data.scenes || []) for (const slide of scene.slides || []) if (slide.html5url) out.push(slide.html5url);
    for (const slide of (data.slideBank && data.slideBank.slides) || []) if (slide.html5url) out.push(slide.html5url);
    return [...new Set(out)];
  };

  // The answer key. slideData(file) returns that slide's parsed JSON, or null if it isn't available (yet):
  // without it a question still lists its answers, but text-box and hotspot answers can't be pre-filled.
  function buildQuizKey(data, slideData) {
    const quizOf = new Map();   // slide id → its quiz
    for (const q of data.quizzes || []) for (const r of q.sliderefs || []) quizOf.set(String(r.id).split('.').pop(), q);
    const onlyQuiz = (data.quizzes || []).length === 1 ? data.quizzes[0] : null;
    const questions = [];
    for (const { slide, bank } of questionSlides(data)) for (const it of slide.interactions || []) {
      // A slide with its own file is read from that file (data.js may still list an outline of its layers);
      // a slide without one is embedded in data.js
      const sd = slide.html5url ? slideData(slide.html5url) : slide.slideLayers ? slide : null;
      const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      const choices = new Map((it.choices || []).map(c => ['choices.' + c.id, clean(c.lmstext)]));
      const targets = new Map((it.statements || []).map(s => ['statements.' + s.id, clean(s.lmstext)]));   // matching: where each item goes
      const label = v => choices.has(v) ? choices.get(v) : targets.has(v) ? targets.get(v) : JSON.stringify(v);
      const actions = (it.responseDefinition && it.responseDefinition.actions) || [];
      // responseDefinition: "if <group>.<object>.#_checked is true, record choice X"
      const objectFor = new Map();
      for (const a of actions) {
        const v = a && a.condition && a.condition.statement && a.condition.statement.valuea;
        const add = ((a && a.thenActions) || []).find(t => t && t.kind === 'addchoiceresponse');
        if (typeof v === 'string' && add && /\.#_checked$/.test(v)) { const parts = v.split('.'); objectFor.set(add.value, parts[parts.length - 2]); }
      }
      const describe = st => st.kind === 'equals' && st.choiceid ? label(st.choiceid)
        : st.choiceid && st.statementid ? label(st.choiceid) + ' → ' + label(st.statementid)
        : st.kind + ' ' + Object.entries(st).filter(([k]) => k !== 'kind' && k !== 'ignorecase').map(([k, v]) => k + ' ' + label(v)).join(', ');
      const correct = (it.answers || []).filter(a => a && a.status === 'correct');
      const sts0 = (correct[0] && correct[0].evaluate && correct[0].evaluate.statements) || [];
      // The text box a fill-in or numeric answer is typed into, and the course variable it's bound to
      const boundVariable = () => {
        const add = actions.find(a => a && a.kind === 'addchoiceresponse' && /^\w+\.\$Text$/.test(a.value));
        const input = add && sd && findObject(sd, add.value.split('.')[0]);
        const m = input && input.kind === 'textinput' && /^_player\.(\w+)$/.exec(input.bindto || '');
        return m ? m[1] : null;
      };
      let answers = correct.map(a => ({ points: a.points, parts: ((a.evaluate && a.evaluate.statements) || []).map(describe) }));
      let prefill = null, apply = null, note = '';
      if (PRESELECTABLE.includes(it.type)) {
        // Check the correct choices: on-slide radio buttons or checkboxes
        if (sts0.length && sts0.every(st => st.kind === 'equals' && objectFor.has(st.choiceid))) {
          apply = { checked: sts0.map(st => objectFor.get(st.choiceid)) };
          prefill = { how: 'select' };
        }
      } else if (it.type === 'fillin') {
        // Any one of the accepted answers will do
        const accepted = sts0.filter(st => st.kind === 'equals' && st.choiceid).map(st => label(st.choiceid));
        answers = accepted.map(t => ({ points: correct[0].points, parts: [t] }));
        if (sts0.some(st => st.ignorecase)) note = 'not case-sensitive';
        const v = boundVariable();
        if (accepted.length && v) { apply = { projectVars: { [v]: accepted[0] } }; prefill = { how: 'type', value: accepted[0] }; }
      } else if (it.type === 'numeric') {
        const cond = sts0.length === 1 && sts0[0].kind === 'condition' ? sts0[0].statement : null;
        const n = numberFor(cond), v = boundVariable();
        if (cond) answers = [{ points: correct[0].points, parts: [describeCondition(cond)] }];
        if (n != null && v) { apply = { projectVars: { [v]: String(n) } }; prefill = { how: 'type', value: String(n) }; }
      } else if (it.type === 'sequence') {
        // Each item's position, in order
        answers = answers.map((a, i) => ({ points: a.points, parts: (correct[i].evaluate.statements || [])
          .map(st => ({ pos: label(st.statementid), item: label(st.choiceid) })).sort((x, y) => parseFloat(x.pos) - parseFloat(y.pos))
          .map(p => p.pos + '. ' + p.item) }));
      } else if (it.type === 'hotspot') {
        answers = answers.map(a => ({ points: a.points, parts: a.parts.map(p => 'Click inside “' + p + '”') }));
        // "if the click (#…_xpos, #…_ypos) is inside <shape>, record the correct choice": record a click at the shape's centre
        const hit = sts0.length === 1 && actions.find(a => a && a.condition && a.condition.statement && a.condition.statement.kind === 'hittestpoint' &&
          (a.thenActions || []).some(t => t && t.kind === 'addchoiceresponse' && t.value === sts0[0].choiceid));
        const ht = hit && hit.condition.statement;
        const layer = sd && sd.slideLayers && sd.slideLayers[0];
        const shape = ht && layer && (layer.objects || []).find(o => o && o.id === ht.objRef.value);   // directly on the slide, so its position is in slide coordinates
        const xv = ht && /^#(\w+_xpos)$/.exec((ht.xPos && ht.xPos.value) || ''), yv = ht && /^#(\w+_ypos)$/.exec((ht.yPos && ht.yPos.value) || '');
        if (shape && xv && yv && !shape.rotation) {
          const cx = Math.round(shape.xPos + shape.width / 2), cy = Math.round(shape.yPos + shape.height / 2);
          const marker = (layer.objects || []).find(o => o && o.id === xv[1].replace(/_xpos$/, '_marker'));
          apply = { slideVars: { [xv[1]]: cx, [yv[1]]: cy } };
          if (marker) {
            apply.move = { [marker.id]: { xPos: cx - Math.round(marker.width / 2), yPos: cy - Math.round(marker.height / 2) } };
            apply.show = [marker.id];   // normally shown only once the learner clicks
          }
          prefill = { how: 'click' };
        }
      }
      const quiz = quizOf.get(slide.id) || (bank ? onlyQuiz : null);
      // Questions are often labelled just "Multiple Choice"; then use the question's wording from the slide
      let title = clean(it.lmstext);
      if (!title || GENERIC_TITLE.test(title)) title = (sd && questionText(sd)) || title || clean(slide.title);
      questions.push({
        slideId: slide.id, slideTitle: clean(slide.title), file: slide.html5url || '', title, type: it.type || '', survey: !!it.issurvey, bank,
        quiz: quiz ? quiz.lmstext || quiz.id : '', choices: [...choices.values()], correct: answers, note, prefill, apply,
        slideLoaded: !!sd
      });
    }
    if (!questions.length) return null;
    return { quizzes: (data.quizzes || []).map(q => ({ name: q.lmstext || q.id, passPercent: q.passPercent, survey: !!q.issurvey })), questions };
  }

  // Fill in the correct answers on a question slide before the player builds it:
  //   checked - choice objects whose "checked" variable starts true (multiple choice/response, true/false)
  //   slideVars - slide variables to start with a value (a hotspot's recorded click position)
  //   move - objects to start at another position (the hotspot's click marker)
  //   show - objects to show from the start of the slide (the marker)
  // (Text-box answers are course variables, set through the player when the slide loads; see the hook.)
  function applyAnswers(slide, applies) {
    const checked = new Set(applies.flatMap(a => a.checked || []));
    const show = new Set(applies.flatMap(a => a.show || []));
    const slideVars = Object.assign({}, ...applies.map(a => a.slideVars || {}));
    const move = Object.assign({}, ...applies.map(a => a.move || {}));
    let n = 0;
    const setVar = (v, value) => { v.value = v.type === 'number' ? Number(value) : v.type === 'boolean' ? !!value : String(value); n++; };
    for (const v of Array.isArray(slide.variables) ? slide.variables : []) if (v && v.name in slideVars) setVar(v, slideVars[v.name]);
    walk(slide, o => {
      if (typeof o.id !== 'string') return;
      if (checked.has(o.id) && Array.isArray(o.variables)) for (const v of o.variables) if (v && v.name === '_checked') { v.value = true; n++; }
      if (move[o.id]) { Object.assign(o, move[o.id]); n++; }
    });
    // Show: add a "show" action at the start of the timeline of the layer the object is on
    for (const layer of show.size && Array.isArray(slide.slideLayers) ? slide.slideLayers : []) {
      const ids = (layer.objects || []).map(o => o && o.id).filter(id => show.has(id));
      if (!ids.length) continue;
      layer.timeline = layer.timeline || { duration: 0, events: [] };
      layer.timeline.events = layer.timeline.events || [];
      let start = layer.timeline.events.find(e => e && e.kind === 'ontimelinetick' && e.time === 0);
      if (!start) layer.timeline.events.unshift(start = { kind: 'ontimelinetick', time: 0, actions: [] });
      start.actions = start.actions || [];
      for (const id of ids) { start.actions.push({ kind: 'show', transition: 'appear', objRef: { type: 'string', value: id } }); n++; }
    }
    return n;
  }

  // ── 4. Completion: when the course reports to an LMS, and what it reports ──
  // data.js "scorings" holds one entry per tracking option ticked in Storyline's Tracking settings:
  //   "view"   a number of slides viewed (viewThreshold; slides sharing a view group count once)
  //   "quiz"   a quiz result (scoreRefs → data.quizzes); reported once a results slide submits the quiz (setquizcomplete)
  //   "action" Complete Course triggers ({"kind":"set_course_status","status":true}); the player ignores those triggers without it
  // passStatus/failStatus are the words of the Reporting setting: "pass", "complete", "fail" or "incomplete".
  // The player counts the course complete when any one is met; the first met, in this order, gives the status.
  const STATUS_WORDS = { pass: 'Passed', complete: 'Completed', fail: 'Failed', incomplete: 'Incomplete' };
  // What the player's SCORM driver (lms/scormdriver.js) sets for each status, and the xAPI statement it sends
  const LMS_CALLS = {
    pass: { scorm12: 'cmi.core.lesson_status = "passed"', scorm2004: 'cmi.success_status = "passed", cmi.completion_status = "completed"', xapi: 'a “passed” statement' },
    fail: { scorm12: 'cmi.core.lesson_status = "failed"', scorm2004: 'cmi.success_status = "failed", cmi.completion_status = "completed"', xapi: 'a “failed” statement' },
    complete: { scorm12: 'cmi.core.lesson_status = "completed"', scorm2004: 'cmi.completion_status = "completed"', xapi: 'a “completed” statement' },
    incomplete: { scorm12: 'cmi.core.lesson_status = "incomplete"', scorm2004: 'cmi.completion_status = "incomplete", cmi.success_status = "unknown"', xapi: 'no statement' }
  };
  const SCORE_CALLS = pct => ({ scorm12: 'cmi.core.score.raw = ' + pct, scorm2004: 'cmi.score.raw = ' + pct + ', cmi.score.scaled = ' + Math.round(pct) / 100, xapi: 'result.score.scaled ' + Math.round(pct) / 100 });

  const plain = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  // Slides by id, numbered as the course menu numbers them ("1.3" is scene 1, slide 3)
  function slideIndex(data) {
    const map = new Map();
    for (const scene of data.scenes || []) {
      if (scene.isMessageScene) continue;
      for (const s of scene.slides || []) map.set(s.id, { id: s.id, number: scene.sceneNumber + '.' + s.slideNumberInScene, title: plain(s.title), slide: s });
    }
    return map;
  }
  // The slide id in a player path such as "_player.<scene>.<slide>"
  const slideOf = (index, path) => index.get(String(path || '').split('.').pop()) || null;

  // When a trigger runs, in Storyline's words
  function describeWhen(ctx) {
    const obj = ctx.object, d = obj && obj.data;
    const name = obj && (plain((d && d.textdata && d.textdata.altText) || (d && d.vectorData && d.vectorData.altText) || obj.accText) || obj.id);
    const on = {
      onslidestart: 'when the timeline starts', ontimelinestart: 'when the timeline starts', ontransitionin: 'as the slide appears',
      ontimelinecomplete: 'when the timeline ends', ontimelineend: 'when the timeline ends', onsubmitslide: 'when Submit is pressed',
      onnextslide: 'when Next is pressed', onprevslide: 'when Prev is pressed', onrelease: name ? 'when “' + name + '” is clicked' : 'when an object is clicked',
      onclick: name ? 'when “' + name + '” is clicked' : 'when an object is clicked'
    }[ctx.event];
    let when = on || (ctx.event === 'ontimelinetick' ? 'at ' + Math.round((ctx.time || 0) / 100) / 10 + ' s on the timeline' : ctx.event ? 'on “' + ctx.event + '”' : 'from a trigger group');
    if (ctx.layer) when += ' (on a layer)';
    if (ctx.conditional) when += ', if its conditions are met';
    return when;
  }
  // Every action of the given kinds in a slide (or other JSON), with the trigger it belongs to
  function findActions(rootObj, kinds) {
    const out = [];
    (function visit(o, ctx) {
      if (Array.isArray(o)) { for (const x of o) visit(x, ctx); return; }
      if (!o || typeof o !== 'object') return;
      let c = ctx;
      if (o.kind === 'slidelayer') c = Object.assign({}, c, { layer: !o.isBaseLayer });
      else if (typeof o.kind === 'string' && /^on/.test(o.kind)) c = Object.assign({}, c, { event: o.kind, time: o.time });
      else if (o.kind === 'if_action') c = Object.assign({}, c, { conditional: true });
      else if (o !== rootObj && Array.isArray(o.events) && o.id) c = Object.assign({}, c, { object: o });
      if (kinds.includes(o.kind)) out.push(Object.assign({ action: o }, c));
      for (const k in o) if (o[k] && typeof o[k] === 'object') visit(o[k], c);
    })(rootObj, {});
    return out;
  }

  // The tracking options, where in the course each can be met, and what would stop the course completing.
  // slideData(file) as for buildQuizKey; until every slide file is read, triggers on unread slides aren't listed yet.
  function completionInfo(data, slideData) {
    const scorings = (data.scorings && data.scorings.length ? data.scorings : data.scoring ? [data.scoring] : []);
    const index = slideIndex(data);
    const quizName = id => { const q = (data.quizzes || []).find(x => x.id === id); return q ? plain(q.lmstext) || id : id; };
    // Complete/Incomplete Course triggers and results slides, on every slide that can be read
    const courseTriggers = [], results = [];
    let unread = 0;
    for (const s of index.values()) {
      const sd = s.slide.html5url ? slideData(s.slide.html5url) : s.slide.slideLayers ? s.slide : null;
      if (!sd) { unread++; continue; }
      for (const f of findActions(sd, ['set_course_status', 'setquizcomplete'])) {
        const where = { number: s.number, title: s.title, when: describeWhen(f) };
        if (f.action.kind === 'set_course_status') courseTriggers.push(Object.assign(where, { complete: f.action.status !== false }));
        else results.push(Object.assign(where, { quiz: String(f.action.objRef && f.action.objRef.value || '').split('.').pop() }));
      }
    }
    // Player triggers (data.js), such as one on the player's Finish button
    for (const f of findActions({ events: data.events, actionGroups: data.actionGroups }, ['set_course_status']))
      courseTriggers.push({ number: '', title: 'Player trigger', when: describeWhen(f), complete: f.action.status !== false });

    // Slides that count as viewed: one per view group, plus the questions each question-bank draw shows
    const groups = new Set();
    let drawn = 0;
    for (const s of index.values()) if (s.slide.trackViews === true) groups.add(s.slide.viewGroupId || s.slide.id);
    walk(data.scenes, o => { if (o.kind === 'slidedraw') drawn += o.shuffle && o.shufflecount > 0 ? o.shufflecount : (o.sliderefs || []).length; });
    const counted = groups.size + drawn;

    const problems = [];
    const hasAction = scorings.some(s => s.type === 'action' || s.type === 'trigger');
    const criteria = scorings.map(s => {
      if (s.type === 'quiz') {
        const refs = s.scoreRefs || [];
        const names = refs.map(r => '“' + quizName(r.ref) + '”').join(' and ') || 'a quiz';
        const by = results.filter(r => refs.some(x => x.ref === r.quiz));
        if (refs.length && !by.length && !unread) problems.push('No results slide submits ' + names + ', so its result is never reported.');
        return { kind: 'quiz', text: s.passPercent > 0 ? 'Pass the quiz ' + names + ' with ' + s.passPercent + '% or more' : 'Finish the quiz ' + names + ' (pass mark 0%, so any score passes)',
          detail: 'Reported when a results slide submits it', where: by };
      }
      if (s.type === 'action' || s.type === 'trigger') {
        const by = courseTriggers.filter(t => t.complete);
        if (!by.length && !unread) problems.push('Tracking uses Complete Course triggers, but no slide has one, so the course never completes.');
        return { kind: 'trigger', text: 'Reach a Complete Course trigger', where: by };
      }
      if (s.type === 'view') {
        const from = drawn ? ', including ' + drawn + ' drawn from a question bank' : '';
        if (counted && s.viewThreshold > counted) problems.push('Tracking needs ' + s.viewThreshold + ' slides viewed, but only ' + counted + ' count as viewed, so the course never completes.');
        return { kind: 'view', text: counted && s.viewThreshold >= counted ? 'View all ' + counted + ' slides' + (from ? ' (' + from.slice(2) + ')' : '')
          : 'View at least ' + s.viewThreshold + ' slide' + (s.viewThreshold === 1 ? '' : 's') + (counted ? ' (of the ' + counted + ' that count' + from + ')' : ''),
          detail: 'Reported as the slide that reaches the count starts', where: [] };
      }
      return { kind: s.type, text: 'Storyline tracking type “' + s.type + '”', where: [] };
    });
    if (!scorings.length) problems.push('No tracking option is set, so the course never reports completion.');
    const ignored = courseTriggers.filter(t => t.complete);
    if (ignored.length && !hasAction) problems.push('Complete Course trigger(s) on ' + ignored.map(t => t.number ? 'slide ' + t.number : t.title).join(', ') +
      ', but tracking doesn’t use triggers, so the player ignores them.');
    const s0 = scorings[0];
    const incompleteTriggers = courseTriggers.filter(t => !t.complete);
    return {
      criteria, any: criteria.length > 1, problems, checked: !unread, counted,
      reports: s0 ? { met: s0.passStatus, notMet: s0.failStatus, metWord: STATUS_WORDS[s0.passStatus] || s0.passStatus, notMetWord: STATUS_WORDS[s0.failStatus] || s0.failStatus } : null,
      incompleteTriggers: hasAction ? incompleteTriggers : []
    };
  }

  const QUESTION_TYPES = { multiplechoice: 'Multiple choice', multipleresponse: 'Multiple response', truefalse: 'True/false', fillin: 'Fill in the blank',
    wordbank: 'Word bank', matching: 'Matching', matchingdropdown: 'Matching (drop-down)', sequence: 'Sequence', sequencedragdrop: 'Sequence (drag and drop)',
    numeric: 'Numeric', hotspot: 'Hotspot', dragdrop: 'Drag and drop', likert: 'Likert scale', essay: 'Essay', shortanswer: 'Short answer',
    rankingdragdrop: 'Ranking', howmany: 'How many', pickone: 'Pick one', pickmany: 'Pick many', freeform: 'Freeform' };

  const api = { readProvided, frameInfo, changeFrame, slideLayouts, nextSlidePath, addMissingNav, hiddenNav, countLocks, changeSlideLocks, slideFiles, questionSlides,
    buildQuizKey, applyAnswers, questionText, describeCondition, numberFor, QUESTION_TYPES, NAV_CONTROLS,
    completionInfo, slideIndex, slideOf, findActions, STATUS_WORDS, LMS_CALLS, SCORE_CALLS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, '__storylineReviewCore', { value: api });   // hidden from the course's own scripts' enumeration
})(typeof globalThis !== 'undefined' ? globalThis : this);
