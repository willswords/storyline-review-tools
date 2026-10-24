// Pre-selected quiz answers on Review courses with a multiple-choice or true/false quiz. For each course, opened with the
// settings off and on: go to the first question through the course menu, and check the correct choice is (on) or isn't
// (off) already selected, with no other choice selected.
// Courses: "answers" in tests/courses.json.
const { openCourse } = require('./lib/review');
const { reporter, sleep } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();
const LOCKED_ITEMS = `[...document.querySelectorAll('#outline-content .cs-listitem')].filter(e => e.classList.contains('cs-restricted') && !e.classList.contains('cs-viewed')).length`;

(async () => {
  for (const url of courses().answers) {
    for (const on of [false, true]) {
      const c = await openCourse(url, { freeNav: on, seekbar: on, nav: on, answers: on });
      try {
        const st = await c.ready();
        if (!st) { check('the course loads with the hook', false, url); continue; }
        const q = st.quiz && st.quiz.questions.find(x => x.apply && x.apply.checked);
        console.log(`--- ${st.title} · settings ${on ? 'on' : 'off'} · first question on slide "${q ? q.slideTitle : '?'}"`);
        if (!q) { check('the course has a multiple-choice or true/false question', false); continue; }
        // Free navigation is needed to jump to the question, unless the course's menu is already free
        const canJump = on || st.frame.flow === 'free';
        if (on) check('the menu locks no slides', (await c.ev(LOCKED_ITEMS)) === 0);
        await c.goToSlide(q.slideId);
        await sleep(4000);
        const want = q.apply.checked[0];
        const choice = await c.ev(`(() => { const el = document.getElementById('acc-${want}'); if (!el) return null;
          return { checked: el.checked, others: [...document.querySelectorAll('input.acc-radio, input.acc-checkbox')].filter(g => g !== el && g.checked).length }; })()`);
        if (canJump) check('the menu goes to the question', !!choice, choice ? '' : 'choice ' + want + ' not on screen');
        else check('the "restricted" menu doesn’t go to the question', !choice);
        if (choice && on) check('the correct choice is selected, and nothing else', choice.checked && choice.others === 0, JSON.stringify(choice));
        if (choice && !on) check('nothing is selected with the settings off', !choice.checked && choice.others === 0, JSON.stringify(choice));
        if (on) {
          const st2 = await c.state();
          check('the hook reports answers filled in', st2.changed.answers >= 1, JSON.stringify(st2.changed));
          await c.shot('answers-' + st.title.replace(/[^\w]+/g, '-').slice(0, 40) + '.png');
        }
      } finally { c.close(); }
    }
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
