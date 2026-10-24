// End to end: the extension itself, loaded unpacked into headless Chrome, on a real Review course.
// Opens the side panel page for the course's tab, checks its notes and answer list, and uses its checkboxes:
// the course must reload with the settings on (menu free), then back to the published course when they're turned off.
// Course: "extension" in tests/courses.json (a "restricted" menu and a quiz).
const path = require('path');
const { launch, reporter, sleep, saveScreenshot } = require('./lib/browser');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();
const EXT = path.join(__dirname, '..');

(async () => {
  const url = courses().extension;
  const b = await launch({ browser: 'chrome', extension: EXT });
  const { cdp } = b;
  try {
    check('the extension loads', !!b.extensionId, b.extensionId);
    const attach = async targetId => (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
    const courseTab = (await cdp.send('Target.createTarget', { url })).result.targetId;
    // The side panel page in its own tab, pointed at the course's tab (?tab=<id>)
    const panelTarget = (await cdp.send('Target.createTarget', { url: `chrome-extension://${b.extensionId}/sidepanel/sidepanel.html` })).result.targetId;
    let panel = await attach(panelTarget);
    await sleep(1500);
    const tabId = await cdp.evaluate(`(async () => { const me = await chrome.tabs.getCurrent(); return (await chrome.tabs.query({})).filter(t => t.id !== me.id).map(t => t.id).pop(); })()`, panel);
    await cdp.send('Page.navigate', { url: `chrome-extension://${b.extensionId}/sidepanel/sidepanel.html?tab=${tabId}` }, panel);
    await sleep(1000);
    panel = await attach(panelTarget);
    const P = expr => cdp.evaluate(expr, panel);
    const waitP = async (expr, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await P(expr); if (v) return v; } catch (e) {} await sleep(500); } return null; };
    const note = id => P(`document.getElementById('${id}').textContent`);
    const badge = () => P(`chrome.action.getBadgeText({})`);

    const found = await waitP(`!document.getElementById('course').classList.contains('warn') && /trigger/.test(document.getElementById('slNavNote').textContent)`);
    check('the side panel finds the course in the tab', !!found, await P(`document.getElementById('course').textContent`));
    for (const id of ['slFreeNote', 'slSeekNote', 'slNavNote', 'slAnswersNote']) console.log('   ' + (await note(id)));
    check('the menu note shows the published "restricted"', /"restricted"\.$/.test(await note('slFreeNote')));
    check('the Next/Prev note counts the locks', /^\d+ trigger\(s\) in \d+ slide\(s\)/.test(await note('slNavNote')));
    const listed = await P(`document.querySelectorAll('#quizList li').length`);
    check('the quiz answers are listed', listed > 0, listed + ' question(s)');
    check('the toolbar badge is off', (await badge()) === '');

    // Turn on free navigation and answers: the course reloads with them
    await P(`document.getElementById('slFree').click(); document.getElementById('slAnswers').click(); 1`);
    await sleep(1000);
    const stored = await P(`chrome.storage.local.get('settings').then(r => r.settings)`);
    check('both clicks are saved', stored && stored.freeNav && stored.answers, JSON.stringify(stored));
    const applied = await waitP(`/opened as "free"/.test(document.getElementById('slFreeNote').textContent) && /open with the correct answer/.test(document.getElementById('slAnswersNote').textContent)`);
    check('the course reloads with the new settings', !!applied, await note('slFreeNote'));
    check('the toolbar badge shows ON', (await badge()) === 'ON');
    // Bring the course tab to the front: in a background tab the player may not finish building the page after reloading
    await cdp.send('Target.activateTarget', { targetId: courseTab });
    // The course frame is replaced when it reloads, so it's looked up again on each try
    let locked = null;
    for (let i = 0; i < 40 && locked === null; i++) {
      try {
        const frame = (await cdp.send('Target.getTargets')).result.targetInfos.find(t => t.type === 'iframe' && /articulateusercontent\.com\/review\/items\/[^/]+\/story/.test(t.url));
        const n = await cdp.evaluate(`document.querySelectorAll('#outline-content .cs-listitem').length ? [...document.querySelectorAll('#outline-content .cs-listitem')].filter(e => e.classList.contains('cs-restricted') && !e.classList.contains('cs-viewed')).length : null`, await attach(frame.targetId));
        if (n !== null) locked = n;
      } catch (e) { if (i % 10 === 0) console.log('   (menu check: ' + e.message.slice(0, 150) + ')'); }
      if (locked === null) await sleep(500);
    }
    check('the course menu locks no slides', locked === 0, locked);

    // A screenshot of the panel at side-panel width
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    saveScreenshot('side-panel.png', (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, panel)).result.data);

    // Turn them off: back to the published course
    await P(`for (const id of ['slFree', 'slAnswers']) document.getElementById(id).click(); 1`);
    const back = await waitP(`/"restricted"\\.$/.test(document.getElementById('slFreeNote').textContent.trim())`);
    check('turning the settings off reloads the published course', !!back, await note('slFreeNote'));
    check('the toolbar badge is off again', (await badge()) === '');
  } catch (e) {
    check('test ran without errors', false, e && e.message);
  } finally {
    b.close();
    finish();
  }
})();
