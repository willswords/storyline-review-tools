// Changes since an earlier version, on a Review course with several versions, using Review's own version menu.
// Course: "versions" in tests/courses.json: version 2 has 3 slides ("Answer the question correctly…", a question,
// Quiz Results); the current version has 2 ("Go to the next slide…", "You have finished…"), with slide 1.1 renamed.
const { openCourse } = require('./lib/review');
const { reporter, sleep } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();

const VERSIONS = `(document.dispatchEvent(new Event('storyline-review-tools:get-state')), window.__srtState && window.__srtState.versions)`;
// Choose a version from Review's version menu ("Current Version", "Version 2"…) and wait for its frame
async function chooseVersion(c, name) {
  await c.clickPage('[data-testid="version-dropdown-trigger"]');
  await sleep(1200);
  const found = await c.evPage(`(() => { const li = [...document.querySelectorAll('[role=menuitem]')].find(e => e.getBoundingClientRect().width && e.textContent.trim().startsWith(${JSON.stringify(name)}));
    if (li) li.setAttribute('data-srt-version', '1'); return !!li; })()`);
  if (!found) return false;
  await c.clickPage('[data-srt-version]');
  await c.evPage(`document.querySelectorAll('[data-srt-version]').forEach(e => e.removeAttribute('data-srt-version'))`);
  return true;
}
const frameFolder = c => c.evPage(`(/\\/review\\/items\\/([^/]+)\\//.exec((document.querySelector('iframe') || {}).src || '') || [])[1] || ''`);

(async () => {
  const url = courses().versions;
  if (!url) { console.log('No "versions" course in tests/courses.json; skipped.'); return finish(); }
  const c = await openCourse(url, {});
  try {
    await c.ready();
    const latest = await frameFolder(c);
    let v = await c.waitFor(`(v => v && v.published ? v : null)(${VERSIONS})`, 20000);
    check('the current version is saved, with nothing earlier to compare with yet', v && v.others.length === 0 && !v.diff, v && JSON.stringify({ others: v.others.length, diff: !!v.diff }));

    // Version 2 from Review's menu: it's compared with the (newer) current version just saved
    check('Review’s version menu opens Version 2', await chooseVersion(c, 'Version 2'));
    await c.waitFor(`false`, 100);
    let folder = null;
    for (let i = 0; i < 40 && (!folder || folder === latest); i++) { folder = await frameFolder(c); if (folder === latest) await sleep(500); }
    check('… in its own folder', folder && folder !== latest, folder);
    v = await c.waitFor(`(v => v && v.diff && v.others.length ? v : null)(${VERSIONS})`, 30000);
    check('Version 2 is compared with the current version, and knows it’s the older one', v && v.comparedWith === latest && v.thisIsNewer === false, v && JSON.stringify({ comparedWith: v.comparedWith, thisIsNewer: v.thisIsNewer }));

    // Back to the current version: compared with Version 2
    check('Review’s version menu goes back to Current Version', await chooseVersion(c, 'Current Version'));
    for (let i = 0; i < 40 && (await frameFolder(c)) !== latest; i++) await sleep(500);
    v = await c.waitFor(`(v => v && v.diff && v.comparedWith === ${JSON.stringify(folder)} ? v : null)(${VERSIONS})`, 30000);
    const d = v && v.diff;
    check('the current version is compared with Version 2, as the newer one', !!d && v.thisIsNewer === true, v && JSON.stringify({ comparedWith: v.comparedWith, thisIsNewer: v.thisIsNewer }));
    const s11 = d && d.changed.find(x => x.number === '1.1');
    check('slide 1.1 is renamed, and its text changed', !!s11 && /Answer the question correctly/.test(s11.renamed) &&
      s11.text.some(t => /Answer the question/.test(t.was || '') && /Go to the next slide/.test(t.now || '')), s11 && JSON.stringify(s11).slice(0, 300));
    check('the question and Quiz Results slides were removed', !!d && d.removed.some(x => x.title === 'Quiz Results') && d.removed.length === 2, d && JSON.stringify(d.removed));
    check('the “You have finished…” slide was added', !!d && d.added.length === 1 && /You have finished/.test(d.added[0].title), d && JSON.stringify(d.added));
    // A slide link in the panel sends "go to" with the slide's id: the added slide is in this version, so it opens
    const slideNo = `(() => { try { return DS.windowManager.getCurrentWindow().getCurrentSlide().get('slideNumberInScene'); } catch (e) { return null; } })()`;
    if (d && d.added[0]) await c.ev(`document.dispatchEvent(new CustomEvent('storyline-review-tools:goto', { detail: ${JSON.stringify(d.added[0].id)} }))`);
    check('going to the added slide (1.2) opens it', !!(await c.waitFor(`${slideNo} === 2`, 10000)), await c.ev(slideNo));
    await c.shot('versions.png');
    check('no errors from the extension’s scripts', !c.errors.some(e => /storylineReview|core\.js|hook\.js/i.test(e)), c.errors.slice(0, 2).join(' | ') || 'none');
  } finally { c.close(); }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
