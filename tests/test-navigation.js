// Free navigation and Next/Prev, on a Review course with a "restricted" menu and triggers that disable Next/Prev.
// Opened twice: with the settings off (the course as published, nothing changed) and on.
// Course: "navigation" in tests/courses.json.
const { openCourse } = require('./lib/review');
const { reporter, sleep } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();
const LOCKED_ITEMS = `[...document.querySelectorAll('#outline-content .cs-listitem')].filter(e => e.classList.contains('cs-restricted') && !e.classList.contains('cs-viewed')).length`;

(async () => {
  const url = courses().navigation;
  for (const on of [false, true]) {
    console.log(`--- settings ${on ? 'on' : 'off'}`);
    const c = await openCourse(url, { freeNav: on, seekbar: on, nav: on, answers: on });
    try {
      const st = await c.ready();
      check('the hook runs and reads every slide', !!st, st ? JSON.stringify(st.locks) : 'no state');
      if (!st) continue;
      await sleep(2000);
      const locked = await c.ev(LOCKED_ITEMS);
      if (!on) {
        check('the published menu is "restricted"', st.frame && st.frame.flow === 'restricted', st.frame && st.frame.flow);
        check('the menu locks slides not viewed yet', locked > 0, locked);
        check('triggers disabling Next/Prev are counted', st.locks.nav > 0, st.locks.nav + ' in ' + st.locks.slidesWithNav + ' slide(s)');
        check('nothing is changed with the settings off', st.changed.frame === 0 && st.changed.nav === 0 && st.changed.answers === 0, JSON.stringify(st.changed));
      } else {
        check('the menu opens as "free"', st.changed.frame >= 1);
        check('the menu locks no slides', locked === 0, locked);
        check('triggers disabling Next/Prev are switched', st.changed.nav > 0, JSON.stringify(st.changed));
        const next = await c.ev(`(() => { const n = document.querySelector('#next'); return n ? n.className + ' aria-disabled=' + n.getAttribute('aria-disabled') : null; })()`);
        check('Next is enabled', !!next && !/cs-disabled|aria-disabled=true/.test(next), next);
        const before = st.changed.slides;
        await c.click('#next');
        await sleep(3000);
        const st2 = await c.state();
        check('Next moves to the next slide', st2.changed.slides > before, JSON.stringify(st2.changed));
        await c.shot('navigation-on.png');
      }
      check('no errors from the extension’s scripts', !c.errors.some(e => /storylineReview|core\.js|hook\.js/i.test(e)), c.errors.slice(0, 2).join(' | ') || 'none');
    } finally { c.close(); }
  }

  // Add Next/Prev buttons where turned off, on slides whose Player features hide them (course "hiddenNav": slide 1.1 hides both, 1.3 hides Next)
  const hiddenUrl = courses().hiddenNav;
  if (hiddenUrl) for (const on of [false, true]) {
    console.log(`--- hidden Next/Prev, settings ${on ? 'on' : 'off'}`);
    const c = await openCourse(hiddenUrl, { unhide: on });
    try {
      const st = await c.ready();
      check('slides hiding Next/Prev are counted', st && st.locks.slidesHidingNav > 0, st && st.locks.slidesHidingNav);
      await sleep(2500);
      const shown = sel => c.ev(`(() => { const e = document.querySelector('${sel}'); if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return !!r.width && s.display !== 'none' && s.visibility !== 'hidden'; })()`);
      const num = () => c.ev(`(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().get('slideNumberInScene'); } catch (e) { return null; } })()`);
      const press = async (sel, to) => { for (let i = 0; i < 3; i++) { await c.click(sel); if (await c.waitFor(`(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().get('slideNumberInScene') === ${to}; } catch (e) { return false; } })()`, 5000)) return true; } return false; };
      if (!on) {
        check('slide 1.1 shows neither Next nor Prev, as published', !(await shown('#next')) && !(await shown('#prev')));
      } else {
        check('slide 1.1 shows Next and Prev', (await shown('#next')) && (await shown('#prev')));
        check('Next goes to slide 1.2', await press('#next', 2), await num());
        check('Prev goes back to slide 1.1', await press('#prev', 1), await num());
        await press('#next', 2);
        check('Next goes on to slide 1.3', await press('#next', 3), await num());
        check('slide 1.3 (Next hidden) shows Next, and it goes to slide 1.4', (await shown('#next')) && (await press('#next', 4)), await num());
      }
      check('no errors from the extension’s scripts', !c.errors.some(e => /storylineReview|core\.js|hook\.js/i.test(e)), c.errors.slice(0, 2).join(' | ') || 'none');
    } finally { c.close(); }
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
