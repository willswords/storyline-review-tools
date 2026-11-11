// Added sites (the Options page): the extension works on a site only once it's added there. A published course served
// from localhost stands in for an LMS. Chrome asks the user to allow each added site, and a headless browser can't answer
// that prompt, so the extension is loaded from a copy whose manifest already allows localhost: Chrome then grants the
// Options page's request at once, and everything else (saving, registering the scripts, removing) runs as it would.
// Package: "questionTypesPackage" in tests/courses.json.
const fs = require('fs'), path = require('path'), os = require('os');
const { launch, reporter, sleep, saveScreenshot } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { serveCourse } = require('./lib/serve');
const { check, finish } = reporter();
const ROOT = path.join(__dirname, '..');

// A copy of the extension (what pack.ps1 ships), with localhost already allowed
function extensionCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-ext-'));
  for (const f of ['manifest.json', 'src', 'sidepanel', 'options', 'icons']) fs.cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.host_permissions = ['http://localhost/*', 'https://reviewmyelearning.com/*'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}

(async () => {
  const src = courses().questionTypesPackage;
  if (!src) { console.log('No "questionTypesPackage" in tests/courses.json; skipped.'); return finish(); }
  const course = await serveCourse(src);
  const ext = extensionCopy();
  const b = await launch({ browser: 'chrome', extension: ext });
  const { cdp } = b;
  try {
    const attach = async targetId => (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
    const evIn = (s, e) => cdp.evaluate(e, s);
    const waitIn = async (s, e, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await evIn(s, e); if (v) return v; } catch (x) {} await sleep(400); } return null; };

    // The course tab, and the side panel pointed at it
    const courseTab = (await cdp.send('Target.createTarget', { url: course.url })).result.targetId;
    const courseS = await attach(courseTab);
    const panelTarget = (await cdp.send('Target.createTarget', { url: `chrome-extension://${b.extensionId}/sidepanel/sidepanel.html` })).result.targetId;
    let panel = await attach(panelTarget);
    await sleep(1500);
    const tabId = await evIn(panel, `(async () => { const me = await chrome.tabs.getCurrent(); return (await chrome.tabs.query({ url: 'http://localhost/*' })).map(t => t.id).pop(); })()`);
    await cdp.send('Page.navigate', { url: `chrome-extension://${b.extensionId}/sidepanel/sidepanel.html?tab=${tabId}` }, panel);
    await sleep(1000);
    panel = await attach(panelTarget);
    const found = ms => waitIn(panel, `!document.getElementById('course').classList.contains('warn') ? document.getElementById('course').textContent : null`, ms);
    const reloadCourse = async () => { await cdp.send('Target.activateTarget', { targetId: courseTab }); await cdp.send('Page.reload', {}, courseS); await sleep(4000); };

    // Not added yet: the extension doesn't run on the course
    await cdp.send('Target.activateTarget', { targetId: courseTab });
    await sleep(6000);
    check('before the site is added, the extension doesn’t run on it', !(await found(3000)) && !(await evIn(courseS, `!!window.__storylineReviewCore`)), await evIn(panel, `document.getElementById('course').textContent`));

    // Options: type the site (with its port) and press Add
    const optTarget = (await cdp.send('Target.createTarget', { url: `chrome-extension://${b.extensionId}/options/options.html` })).result.targetId;
    const opt = await attach(optTarget);
    await sleep(1500);
    // Sites is hidden until the heading is Ctrl+clicked (a plain click does nothing)
    const sitesShown = () => evIn(opt, `getComputedStyle(document.getElementById('sitesPart')).display !== 'none'`);
    const clickTitle = async modifiers => {
      const p = await evIn(opt, `(r => ({ x: r.left + 20, y: r.top + r.height / 2 }))(document.getElementById('title').getBoundingClientRect())`);
      await cdp.send('Target.activateTarget', { targetId: optTarget });
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, modifiers, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, opt);
      await sleep(300);
    };
    check('Options starts with the side panel sections, and Sites hidden', !(await sitesShown()) && (await evIn(opt, `document.querySelector('main h2').textContent`)) === 'Side panel sections');
    await clickTitle(0);
    check('… a plain click on the heading leaves Sites hidden', !(await sitesShown()));
    await clickTitle(2);   // (2: Ctrl)
    check('… and Ctrl+click shows it', await sitesShown());
    await cdp.send('Page.reload', {}, opt); await sleep(1500);
    check('… hidden again when the page is opened again', !(await sitesShown()));
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, modifiers: 2 | 8, key: 'S', code: 'KeyS', windowsVirtualKeyCode: 83 }, opt);   // (2 | 8: Ctrl+Shift)
    check('… and Ctrl+Shift+S shows it too', !!(await waitIn(opt, `getComputedStyle(document.getElementById('sitesPart')).display !== 'none'`, 3000)));
    check('Options lists Articulate Review, always on', /articulateusercontent\.com\/review\/\*.*always on/.test(await evIn(opt, `document.getElementById('sites').textContent`)));
    await evIn(opt, `document.getElementById('pattern').value = 'not a site!'; document.getElementById('addForm').requestSubmit(); 1`);
    check('an address that isn’t a site is turned away', /isn’t a site name/.test(await waitIn(opt, `document.getElementById('msg').textContent`, 5000) || ''), await evIn(opt, `document.getElementById('msg').textContent`));
    await evIn(opt, `document.getElementById('pattern').value = 'http://localhost:${course.port}'; 1`);
    // (a real click: Chrome only asks for access during one)
    const pt = await evIn(opt, `(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.getElementById('btnAdd').getBoundingClientRect())`);
    await cdp.send('Target.activateTarget', { targetId: optTarget });
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, opt);
    const msg = await waitIn(opt, `/Added/.test(document.getElementById('msg').textContent) && document.getElementById('msg').textContent`, 10000);
    check('Add saves the site as a pattern for all its ports', /Added http:\/\/localhost\/\* \(any port\)/.test(msg || ''), msg || await evIn(opt, `document.getElementById('msg').textContent`));
    check('… listed as allowed', !!(await waitIn(opt, `/http:\\/\\/localhost\\/\\*\\s*Allowed/.test(document.getElementById('sites').textContent)`, 5000)), await evIn(opt, `document.getElementById('sites').textContent`));
    const stored = await evIn(opt, `chrome.storage.local.get('extraSites').then(r => JSON.stringify(r.extraSites))`);
    check('… and saved', stored === '["http://localhost/*"]', stored);
    await sleep(1000);
    const registered = await evIn(opt, `chrome.scripting.getRegisteredContentScripts().then(l => JSON.stringify(l.map(s => [s.id, s.world, s.matches.join(','), s.allFrames, s.runAt])))`);
    check('the extension’s scripts are registered for it (page world, every frame, at the start)', /srt-added-hook","MAIN","http:\/\/localhost\/\*",true,"document_start"/.test(registered) && /srt-added-bridge/.test(registered), registered);
    saveScreenshot('options.png', (await cdp.send('Page.captureScreenshot', { format: 'png' }, opt)).result.data);

    // Reload the course: the extension runs there, and the side panel finds it
    await reloadCourse();
    const name = await found(60000);
    check('after a reload, the side panel finds the course on the added site', !!name, name || await evIn(panel, `document.getElementById('course').textContent`));
    const quiz = await waitIn(panel, `document.querySelectorAll('#quizList > li').length`, 30000);
    check('… and reads it (its quiz answers are listed)', quiz > 0, quiz + ' question(s)');
    await sleep(3000);
    check('… without Changes since an earlier version (Articulate Review only)', await evIn(panel, `document.getElementById('versSec').hidden && getComputedStyle(document.getElementById('versSec')).display === 'none'`),
      await evIn(courseS, `(document.dispatchEvent(new Event('storyline-review-tools:get-state')), 1)`) && 'state.versions on the course: ' + (await evIn(panel, `JSON.stringify(state && state.versions)`)));

    // Review sites: the reviewmyelearning.com switch, shown without Ctrl+click
    await cdp.send('Page.reload', {}, opt); await sleep(1500);
    check('the reviewmyelearning.com switch shows without Ctrl+click, off', (await evIn(opt, `(b => !!b && b.getBoundingClientRect().width > 0 && !b.checked)(document.getElementById('rmel'))`)) === true);
    const clickIn = async (s, target, sel) => {
      const q = await evIn(s, `(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.querySelector('${sel}').getBoundingClientRect())`);
      await cdp.send('Target.activateTarget', { targetId: target });
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, s);
    };
    const scripts = () => evIn(opt, `chrome.scripting.getRegisteredContentScripts().then(l => JSON.stringify((l[0] || {}).matches || []))`);
    await clickIn(opt, optTarget, '#rmel');
    check('turning it on saves it', !!(await waitIn(opt, `chrome.storage.local.get('reviewMyElearning').then(r => r.reviewMyElearning === true)`, 5000)), await evIn(opt, `document.getElementById('rmelMsg').textContent`));
    await sleep(1000);
    check('… and runs the extension on reviewmyelearning.com courses (next to the added site)', /reviewmyelearning\.com\/content\/\*/.test(await scripts()) && /localhost/.test(await scripts()), await scripts());
    await clickIn(opt, optTarget, '#rmel');
    await waitIn(opt, `chrome.storage.local.get('reviewMyElearning').then(r => r.reviewMyElearning === false)`, 5000);
    await sleep(1000);
    check('turning it off stops that, and leaves the added site', !/reviewmyelearning/.test(await scripts()) && /localhost/.test(await scripts()), await scripts());
    await evIn(opt, `location.hash = 'sites'; location.reload(); 1`); await sleep(1500);

    // Side panel sections: all on by default; turning one off in Options hides it in the panel, and back on shows it
    check('Options shows the five side panel sections, all turned on', (await evIn(opt, `(l => l.length === 5 && l.every(b => b.checked))([...document.querySelectorAll('#sections input')])`)) === true);
    const quizShown = () => evIn(panel, `getComputedStyle(document.getElementById('quizSec')).display !== 'none'`);
    check('… and the panel shows Quiz answers', await quizShown());
    await evIn(opt, `document.querySelector('#sections input[data-sec="quizSec"]').click(); 1`);
    check('turning Quiz answers off in Options hides it in the panel', !!(await waitIn(panel, `getComputedStyle(document.getElementById('quizSec')).display === 'none'`, 5000)));
    check('… and leaves the other sections', await evIn(panel, `['slSec', 'compSec'].every(id => getComputedStyle(document.getElementById(id)).display !== 'none')`));
    check('… saved as off', (await evIn(opt, `chrome.storage.local.get('panelSections').then(r => JSON.stringify(r.panelSections))`)) === '{"quizSec":false}');
    saveScreenshot('options-sections.png', (await cdp.send('Page.captureScreenshot', { format: 'png' }, opt)).result.data);
    await evIn(opt, `document.querySelector('#sections input[data-sec="quizSec"]').click(); 1`);
    check('turning it back on shows it again', !!(await waitIn(panel, `getComputedStyle(document.getElementById('quizSec')).display !== 'none'`, 5000)));

    // Remove: the extension stops running there
    await evIn(opt, `document.querySelector('#sites button.remove').click(); 1`);
    check('Remove takes it off the list', !!(await waitIn(opt, `!/localhost/.test(document.getElementById('sites').textContent)`, 5000)));
    await sleep(1000);
    const after = await evIn(opt, `chrome.scripting.getRegisteredContentScripts().then(l => l.length)`);
    check('… and unregisters the scripts', after === 0, after);
    await reloadCourse();
    await sleep(4000);
    check('after a reload, the extension no longer runs on it', !(await evIn(courseS, `!!window.__storylineReviewCore`)));
  } finally {
    b.close(); course.close();
    try { fs.rmSync(ext, { recursive: true, force: true }); } catch (e) {}
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
