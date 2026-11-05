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
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r': '', '\r\n': '', '\u2028': '', '\u2029': '' };
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
      // The menu's "Number entries automatically" ("autonumber"): 1.1, 1.2… before each slide's title
      menuNumbers: menu && typeof menu.autonumber === 'boolean' ? menu.autonumber : null,
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
    if (settings.menuNumbers && o.menuOptions && o.menuOptions.autonumber === false) { o.menuOptions.autonumber = true; n++; }
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
  // (Storyline's own "no Prev on the first slide of a session" trigger isn't counted: see isAutoPrev below)
  function countLocks(slide) {
    const out = { nav: 0, seek: 0 };
    for (const f of findActions(slide, ['enable_window_control'])) {
      if (isLock(f.action, NAV_CONTROLS) && !isAutoPrev(f)) out.nav++;
      if (isLock(f.action, ['seekbar'])) out.seek++;
    }
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
  // The number each slide has in the course menu, by its place in the menu's outline (frame.js navData.outline):
  // the menu can group slides differently from the scenes, so "Question 5 - 2nd Attempt" (scene 1, slide 18) is
  // the 3rd entry under the 6th heading, 6.3, as the menu numbers it. { slideId: "6.3" }
  function menuNumbers(frame) {
    const out = {};
    (function number(links, prefix) {
      (Array.isArray(links) ? links : []).forEach((l, i) => {
        if (!l || typeof l !== 'object') return;
        const n = prefix + (i + 1);
        const id = String(l.slideid || '').split('.').pop();
        if (id && !(id in out)) out[id] = n;
        number(l.links, n + '.');
      });
    })(frame && frame.navData && frame.navData.outline && frame.navData.outline.links, '');
    return out;
  }
  // Slides by id, numbered as the course menu numbers them when data.menuNumbers (from menuNumbers) is set, otherwise
  // by scene ("1.3" is scene 1, slide 3). A slide that isn't in the menu (such as a results slide) keeps its scene
  // number, marked so it can't be taken for the menu's slide of the same number: "1.19 (not in menu)".
  function slideIndex(data) {
    const map = new Map(), menu = data.menuNumbers;
    const hasMenu = !!menu && Object.keys(menu).length > 0;
    for (const scene of data.scenes || []) {
      if (scene.isMessageScene) continue;
      for (const s of scene.slides || []) {
        const bySceneNo = scene.sceneNumber + '.' + s.slideNumberInScene;
        const number = !hasMenu ? bySceneNo : menu[s.id] || bySceneNo + ' (not in menu)';
        map.set(s.id, { id: s.id, number, sceneNumber: bySceneNo, inMenu: !hasMenu || !!menu[s.id], title: plain(s.title), slide: s });
      }
    }
    return map;
  }
  // The slide id in a player path such as "_player.<scene>.<slide>"
  const slideOf = (index, path) => index.get(String(path || '').split('.').pop()) || null;

  // An object's name for a reviewer: the text it shows (a button's label, also inside a button group), else its alt
  // text, else what kind of object it is, else its id
  const KIND_WORDS = { video: 'the video', audio: 'the audio', webobject: 'the web object', slider: 'the slider', dial: 'the dial', textinput: 'the text box' };
  function nameOfObject(obj) {
    if (!obj) return '';
    let text = '', alt = '';
    (function find(o) {
      if (text || !o || typeof o !== 'object') return;
      for (const t of Array.isArray(o.textLib) ? o.textLib : []) {
        const s = ((t && t.vartext && t.vartext.blocks) || []).map(b => (b.spans || []).map(sp => sp.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
        if (s && !text) text = s;
      }
      const d = o.data;
      if (!alt) alt = plain((d && d.textdata && d.textdata.altText) || (d && d.vectorData && d.vectorData.altText) || o.accText);
      for (const k in o) if (k !== 'textLib' && k !== 'events' && k !== 'actionGroups') find(o[k]);
    })(obj);
    if (text && text.length <= 60) return text;
    return alt || (text ? text.slice(0, 57) + '…' : '') || KIND_WORDS[obj.kind] || obj.id;
  }
  // When a trigger runs, in Storyline's words
  function describeWhen(ctx, nameOf) {
    const name = ctx.object ? (nameOf ? nameOf(ctx.object.id) : nameOfObject(ctx.object)) : '';
    const v = ctx.varname ? String(ctx.varname) : '';
    const on = {
      onslidestart: 'when the timeline starts', ontimelinestart: 'when the timeline starts', ontransitionin: 'as the slide appears',
      ontimelinecomplete: 'when the timeline ends', ontimelineend: 'when the timeline ends', onsubmitslide: 'when Submit is pressed',
      onnextslide: 'when Next is pressed', onprevslide: 'when Prev is pressed', onrelease: name ? 'when “' + name + '” is clicked' : 'when an object is clicked',
      onclick: name ? 'when “' + name + '” is clicked' : 'when an object is clicked',
      onmediacomplete: name ? 'when “' + name + '” finishes playing' : 'when the media finishes playing',
      onvarchanged: v === '_visited' ? (name ? 'when “' + name + '” is visited' : 'when an object is visited')
        : v === '_state' ? (name ? 'when “' + name + '” changes state' : 'when an object changes state')
        : v ? 'when variable ' + v.replace(/^_player\./, '') + ' changes' : ''
    }[ctx.event];
    let when = on || (ctx.event === 'ontimelinetick' ? 'at ' + Math.round((ctx.time || 0) / 100) / 10 + ' s on the timeline' : ctx.event ? 'on “' + ctx.event + '”' : 'from a trigger group');
    if (ctx.layer) when += ' (on a layer)';
    if (ctx.conditional) when += ', if its conditions are met';
    return when;
  }
  // Every action of the given kinds in a slide (or other JSON), with the trigger it belongs to: the event, the object
  // whose trigger it is, whether it's on a layer, the conditions it waits for (conditions: [{ statement, not }],
  // "not" for an Else branch), and the trigger group it's in (group, groupOwner).
  function findActions(rootObj, kinds) {
    const out = [];
    (function visit(o, ctx) {
      if (Array.isArray(o)) { for (const x of o) visit(x, ctx); return; }
      if (!o || typeof o !== 'object') return;
      let c = ctx;
      if (o.kind === 'slidelayer') c = Object.assign({}, c, { layer: !o.isBaseLayer });
      else if (typeof o.kind === 'string' && /^on/.test(o.kind)) c = Object.assign({}, c, { event: o.kind, time: o.time, varname: o.varname });
      else if (o !== rootObj && Array.isArray(o.events) && o.id) c = Object.assign({}, c, { object: o });
      if (kinds.includes(o.kind)) out.push(Object.assign({ action: o }, c));
      if (o.kind === 'if_action') {
        // The condition goes with the actions it decides
        const st = o.condition && o.condition.statement, conds = c.conditions || [];
        visit(o.thenActions, Object.assign({}, c, { conditional: true, conditions: conds.concat({ statement: st }) }));
        visit(o.elseActions, Object.assign({}, c, { conditional: true, conditions: conds.concat({ statement: st, not: true }) }));
        return;
      }
      for (const k in o) {
        const v = o[k];
        if (k === 'actionGroups' && v && typeof v === 'object' && !Array.isArray(v)) {
          for (const g in v) visit(v[g], Object.assign({}, c, { event: undefined, time: undefined, varname: undefined, group: g, groupOwner: o }));
        } else if (v && typeof v === 'object') visit(v, c);
      }
    })(rootObj, {});
    return out;
  }

  // ── 5. "Why can't I move on?": what a slide does to the player's Next and Prev ──
  // A slide can (1) turn a button off in its Player features (see controlLayouts above), (2) disable or enable it
  // with triggers ({"kind":"enable_window_control","name":"next","enable":false}), (3) hide or show it with triggers
  // ({"kind":"set_window_control_visible","name":"next","visible":false}), and (4) give Next somewhere to go
  // (its "onnextslide" trigger) or move on through its own buttons. Storyline adds one trigger to every slide by
  // itself: Prev is disabled on the first slide of a session ("_playerVars.#hasPrevHistory" is false).
  const NAV_NAMES = { next: ['next'], prev: ['previous', 'prev'] };
  const isAutoPrev = f => f.action.name !== 'next' && (f.conditions || []).some(c => c.statement && JSON.stringify(c.statement).includes('#hasPrevHistory'));
  const STATE_WORDS = { _default: 'Normal', _normal: 'Normal', _disabled: 'Disabled', _visited: 'Visited', _selected: 'Selected', _hover: 'Hover', _down: 'Down', _hidden: 'Hidden' };
  const OPS = { eq: 'is', noteq: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤' };
  const shown = v => typeof v === 'boolean' ? (v ? 'True' : 'False') : typeof v === 'string' ? '“' + v + '”' : String(v);

  // A trigger condition in words. Course variables it reads are added to vars (for their live values).
  function describeStatement(st, nameOf, vars) {
    if (!st || typeof st !== 'object') return '';
    if (st.kind === 'and' || st.kind === 'or') {
      const parts = (st.statements || []).map(p => describeStatement(p, nameOf, vars)).filter(Boolean);
      return parts.join(st.kind === 'and' ? ' and ' : ' or ');
    }
    if (st.kind !== 'compare') return '';
    const a = String(st.valuea || ''), b = st.valueb, yes = (b === true) === (st.operator === 'eq');
    let m;
    if (/#TimelineCompleted_/.test(a)) return yes ? 'the timeline has played to the end' : 'the timeline hasn’t played to the end yet';
    if (/#hasPrevHistory$/.test(a)) return yes ? 'there’s a slide to go back to' : 'there’s no slide to go back to';
    if (/#ReviewMode_/.test(a)) return yes ? 'the quiz is being reviewed' : 'the quiz isn’t being reviewed';
    if (/#RetryMode_/.test(a)) return yes ? 'the quiz is being retried' : 'the quiz isn’t being retried';
    if ((m = /(\w+)\.#_visited$/.exec(a))) return '“' + nameOf(m[1]) + '” ' + (yes ? 'is visited' : 'isn’t visited');
    if ((m = /(\w+)\.#_state$/.exec(a))) return '“' + nameOf(m[1]) + '” ' + (st.operator === 'noteq' ? 'isn’t' : 'is') + ' in its ' + (STATE_WORDS[b] || shown(b)) + ' state';
    if ((m = /(\w+)\.#_checked$/.exec(a))) return '“' + nameOf(m[1]) + '” ' + (yes ? 'is selected' : 'isn’t selected');
    if ((m = /^(?:_player\.)?([A-Za-z]\w*)$/.exec(a)) && st.typea === 'var') { vars.add(m[1]); return 'variable ' + m[1] + ' ' + (OPS[st.operator] || st.operator) + ' ' + shown(b); }
    return a.replace(/^_player\./, '') + ' ' + (OPS[st.operator] || st.operator) + ' ' + shown(b);
  }

  // What the slide does to Next and Prev, and the slides it can go to. data for slide numbers, info from frameInfo.
  function explainSlide(slide, data, info) {
    const index = slideIndex(data);
    // Objects are written as tokens, then named at the end: two objects with the same name are numbered (“Tab” #1, #2)
    const ids = [], nameOf = id => { if (!ids.includes(id)) ids.push(id); return '\u0001' + id + '\u0001'; };
    const vars = new Set();
    const conds = list => (list || []).map(c => { const t = describeStatement(c.statement, nameOf, vars); return t ? (c.not ? 'unless ' + t : t) : ''; }).filter(Boolean).join(', ');
    const target = ref => {
      const s = slideOf(index, ref);
      return s ? 'slide ' + s.number + (s.title ? ' “' + s.title + '”' : '') : 'another part of the course';
    };
    // When a trigger runs ({ when, cond }); for one in a trigger group, the triggers that run the group (up to 3 groups deep)
    const callers = findActions(slide, ['exe_actiongroup']);
    const both = (a, b) => [a, b].filter(Boolean).join(' and ');
    function whens(f, depth) {
      const own = conds(f.conditions);
      if (!f.group) return [{ when: describeWhen(Object.assign({}, f, { conditional: false }), nameOf), cond: own }];
      if (depth > 2) return [{ when: 'from a trigger group', cond: own }];
      const by = callers.filter(x => String(x.action.id || '').split('.').pop() === f.group && (f.groupOwner === slide || x.object === f.groupOwner));
      const out = by.flatMap(x => whens(x, depth + 1)).map(w => ({ when: w.when, cond: both(w.cond, own) }));
      return out.length ? out : [{ when: 'from a trigger group', cond: own }];
    }
    const names = slideLayouts(slide), turnedOff = list => names.some(l => (list || []).includes(l));
    const actions = findActions(slide, ['enable_window_control', 'set_window_control_visible']);
    const ORDER = ['Hidden', 'Disabled', 'Shown', 'Enabled'];
    const buttons = {};
    for (const [btn, ids] of Object.entries(NAV_NAMES)) {
      const mine = actions.filter(f => ids.includes(f.action.name));
      // One entry per trigger moment: what it does to the button ("Shown and Enabled" by the same trigger read as one)
      const moments = [];
      for (const f of mine) {
        if (isAutoPrev(f)) continue;
        const effect = f.action.kind === 'set_window_control_visible' ? (f.action.visible === false ? 'Hidden' : 'Shown') : (f.action.enable === false ? 'Disabled' : 'Enabled');
        for (const w of whens(f, 0)) {
          const m = moments.find(x => x.when === w.when && x.cond === w.cond);
          if (m) { if (!m.effects.includes(effect)) m.effects.push(effect); } else moments.push(Object.assign({ effects: [effect] }, w));
        }
      }
      // The same change under the same conditions, at several moments, reads as one line ("when “A” is visited or when “B” is visited")
      const lines = [];
      for (const m of moments) {
        const e = m.effects, effect = e.includes('Hidden') ? 'hide' : e.includes('Disabled') ? 'disable' : 'enable';
        const words = e.includes('Hidden') ? 'Hidden' : e.includes('Disabled') ? (e.includes('Shown') ? 'Shown but disabled' : 'Disabled')
          : e.includes('Shown') && e.includes('Enabled') ? 'Shown and enabled' : e.includes('Shown') ? 'Shown' : 'Enabled';
        const l = lines.find(x => x.words === words && x.cond === m.cond);
        if (l) { if (!l.whens.includes(m.when)) l.whens.push(m.when); } else lines.push({ effect, words, cond: m.cond, whens: [m.when] });
      }
      const rank = { hide: 0, disable: 1, enable: 2 };
      lines.sort((a, b) => rank[a.effect] - rank[b.effect]);
      buttons[btn] = {
        off: turnedOff(btn === 'next' ? info && info.hidesNext : info && info.hidesPrev),
        autoPrev: btn === 'prev' && mine.some(isAutoPrev),
        triggers: lines.map(l => ({ effect: l.effect, text: l.words + ' ' + l.whens.join(' or ') + (l.cond ? ', if ' + l.cond : '') + '.' }))
      };
    }
    // Where Next and Prev go: the slide's "when Next/Prev is pressed" triggers, through their trigger groups
    const groups = slide.actionGroups || {};
    function destinations(actions, depth) {
      const out = [];
      for (const a of actions || []) {
        if (!a || typeof a !== 'object') continue;
        if (a.kind === 'gotoplay' && a.objRef) out.push(target(a.objRef.value));
        else if (a.kind === 'trigger_next_slide' || a.kind === 'history_next') out.push('the next slide');
        else if (a.kind === 'history_prev' || a.kind === 'trigger_prev_slide') out.push('the previous slide');
        else if (a.kind === 'nextviewedslide') out.push('the next question to review');
        else if (a.kind === 'if_action') out.push(...destinations(a.thenActions, depth), ...destinations(a.elseActions, depth));
        else if (a.kind === 'exe_actiongroup' && depth < 4) { const g = groups[String(a.id || '').split('.').pop()]; if (g) out.push(...destinations(g.actions, depth + 1)); }
      }
      return out;
    }
    for (const [btn, ev] of [['next', 'onnextslide'], ['prev', 'onprevslide']]) {
      const e = (slide.events || []).find(x => x && x.kind === ev);
      buttons[btn].goesTo = e ? [...new Set(destinations(e.actions, 0))] : [];
      buttons[btn].hasTrigger = !!e;
    }
    // On-slide objects that go to another slide when clicked
    const jumps = [];
    for (const f of findActions(slide, ['gotoplay', 'trigger_next_slide', 'history_next', 'history_prev'])) {
      const clicked = x => x.object && /^on(release|click)$/.test(x.event || '');
      const from = f.group ? callers.filter(x => String(x.action.id || '').split('.').pop() === f.group && clicked(x)) : clicked(f) ? [f] : [];
      for (const x of from) {
        const to = f.action.kind === 'gotoplay' ? target(f.action.objRef && f.action.objRef.value) : /prev/.test(f.action.kind) ? 'the previous slide' : 'the next slide';
        const name = nameOf(x.object.id);
        if (!jumps.some(j => j.name === name && j.to === to)) jumps.push({ name, to });
      }
    }
    // Name the objects
    const base = new Map(ids.map(id => { const o = findObject(slide, id); return [id, o ? nameOfObject(o) : id]; }));
    const label = id => {
      const same = ids.filter(x => base.get(x) === base.get(id));
      return base.get(id) + (same.length > 1 ? '” #' + (same.indexOf(id) + 1) : '”');
    };
    const named = s => s.replace(/\u0001(\w+)\u0001”?/g, (m, id) => label(id));
    for (const b of Object.values(buttons)) for (const t of b.triggers) t.text = named(t.text);
    // Buttons on the slide by name alone (two "Continue" buttons on feedback layers going to the same slide are one line)
    const jumpList = [];
    for (const j of jumps) {
      const name = base.get(j.name.replace(/\u0001/g, '')) || j.name;
      if (!jumpList.some(x => x.name === name && x.to === j.to)) jumpList.push({ name, to: j.to });
    }
    const here = index.get(slide.id);
    return { slideId: slide.id, number: here ? here.number : '', title: here ? here.title : plain(slide.title), buttons, jumps: jumpList.slice(0, 8), vars: [...vars] };
  }

  // ── The text on a slide, for a reviewer to copy into a comment ──
  // Each layer's text boxes in reading order: top to bottom, then left to right, by their position on the slide
  // (an object inside a group is placed relative to the group). Each text box is one entry, its paragraphs on
  // separate lines. Object states (Hover, Visited and so on) usually repeat the object's text, so they're left out.
  // Layers have no names in the published course, so they're "Layer 2", "Layer 3" and so on, in the slide's order.
  const CARRY_ON = /(?:^|\s)(and|or|nor|but|of|the|a|an|to|for|in|on|at|by|with|from|as|that|your|our|their|its|is|are|&|-|–)$/i;
  function slideText(slide) {
    const out = [];
    (Array.isArray(slide && slide.slideLayers) ? slide.slideLayers : []).forEach((layer, i) => {
      const items = [];
      (function find(objects, dx, dy) {
        for (const o of Array.isArray(objects) ? objects : []) {
          if (!o || typeof o !== 'object') continue;
          const x = dx + (+o.xPos || 0), y = dy + (+o.yPos || 0);
          for (const t of Array.isArray(o.textLib) ? o.textLib : []) {
            // Paragraphs on their own lines. A line break inside a paragraph (Shift+Enter, stored as "\r") is a space,
            // and a paragraph that carries on a sentence joins the one before: it starts with a small letter, or the
            // one before ends in a word a sentence can't end on ("Team Member Safety and" / "Workplace Violence").
            const paras = ((t && t.vartext && t.vartext.blocks) || []).map(b => (b.spans || []).map(sp => sp.text).join('')
              .replace(/\r\n?|[\u2028\u2029]|\n/g, ' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
            const carriesOn = (before, p) => !/[.!?:;\u2026]["\u201d\u2019)]*$/.test(before) && (/^[a-z&,\u2013\u2014-]/.test(p) || CARRY_ON.test(before));
            const text = paras.reduce((all, p) => all && carriesOn(all, p) ? all + ' ' + p : (all ? all + '\n' : '') + p, '');
            if (text) items.push({ x, y, text });
          }
          find(o.objects, x, y);
        }
      })(layer && layer.objects, 0, 0);
      // Text boxes within 8 pixels of the same height read as one row, left to right
      items.sort((a, b) => Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x);
      const texts = items.map(t => t.text).filter((t, k, all) => all.indexOf(t) === k);
      if (texts.length) out.push({ layer: i === 0 ? 'Base layer' : 'Layer ' + (i + 1), texts });
    });
    return out;
  }

  // Closed captions: each audio or video clip in data.js "assetLib" can name a captions file,
  //   { "id": 59, "url": "story_content/….mp3", "captions": "story_content/60doakqCMTk_captions.js" }
  // which is window.globalLoadJsAsset('<file>', {"captions":[{"langCode":"en-US","data":"<WebVTT, URL-encoded>"}]}).
  // A slide plays a clip from a layer's audio ("audiolib":[{"assetId":59}]) or a video object ("videodata":{"assetId":94}).
  // The captions of the clips on a slide, in layer order: [{ layer, name, file }]
  function slideMedia(slide, data) {
    const assets = new Map(((data && data.assetLib) || []).filter(a => a && a.captions).map(a => [a.id, a]));
    const out = [];
    (Array.isArray(slide && slide.slideLayers) ? slide.slideLayers : []).forEach((layer, i) => {
      const name = i === 0 ? 'Base layer' : 'Layer ' + (i + 1);
      const add = (id, what) => { const a = assets.get(id); if (a && !out.some(m => m.file === a.captions)) out.push({ layer: name, name: what, file: a.captions }); };
      for (const au of Array.isArray(layer && layer.audiolib) ? layer.audiolib : []) if (au) add(au.assetId, 'Audio');
      walk(layer && layer.objects, o => {
        const v = o.data && (o.data.videodata || o.data.audiodata);
        if (v && v.assetId != null) add(v.assetId, o.data.videodata ? 'Video' + (v.altText ? ' “' + plain(v.altText) + '”' : '') : 'Audio');
      });
    });
    return out;
  }
  // A captions file's text: the cues' words, one cue per line (the first language, if there are several)
  function captionsText(fileText) {
    const m = /globalLoadJsAsset\(\s*'[^']*'\s*,\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/.exec(String(fileText || ''));
    if (!m) return '';
    let vtt = '';
    try { const c = JSON.parse(m[1]).captions; vtt = decodeURIComponent((c && c[0] && c[0].data) || ''); } catch (e) { return ''; }
    const lines = [];
    for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
      const rows = block.split('\n').map(r => r.trim()).filter(Boolean);
      const at = rows.findIndex(r => /-->/.test(r));
      if (at < 0) continue;   // the WEBVTT header, NOTE and STYLE blocks
      const text = rows.slice(at + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
    return lines.join('\n');
  }

  // Each slide's notes (the player's Notes tab, which a course may rename, for example "Transcript"): in frame.js,
  //   "notesData": [{ "slideId": "<scene>.<slide>", "content": "<p …><span …>…</span></p>…" }]
  // and the tab's name in "stringTables" ("transcript"). Returns { label, bySlide: { slideId: text } }.
  function htmlToText(html) {
    const entity = (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' })[e] || m;
    return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&(#x?[0-9a-f]+|\w+);/gi, entity).replace(/ /g, ' ')
      .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  }
  function slideNotes(frame) {
    const bySlide = {};
    for (const n of Array.isArray(frame && frame.notesData) ? frame.notesData : []) {
      const text = n && htmlToText(n.content);
      if (text) bySlide[String(n.slideId || '').split('.').pop()] = text;
    }
    let label = '';
    for (const t of Object.values((frame && frame.stringTables) || {})) if (!label && t && t.string && typeof t.string.transcript === 'string') label = t.string.transcript.trim();
    return { label: label || 'Notes', bySlide };
  }

  // ── What changed between two versions of a course ──
  // Review keeps each version of a course in its own folder, but the course frame can't see the list of versions.
  // So the text of each version opened is kept (courseSnapshot), and a later version is compared with it. Slides
  // are matched by their id, which stays the same when a Storyline project is republished; the course is matched
  // by data.js "courseId" (a copy of a project made with Save As keeps it too, so the course title is shown).
  // captionsOf(file) gives a captions file's text (captionsText), or null when it isn't read: then the version is kept
  // without captions (hasCaptions false), and captions aren't compared with it.
  function courseSnapshot(data, slideData, notes, captionsOf) {
    const slides = [];
    let hasCaptions = !!captionsOf;
    for (const s of slideIndex(data).values()) {
      const sd = s.slide.html5url ? slideData(s.slide.html5url) : s.slide;
      const text = sd && sd.slideLayers ? slideText(sd).flatMap(l => l.texts.map(t => (l.layer === 'Base layer' ? '' : '[' + l.layer + '] ') + t)) : null;
      // Each caption (cue) is one line, labelled with its layer like the text
      const captions = [];
      for (const m of captionsOf && sd && sd.slideLayers ? slideMedia(sd, data) : []) {
        const t = captionsOf(m.file);
        if (t == null) { hasCaptions = false; continue; }
        for (const line of t.split('\n')) if (line) captions.push((m.layer === 'Base layer' ? '' : '[' + m.layer + '] ') + line);
      }
      slides.push({ id: s.id, number: s.number, title: s.title, text, captions, notes: (notes && notes.bySlide[s.id]) || '' });
    }
    // (numbering: "menu" for menu numbers; versions kept before 1.7.0 have scene numbers)
    return { courseId: data.courseId || data.projectId || '', title: slides.length ? slides[0].title : '', hasCaptions, numbering: data.menuNumbers ? 'menu' : 'scene', slides };
  }
  // How alike two texts are, by the words they share (0 to 1): to pair a removed text box with the one that replaced it
  const wordsOf = s => String(s).toLowerCase().match(/[a-z0-9']+/g) || [];
  function alike(a, b) {
    const wa = wordsOf(a), wb = new Set(wordsOf(b));
    if (!wa.length || !wb.size) return 0;
    const shared = wa.filter(w => wb.has(w)).length;
    return 2 * shared / (wa.length + wb.size);
  }
  // What changed inside a line, word by word: [{ op: 'same' | 'del' | 'add', text }]. Words, punctuation and spaces
  // are separate pieces, so "cylinders.onnected to …" → "cylinders." marks just "onnected to …" as removed.
  function wordChanges(was, now) {
    const split = s => String(s || '').match(/[\p{L}\p{N}'’]+|[^\p{L}\p{N}\s'’]+|\s+/gu) || [];
    const a = split(was), b = split(now);
    if (a.length * b.length > 250000) return [{ op: 'del', text: String(was) }, { op: 'add', text: String(now) }];   // too long to compare
    // Longest common sequence of pieces (spaces don't anchor a match), then walk it
    const key = t => /^\s+$/.test(t) ? ' ' : t;
    const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i][j] = key(a[i]) === key(b[j]) && key(a[i]) !== ' ' ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const out = [], push = (op, text) => { const last = out[out.length - 1]; if (last && last.op === op) last.text += text; else out.push({ op, text }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (key(a[i]) === key(b[j]) && (key(a[i]) !== ' ' || L[i][j] === L[i + 1][j + 1])) { push('same', b[j]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) push('del', a[i++]);
      else push('add', b[j++]);
    }
    while (i < n) push('del', a[i++]);
    while (j < m) push('add', b[j++]);
    // A changed space between kept words isn't a change worth showing
    return out.map(p => p.op !== 'same' && /^\s+$/.test(p.text) ? { op: 'same', text: p.op === 'del' ? '' : p.text } : p).filter(p => p.text);
  }
  // Lines only in one version ([{ was, now }]); a removed line much like an added one is shown as changed
  function changedLines(was, now) {
    const out = [];
    const removed = was.filter(t => !now.includes(t)), added = now.filter(t => !was.includes(t));
    for (const r of removed) {
      let best = -1, score = 0.5;
      added.forEach((a, i) => { const x = alike(r, a); if (x > score) { score = x; best = i; } });
      out.push({ was: r, now: best >= 0 ? added.splice(best, 1)[0] : null });
    }
    for (const a of added) out.push({ was: null, now: a });
    return out;
  }
  // Text as it reads, for comparing: line breaks and runs of spaces don't count as changes
  const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
  // Captions and notes by sentence. A caption is one line on screen, and where the lines break moves whenever the
  // wording changes, so each clip's captions (lines with the same "[Layer n] " label) are read as one text first.
  const SENTENCE_END = /(?<=[.!?…]["”’)\]]*)\s+(?=["“‘(\[]?[A-Z0-9])/;
  function sentences(lines) {
    const byLabel = new Map();
    for (const line of lines || []) {
      const m = /^(\[[^\]]+\] )?([\s\S]*)$/.exec(String(line));
      const label = m[1] || '';
      byLabel.set(label, (byLabel.has(label) ? byLabel.get(label) + ' ' : '') + m[2]);
    }
    const out = [];
    for (const [label, text] of byLabel) for (const s of flat(text).split(SENTENCE_END)) if (s) out.push(label + s);
    return out;
  }
  // A clip's captions (one caption per line, as captionsText gives them) as one sentence per line
  const captionSentences = text => sentences(String(text || '').split('\n')).join('\n');
  // From old to new: slides added, removed, moved or renamed, and text, closed captions and notes changed on each
  // slide. Captions are compared only when both versions were kept with them (versions kept before 1.6.0 weren't).
  function compareSnapshots(old, now) {
    const before = new Map(old.slides.map(s => [s.id, s]));
    const after = new Map(now.slides.map(s => [s.id, s]));
    const withCaptions = !!(old.hasCaptions && now.hasCaptions);
    // A slide has "moved" only if both versions number slides the same way (a version kept before 1.7.0 by scene)
    const sameNumbering = (old.numbering || 'scene') === (now.numbering || 'scene');
    const out = { added: [], removed: [], changed: [], unchanged: 0, notChecked: 0, captionsCompared: withCaptions };
    for (const s of now.slides) {
      const o = before.get(s.id);
      if (!o) { out.added.push({ id: s.id, number: s.number, title: s.title }); continue; }
      if (!s.text || !o.text) { out.notChecked++; continue; }
      const change = { id: s.id, number: s.number, title: s.title, moved: sameNumbering && o.number !== s.number ? o.number : '', renamed: o.title !== s.title ? o.title : '',
        text: changedLines(o.text.map(flat), s.text.map(flat)),
        captions: withCaptions ? changedLines(sentences(o.captions), sentences(s.captions)) : [],
        notes: changedLines(sentences([o.notes]), sentences([s.notes])) };
      if (change.moved || change.renamed || change.text.length || change.captions.length || change.notes.length) out.changed.push(change); else out.unchanged++;
    }
    for (const o of old.slides) if (!after.has(o.id)) out.removed.push({ id: o.id, number: o.number, title: o.title });
    return out;
  }

  // ── 6. Estimated seat time: how long the course takes to go through once ──
  // Storyline doesn't record one, so it's worked out from the slides:
  //   - each slide's base layer timeline ("timeline":{"duration": ms}), which runs as long as its narration and video;
  //   - but at least the time to read the slide's text, for slides whose timeline is shorter (READING_WPM);
  //   - layers (feedback, tabs, pop-ups) separately, as "up to", since a learner opens only some of them;
  //   - a question bank draw counts its drawn slides, at the average of the bank's slides.
  // Not included: time spent answering questions or choosing, and branches the learner doesn't take.
  const READING_WPM = 200;
  function wordsIn(layer) {
    let n = 0;
    (function find(o) {
      if (!o || typeof o !== 'object') return;
      for (const t of Array.isArray(o.textLib) ? o.textLib : []) {
        n += ((t && t.vartext && t.vartext.blocks) || []).map(b => (b.spans || []).map(sp => sp.text).join('')).join(' ').split(/\s+/).filter(Boolean).length;
      }
      for (const k in o) if (k !== 'textLib') find(o[k]);
    })(layer && layer.objects);
    return n;
  }
  function slideTime(sd) {
    const layers = Array.isArray(sd && sd.slideLayers) ? sd.slideLayers : [];
    if (!layers.length || !layers[0].timeline) return null;   // an outline only (the slide's own file isn't read yet)
    const timeline = layers[0].timeline.duration || 0;
    const reading = Math.round(wordsIn(layers[0]) / READING_WPM * 60000);
    return { timeline, reading, extra: Math.max(0, reading - timeline), layers: layers.slice(1).reduce((t, l) => t + ((l.timeline && l.timeline.duration) || 0), 0) };
  }
  function seatTime(data, slideData) {
    const out = { ms: 0, timelineMs: 0, readingMs: 0, layersMs: 0, slides: 0, unread: 0, drawn: 0, questions: questionSlides(data).filter(q => !q.bank).length, wpm: READING_WPM };
    const add = (t, times) => { out.timelineMs += t.timeline * times; out.readingMs += t.extra * times; out.layersMs += t.layers * times; };
    // A slide file not read yet is unread; a slide inside data.js without a timeline takes no time
    const NONE = { timeline: 0, reading: 0, extra: 0, layers: 0 };
    const timeOf = s => s.html5url ? slideTime(slideData(s.html5url)) : slideTime(s) || NONE;
    for (const scene of data.scenes || []) {
      if (scene.isMessageScene) continue;
      for (const s of scene.slides || []) {
        const t = timeOf(s);
        if (t) { add(t, 1); out.slides++; } else out.unread++;
      }
    }
    // Question bank draws: n slides drawn from a pool, at the pool's average
    const bank = new Map(((data.slideBank && data.slideBank.slides) || []).map(s => [s.id, s]));
    walk(data.scenes, o => {
      if (o.kind !== 'slidedraw') return;
      const pool = (o.sliderefs || []).map(r => bank.get(String(r.id || '').split('.').pop())).filter(Boolean).map(timeOf).filter(Boolean);
      const n = o.shuffle && o.shufflecount > 0 ? o.shufflecount : (o.sliderefs || []).length;
      if (!pool.length || !n) return;
      const avg = k => pool.reduce((t, p) => t + p[k], 0) / pool.length;
      add({ timeline: avg('timeline'), extra: avg('extra'), layers: avg('layers') }, n);
      out.drawn += n;
      out.questions += n;
    });
    out.ms = out.timelineMs + out.readingMs;
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
    completionInfo, seatTime, menuNumbers, slideText, slideMedia, captionsText, captionSentences, wordChanges, slideNotes, htmlToText, courseSnapshot, compareSnapshots, slideIndex, slideOf, findActions, explainSlide, describeStatement, STATUS_WORDS, LMS_CALLS, SCORE_CALLS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, '__storylineReviewCore', { value: api });   // hidden from the course's own scripts' enumeration
})(typeof globalThis !== 'undefined' ? globalThis : this);
