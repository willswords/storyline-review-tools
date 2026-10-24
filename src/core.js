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
  function frameInfo(frame) {
    const o = frameOptions(frame), menu = o.menuOptions, c = o.controls;
    return {
      flow: menu && typeof menu.flow === 'string' ? menu.flow : null,
      seekbar: c && typeof c.readonly === 'boolean' ? { readonly: c.readonly, readonlyOnce: c.readonlyOnce === true } : null
    };
  }
  function changeFrame(frame, settings) {
    const o = frameOptions(frame);
    let n = 0;
    if (settings.freeNav && o.menuOptions && typeof o.menuOptions.flow === 'string' && o.menuOptions.flow !== 'free') { o.menuOptions.flow = 'free'; n++; }
    if (settings.seekbar && o.controls) {
      for (const k of ['readonly', 'readonlyOnce']) if (o.controls[k] === true) { o.controls[k] = false; n++; }
    }
    return n;
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

  const QUESTION_TYPES = { multiplechoice: 'Multiple choice', multipleresponse: 'Multiple response', truefalse: 'True/false', fillin: 'Fill in the blank',
    wordbank: 'Word bank', matching: 'Matching', matchingdropdown: 'Matching (drop-down)', sequence: 'Sequence', sequencedragdrop: 'Sequence (drag and drop)',
    numeric: 'Numeric', hotspot: 'Hotspot', dragdrop: 'Drag and drop', likert: 'Likert scale', essay: 'Essay', shortanswer: 'Short answer',
    rankingdragdrop: 'Ranking', howmany: 'How many', pickone: 'Pick one', pickmany: 'Pick many', freeform: 'Freeform' };

  const api = { readProvided, frameInfo, changeFrame, countLocks, changeSlideLocks, slideFiles, questionSlides,
    buildQuizKey, applyAnswers, questionText, describeCondition, numberFor, QUESTION_TYPES, NAV_CONTROLS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, '__storylineReviewCore', { value: api });   // hidden from the course's own scripts' enumeration
})(typeof globalThis !== 'undefined' ? globalThis : this);
