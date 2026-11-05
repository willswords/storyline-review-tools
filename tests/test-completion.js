// Completion: the side panel's "how this course completes" and the status the course reports as it's played.
// Courses: "completion" in tests/courses.json, one for each Storyline tracking option:
//   trigger  slide 2 has a Complete Course trigger when its timeline starts (tracking uses triggers)
//   views    2 slides, tracking "view all slides"
//   quiz     one true/false question (answer True) with a 100% pass mark, and a results slide
const { openCourse } = require('./lib/review');
const { reporter, sleep } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();

const STATUS = `(document.dispatchEvent(new Event('storyline-review-tools:get-state')), window.__srtState && window.__srtState.completion)`;
const statusIs = (c, s, ms = 15000) => c.waitFor(`(() => { const x = ${STATUS}; return x && x.status === ${JSON.stringify(s)} ? x : null; })()`, ms);
const lastStatus = comp => [...comp.history].reverse().find(h => h.kind === 'status');
const ALERT = `document.querySelector('storyline-review-tools-alert')`;
const alertShown = c => c.ev(`!!${ALERT} && ${alertVisibleExpr}`);
const alertVisibleExpr = `getComputedStyle(${ALERT}.shadowRoot.querySelector('.toast')).display !== 'none'`;
const alertVisible = c => c.ev(alertVisibleExpr);
const alertText = c => c.ev(`${ALERT}.shadowRoot.querySelector('.toast').textContent`);

// Press Next and wait for the given slide (clicks right after loading can be lost while the player settles)
const SLIDE_NUMBER = `(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().get('slideNumberInScene'); } catch (e) { return null; } })()`;
async function next(c, to) {
  for (let i = 0; i < 4; i++) {
    await c.click('#next');
    if (await c.waitFor(`${SLIDE_NUMBER} === ${to}`, 5000)) return true;
  }
  return false;
}
// Click a visible button by its text (feedback layers' Continue, the results slide's Retry Quiz)
async function clickButton(c, text) {
  const found = await c.ev(`(() => { const b = [...document.querySelectorAll('button, [role=button]')].find(b => b.getBoundingClientRect().width && (b.getAttribute('aria-label') || b.textContent).trim() === ${JSON.stringify(text)});
    if (b) b.setAttribute('data-srt-test', ${JSON.stringify(text)}); return !!b; })()`);
  return found && c.click(`[data-srt-test="${text}"]`);
}
// Choose a true/false answer (0 = True, 1 = False) and submit, then continue past the feedback
async function answer(c, choice) {
  await c.waitFor(`document.querySelectorAll('input.acc-radio').length > ${choice}`, 15000);
  await c.ev(`document.querySelectorAll('input.acc-radio')[${choice}].click()`);
  await sleep(500);
  await c.click('#submit');
  await sleep(2500);
  await clickButton(c, 'Continue');
  await sleep(3000);
}
const noErrors = c => check('no errors from the extension’s scripts', !c.errors.some(e => /storylineReview|core\.js|hook\.js/i.test(e)), c.errors.slice(0, 2).join(' | ') || 'none');

async function opened(name, url, settings = {}) {
  console.log(`--- ${name}`);
  const c = await openCourse(url, settings);
  const st = await c.ready();
  await c.waitFor(`(() => { const x = ${STATUS}; return x && x.watching && x.info && x.info.checked; })()`, 20000);
  return { c, comp: await c.ev(STATUS) };
}

(async () => {
  const urls = courses().completion;

  // Complete Course trigger
  {
    const { c, comp } = await opened('trigger', urls.trigger);
    try {
      const crit = comp && comp.info && comp.info.criteria;
      check('the player’s status events are being followed', comp && comp.watching === true, comp && String(comp.watching));
      check('tracking is "Complete Course trigger"', crit && crit.length === 1 && crit[0].kind === 'trigger', JSON.stringify(crit));
      check('the trigger is found on slide 1.2, when the timeline starts', crit && crit[0].where.some(w => w.number === '1.2' && /timeline starts/.test(w.when)), crit && JSON.stringify(crit[0].where));
      check('it reports "Passed"', comp.info.reports && comp.info.reports.met === 'pass', JSON.stringify(comp.info.reports));
      check('no problems found', comp.info.problems.length === 0, comp.info.problems.join(' | '));
      check('nothing reported on slide 1', comp.status === null && !comp.history.length, comp.status);
      check('Next goes to slide 1.2', await next(c, 2));
      const after = await statusIs(c, 'pass');
      const h = after && lastStatus(after);
      check('reaching slide 1.2 reports Passed', !!after, after ? after.status : 'still ' + (await c.ev(STATUS)).status);
      check('… from the Complete Course trigger, on slide 1.2', h && h.reason === 'Complete Course trigger' && h.slide && h.slide.number === '1.2', JSON.stringify(h));
      check('a message shows over the course', await alertShown(c));
      check('… saying “Marked passed”, from the trigger on slide 1.2', /Marked passed.*From the Complete Course trigger on slide 1\.2 “[^”]+”, \d+:\d\d into the session\./.test(await alertText(c)), await alertText(c));
      const lms = await c.ev(`(() => { const d = ${ALERT}.shadowRoot.querySelector('details'); return d && { open: d.open, summary: d.querySelector('summary').textContent, calls: d.querySelector('.calls').textContent }; })()`);
      check('“LMS details” starts closed', lms && !lms.open && lms.summary === 'LMS details', JSON.stringify(lms));
      check('… and holds the SCORM 1.2, 2004 and xAPI values', lms && /SCORM 1\.2cmi\.core\.lesson_status = "passed"SCORM 2004.*xAPIa “passed” statement/.test(lms.calls), lms && lms.calls);
      await c.shot('completion-trigger.png');
      await c.ev(`document.querySelector('storyline-review-tools-alert').shadowRoot.querySelector('button').click()`);
      check('× closes the message', !(await alertVisible(c)));
      noErrors(c);
    } finally { c.close(); }
  }

  // Slides viewed
  {
    const { c, comp } = await opened('views', urls.views);
    try {
      const crit = comp && comp.info && comp.info.criteria;
      check('tracking is "view all 2 slides"', crit && crit.length === 1 && crit[0].kind === 'view' && /all 2 slides/.test(crit[0].text), JSON.stringify(crit));
      check('nothing reported on slide 1', comp.status === null, comp.status);
      check('Next goes to slide 1.2', await next(c, 2));
      const after = await statusIs(c, 'pass');
      const h = after && lastStatus(after);
      check('viewing slide 1.2 reports Passed, from slides viewed', !!h && h.reason === 'slides viewed' && h.slide && h.slide.number === '1.2', JSON.stringify(h));
      check('the message shows', await alertShown(c));
      check('… and closes itself after 15 seconds', !!(await c.waitFor(`!(${alertVisibleExpr})`, 18000)));
      noErrors(c);
    } finally { c.close(); }
  }

  // Quiz result: fail, retry, pass
  {
    const { c, comp } = await opened('quiz', urls.quiz);
    try {
      const crit = comp && comp.info && comp.info.criteria;
      check('tracking is the quiz result, with a 100% pass mark', crit && crit.length === 1 && crit[0].kind === 'quiz' && /100%/.test(crit[0].text), JSON.stringify(crit));
      check('the results slide 1.3 reports it', crit && crit[0].where.some(w => w.number.startsWith('1.3')), crit && JSON.stringify(crit[0].where));
      check('Next goes to the question', await next(c, 2));
      await answer(c, 1);   // False: wrong
      let after = await statusIs(c, 'fail');
      let h = after && lastStatus(after);
      check('a wrong answer reports Failed on the results slide', !!h && h.reason === 'quiz result' && h.slide && h.slide.number.startsWith('1.3'), JSON.stringify(h));
      check('… with a score of 0%', after && after.score === 0, after && after.score);
      await c.shot('completion-quiz-failed.png');
      await clickButton(c, 'Retry Quiz');
      after = await statusIs(c, 'incomplete');
      check('retrying the quiz sets the status back to Incomplete', !!after && after.history.some(x => x.kind === 'reset'), after ? JSON.stringify(after.history.map(x => x.kind)) : (await c.ev(STATUS)).status);
      await sleep(2000);
      await answer(c, 0);   // True: right
      after = await statusIs(c, 'pass');
      h = after && lastStatus(after);
      check('the right answer then reports Passed', !!h && h.status === 'pass', after ? JSON.stringify(after.history.map(x => x.kind + ':' + (x.status || x.score))) : (await c.ev(STATUS)).status);
      check('… with a score of 100%', after && after.score === 100, after && after.score);
      const lines = after ? after.history.map(x => x.kind + ':' + (x.status || '') + ':' + (x.score != null ? x.score : '')).join(' ') : '';
      check('the history is Failed 0%, back to Incomplete, Passed 100% (each score in its status line)', lines === 'status:fail:0 reset:incomplete: status:pass:100', lines);
      await c.shot('completion-quiz-passed.png');
      noErrors(c);
    } finally { c.close(); }
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
