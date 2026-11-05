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
    const c = await openCourse(url, { freeNav: on, seekbar: on, nav: on, menuNumbers: on, answers: on });
    try {
      const st = await c.ready();
      check('the hook runs and reads every slide', !!st, st ? JSON.stringify(st.locks) : 'no state');
      if (!st) continue;
      await sleep(2000);
      const locked = await c.ev(LOCKED_ITEMS);
      // Number the menu entries: the published menu has no numbers; with the setting on, "1.1." and so on
      const firstSlide = await c.ev(`(() => { const e = document.querySelector('#outline-content .cs-listitem[data-ref*="."]') || document.querySelectorAll('#outline-content .cs-listitem')[1]; return e ? e.textContent.trim().replace(/\\s+/g, ' ') : ''; })()`);
      // (an entry's text starts with its screen-reader label, then shows the number and title)
      const NUMBER = /(^|\s)\d+(\.\d+)*\. \S/;
      check(on ? 'menu entries are numbered (“Number the menu entries”)' : 'menu entries aren’t numbered, as published', on ? NUMBER.test(firstSlide) : !NUMBER.test(firstSlide), firstSlide.slice(0, 60));
      if (!on) {
        check('the published menu is "restricted"', st.frame && st.frame.flow === 'restricted', st.frame && st.frame.flow);
        check('the menu locks slides not viewed yet', locked > 0, locked);
        check('triggers disabling Next/Prev are counted', st.locks.nav > 0, st.locks.nav + ' in ' + st.locks.slidesWithNav + ' slide(s)');
        check('nothing is changed with the settings off', st.changed.frame === 0 && st.changed.nav === 0 && st.changed.answers === 0, JSON.stringify(st.changed));
        // This slide: slide 1.1 disables Next until its timeline has played, and has a button that goes on
        const cur = await c.waitFor(`(document.dispatchEvent(new Event('storyline-review-tools:get-state')), window.__srtState && window.__srtState.current)`, 10000);
        const nextLines = cur ? cur.buttons.next.triggers.map(t => t.text) : [];
        check('This slide: slide 1.1', cur && cur.number === '1.1', cur && cur.number);
        check('… explains the timeline lock on Next', nextLines.includes('Disabled as the slide appears, if the timeline hasn’t played to the end yet.') && nextLines.includes('Enabled when the timeline ends.'), nextLines.join(' | '));
        check('… says where Next goes, and lists the button that goes on', cur && /^slide 1\.2 /.test(cur.buttons.next.goesTo[0] || '') && cur.jumps.length > 0, cur && JSON.stringify([cur.buttons.next.goesTo, cur.jumps]));
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
    // (Free navigation, when off, so the menu can go to slide 1.2: slide 1.1's Start button appears late in its timeline)
    const c = await openCourse(hiddenUrl, { unhide: on, freeNav: !on });
    try {
      const st = await c.ready();
      check('slides hiding Next/Prev are counted', st && st.locks.slidesHidingNav > 0, st && st.locks.slidesHidingNav);
      await sleep(2500);
      const shown = sel => c.ev(`(() => { const e = document.querySelector('${sel}'); if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return !!r.width && s.display !== 'none' && s.visibility !== 'hidden'; })()`);
      const num = () => c.ev(`(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().get('slideNumberInScene'); } catch (e) { return null; } })()`);
      // (up to 25 seconds: slide 1.2 greys Next out until its 10-second timeline ends)
      const press = async (sel, to) => { for (let i = 0; i < 5; i++) { await c.click(sel); if (await c.waitFor(`(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().get('slideNumberInScene') === ${to}; } catch (e) { return false; } })()`, 5000)) return true; } return false; };
      if (!on) {
        check('slide 1.1 shows neither Next nor Prev, as published', !(await shown('#next')) && !(await shown('#prev')));
        // This slide, live: 1.1 has Next turned off and a Start button; 1.2 greys Next out until its 10-second timeline ends
        const current = (when = '') => c.waitFor(`(document.dispatchEvent(new Event('storyline-review-tools:get-state')), (s => s && s.current ${when} ? s.current : null)(window.__srtState))`, 15000);
        let cur = await current(`&& s.current.number === '1.1'`);
        check('This slide: 1.1 has Next turned off in its Player features, and not showing', cur && cur.buttons.next.off && !cur.live.next.shown, cur && JSON.stringify(cur.live));
        check('… and its “Start” button goes to slide 1.2', cur && cur.jumps.some(j => j.name === 'Start' && /^slide 1\.2 /.test(j.to)), cur && JSON.stringify(cur.jumps));
        check('the menu goes to slide 1.2', await c.goToSlide('6Hc6x7vdvVE'));
        // (the slide number changes a moment before the slide's triggers run)
        cur = await current(`&& s.current.number === '1.2' && s.current.live.next.shown && !s.current.live.next.enabled`);
        const lines = cur ? cur.buttons.next.triggers.map(t => t.text) : [];
        check('This slide: 1.2 shows Next greyed out at first', !!cur, cur ? JSON.stringify(cur.live) : JSON.stringify((await current()) || {}).slice(0, 200));
        check('… because it’s disabled until the timeline ends', lines.includes('Shown but disabled when the timeline starts.') && lines.includes('Shown and enabled when the timeline ends.'), lines.join(' | '));
        cur = await current(`&& s.current.number === '1.2' && s.current.live.next.enabled`);
        check('… and available once the timeline ends', !!cur, cur && JSON.stringify(cur.live));
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
