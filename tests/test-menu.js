// Free navigation shows the menu when the course's Player features turn it off. A course with a menu stands in for
// one without: its frame.js is changed as it loads, before the extension sees it, the way Storyline publishes a course
// whose Menu tab is unticked (no "outline" tab in the sidebar, the sidebar off, and every slide layout leaving it out).
// Course: "navigation" in tests/courses.json.
const { openCourse } = require('./lib/review');
const { reporter, sleep } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();

const MENU_OFF = `function (kind, json) {
  if (kind !== 'frame') return json;
  const f = JSON.parse(json), o = f.controlOptions || f, sb = o.sidebarOptions;
  for (const list of Object.values(sb.tabs || {})) if (Array.isArray(list)) list.splice(0, list.length, ...list.filter(t => t.name !== 'outline'));
  sb.sidebarEnabled = false;
  for (const l of Object.values(f.controlLayouts || o.controlLayouts || {})) if (l.outline) l.outline.enabled = false;
  return JSON.stringify(f);
}`;
// The menu as the learner sees it: its entries are drawn, and a control to open it is showing
const MENU = `(() => { const items = document.querySelectorAll('#outline-content .cs-listitem').length;
  const opener = [...document.querySelectorAll('#hamburger, #outline-link, [data-tab="outline"], .tab-outline')].some(e => e.getBoundingClientRect().width > 0);
  const panel = document.querySelector('#outline-content'); const r = panel && panel.getBoundingClientRect();
  return { items, opener, panelShown: !!r && r.width > 0 && r.left >= 0 }; })()`;
const playerUp = `!!(window.DS && DS.presentation && document.querySelector('.slide-container, #slide'))`;

(async () => {
  const url = courses().navigation;
  if (!url) { console.log('No "navigation" course in tests/courses.json; skipped.'); return finish(); }

  // The menu turned off, no options: no menu
  let c = await openCourse(url, {}, { publish: MENU_OFF });
  try {
    await c.waitFor(playerUp, 60000); await sleep(3000);
    const st = await c.state();
    check('the extension sees the menu is turned off', !!st && st.frame && st.frame.menuOff === true && st.frame.menuOffLayouts.length > 0, st && JSON.stringify({ menuOff: st.frame.menuOff, layouts: st.frame.menuOffLayouts.length }));
    const m = await c.ev(MENU);
    check('without Free navigation, the course has no menu', m.items === 0 && !m.opener && !m.panelShown, JSON.stringify(m));
    await c.shot('menu-off.png');
  } finally { c.close(); }

  // The same, with Free navigation: the menu is back, free, and goes to a slide
  c = await openCourse(url, { freeNav: true }, { publish: MENU_OFF });
  try {
    await c.waitFor(playerUp, 60000);
    const shown = await c.waitFor(`(m => m.items > 0 && (m.opener || m.panelShown) ? m : null)(${MENU})`, 30000);
    check('with Free navigation, the menu is shown', !!shown, JSON.stringify(shown || await c.ev(MENU)));
    const st = await c.state();
    check('… and the frame was changed (tab, sidebar, layouts)', !!st && st.changed.frame >= 3, st && st.changed.frame);
    await c.shot('menu-on.png');
    const slides = await c.ev(`[...document.querySelectorAll('#outline-content .cs-listitem[data-ref]')].map(e => e.getAttribute('data-ref'))`);
    const last = slides && slides[slides.length - 1];
    const slideNo = `(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().absoluteId; } catch (e) { return null; } })()`;
    const before = await c.ev(slideNo);
    if (last) await c.goToSlide(last.split('.').pop());
    const after = await c.waitFor(`(s => s && s !== ${JSON.stringify(before)} ? s : null)(${slideNo})`, 10000);
    check('… and going to the last slide from it works (menu is free)', !!after, before + ' → ' + after);
    check('no errors from the extension’s scripts', !c.errors.some(e => /storylineReview|core\.js|hook\.js/i.test(e)), c.errors.slice(0, 2).join(' | ') || 'none');
  } finally { c.close(); }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
