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
    const shown = id => P(`(e => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && !e.closest('section.collapsed > :not(h2)'))(document.getElementById('${id}'))`);

    // Developer mode starts off (the simple panel); most of this test is in Developer mode, the simple panel is checked after
    check('Developer mode starts off', (await P(`document.body.classList.contains('simple') && !document.getElementById('devMode').checked`)) === true);
    await P(`document.getElementById('devMode').click(); 1`);
    check('… and ticking it turns it on (saved)', !!(await waitP(`!document.body.classList.contains('simple') && chrome.storage.local.get('devMode').then(r => r.devMode === true)`, 5000)));

    const found = await waitP(`!document.getElementById('course').classList.contains('warn') && /trigger/.test(document.getElementById('slNavNote').textContent)`);
    check('the side panel finds the course in the tab', !!found, await P(`document.getElementById('course').textContent`));
    for (const id of ['slFreeNote', 'slSeekNote', 'slNavNote', 'slAnswersNote']) console.log('   ' + (await note(id)));
    check('the menu note shows the published "restricted"', /"restricted"\.$/.test(await note('slFreeNote')));
    check('the Next/Prev note counts the locks', /^\d+ trigger\(s\) in \d+ slide\(s\)/.test(await note('slNavNote')));
    const listed = await P(`document.querySelectorAll('#quizList li').length`);
    check('the quiz answers are listed', listed > 0, listed + ' question(s)');
    check('the toolbar badge is off', (await badge()) === '');
    const how = await waitP(`!document.getElementById('compSec').hidden && /Complete when/.test(document.getElementById('compHow').textContent) && document.getElementById('compHow').textContent`, 20000);
    check('the Completion section says how the course completes', !!how, how || await P(`document.getElementById('compHow').textContent`));
    check('… and that nothing is reported yet', /Not reported yet/.test(await note('compNow')), await note('compNow'));
    const seat = await waitP(`/^About \\d+ (min|h)/.test(document.getElementById('compSeat').textContent) && !/still reading/.test(document.getElementById('compSeat').textContent) && document.getElementById('compSeat').textContent`, 20000);
    check('… and an estimated seat time, with how it’s worked out', !!seat && /Slide timelines: .+ across \d+ slide/.test(await note('compSeatList')), (seat || await note('compSeat')) + ' | ' + (await note('compSeatList')));

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

    // This slide (now the course tab is in front, so the player has started the slide)
    const slideSec = await waitP(`!document.getElementById('slideSec').hidden && /^Slide 1\\.1/.test(document.getElementById('slideName').textContent) && document.getElementById('slideNav').textContent`, 20000);
    check('This slide names the slide and explains Next and Prev', !!slideSec && /Next/.test(slideSec) && /Prev/.test(slideSec) && /Goes to slide 1\.2/.test(slideSec),
      (slideSec || await P(`JSON.stringify({ hidden: document.getElementById('slideSec').hidden, name: document.getElementById('slideName').textContent })`)).slice(0, 300));
    const closed = () => P(`document.getElementById('slideSec').classList.contains('collapsed')`);
    check('This slide starts collapsed', await closed());
    await P(`document.querySelector('#slideSec .sec-toggle').click(); 1`);
    check('… and opens when its heading is clicked', !(await closed()));
    // Copy text: the slide's text in a box
    await P(`document.getElementById('btnCopyText').click(); 1`);
    const box = await P(`({ open: !document.getElementById('slideTextBox').hidden, label: document.getElementById('slideTextLabel').textContent, text: document.getElementById('slideText').value })`);
    check('Copy text opens a box with the slide’s text', box.open && /^Text on slide 1\.1/.test(box.label) && box.text.length > 20 && !/No text on this slide/.test(box.text), box.label + ' | ' + box.text.slice(0, 120).replace(/\n/g, ' ⏎ '));
    // The narration's closed captions arrive a moment later, and fill in the box (before the notes)
    const withCaptions = await waitP(`(t => /— Closed captions: Audio —\\n\\S/.test(t) && !/Loading the closed captions/.test(t) && t)(document.getElementById('slideText').value)`, 15000);
    check('… and the closed captions of its narration, before the notes', !!withCaptions && withCaptions.indexOf('— Closed captions: Audio —') < withCaptions.indexOf('— Transcript (notes) —'),
      (withCaptions || await P(`document.getElementById('slideText').value`)).replace(/\n/g, ' ⏎ ').slice(0, 200));
    box.text = withCaptions || box.text;
    const notesAt = box.text.indexOf('— Transcript (notes) —');
    check('… ending with the slide’s notes, under the tab’s name in the course (“Transcript”)', notesAt > 0 && /Welcome to the Team Member Saf/.test(box.text.slice(notesAt)), box.text.slice(Math.max(0, notesAt), notesAt + 120).replace(/\n/g, ' ⏎ '));
    await P(`document.getElementById('btnCopyAll').click(); 1`);
    await sleep(300);
    check('… and Copy all copies it', (await P(`document.getElementById('btnCopyAll').textContent`)) === 'Copied');
    if (slideSec) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
      const area = await P(`(() => { const r = document.getElementById('slideSec').getBoundingClientRect(); return { y: r.top + scrollY, h: r.height }; })()`);
      saveScreenshot('side-panel-this-slide.png', (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: area.y, width: 400, height: Math.min(area.h, 700), scale: 1 } }, panel)).result.data);
    }
    // Changes since an earlier version: a fresh browser has opened no earlier version, so it says how to
    // (it appears once the version is kept, after its closed captions are read)
    check('Changes since an earlier version starts collapsed, and says how to compare', !!(await waitP(`!document.getElementById('versSec').hidden && document.getElementById('versSec').classList.contains('collapsed') && !document.getElementById('versNone').hidden`, 30000)));
    await P(`document.getElementById('btnCloseText').click(); 1`);
    check('Close hides the text box', await P(`document.getElementById('slideTextBox').hidden`));

    // A screenshot of the panel at side-panel width, and of the seat time with how it's worked out
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    await P(`document.getElementById('compSeatHow').open = true; 1`);
    const sb = await P(`(() => { const a = document.getElementById('compSeat').previousElementSibling.getBoundingClientRect(), b = document.getElementById('compSeatHow').getBoundingClientRect(); return { y: a.top + scrollY - 4, h: b.bottom - a.top + 8 }; })()`);
    saveScreenshot('side-panel-seat-time.png', (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: sb.y, width: 400, height: sb.h, scale: 1 } }, panel)).result.data);
    await P(`document.getElementById('compSeatHow').open = false; 1`);
    saveScreenshot('side-panel.png', (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, panel)).result.data);

    // Developer mode off: the simple panel for a content reviewer
    await P(`document.getElementById('devMode').click(); 1`);
    check('turning Developer mode off shows the simple panel', !!(await waitP(`document.body.classList.contains('simple')`, 5000)));
    check('… without the notes under the options, or the sentences above and below them', !(await shown('slFreeNote')) && !(await shown('slNavNote')) && (await shown('slFree')) &&
      (await P(`[...document.querySelectorAll('.sl-intro, .sl-foot, #versSec .vers-note:not(#versNone)')].every(e => getComputedStyle(e).display === 'none')`)));
    check('… This slide shows just its text, ready to copy', (await shown('slideText')) && !(await shown('slideNav')) && !(await shown('btnCopyText')) && !(await shown('btnCloseText')) &&
      /^Text on slide /.test(await note('slideTextLabel')) && (await P(`document.getElementById('slideText').value.length`)) > 20, await note('slideTextLabel'));
    check('… Completion shows the status and seat time only', (await shown('compNow')) && (await shown('compSeat')) && !(await shown('compHow')) && !(await shown('compSeatHow')) && !(await shown('compHistory')));
    check('… Changes since an earlier version is still there', !(await P(`document.getElementById('versSec').hidden`)));
    check('… and the quiz answers start collapsed', await P(`document.getElementById('quizSec').classList.contains('collapsed') && !document.getElementById('quizSec').hidden`));
    saveScreenshot('side-panel-simple.png', (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, panel)).result.data);

    // Text size: A+ twice zooms the panel to 125% (saved), A− goes back down, and stops at the smallest size
    const zoom = () => P(`getComputedStyle(document.documentElement).zoom`);
    check('text size starts at 100%', String(await zoom()) === '1', await zoom());
    await P(`document.getElementById('btnBigger').click(); document.getElementById('btnBigger').click(); 1`);
    check('A+ twice makes the panel’s text 125%, and is saved', String(await zoom()) === '1.25' && (await P(`chrome.storage.local.get('textSize').then(r => r.textSize)`)) === 1.25, await zoom());
    saveScreenshot('side-panel-text-size.png', (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 400, height: 500, scale: 1 } }, panel)).result.data);
    for (let i = 0; i < 4; i++) await P(`document.getElementById('btnSmaller').click(); 1`);
    check('A− goes down to 90% and stops there', String(await zoom()) === '0.9' && (await P(`document.getElementById('btnSmaller').disabled`)), await zoom());
    await P(`document.getElementById('btnBigger').click(); 1`);
    check('… and back to 100%', String(await zoom()) === '1', await zoom());
    // (the rest of the test reads the Developer mode notes)
    await P(`document.getElementById('devMode').click(); 1`);
    await waitP(`!document.body.classList.contains('simple')`, 5000);

    // Turn them off: back to the published course
    await P(`for (const id of ['slFree', 'slAnswers']) document.getElementById(id).click(); 1`);
    const back = await waitP(`/"restricted"\\.$/.test(document.getElementById('slFreeNote').textContent.trim())`);
    check('turning the settings off reloads the published course', !!back, await note('slFreeNote'));
    check('the toolbar badge is off again', (await badge()) === '');

    // "Unlock all navigation": the options the course can use, in one save; a dash when only some are on.
    // Wait until the course has been checked (until then every option counts as available).
    await waitP(`!/Checking/.test(document.getElementById('slNavNote').textContent + document.getElementById('slUnhideNote').textContent)`);
    const all = () => P(`(() => { const a = document.getElementById('slAllNav'); return { checked: a.checked, mixed: a.indeterminate, disabled: a.disabled }; })()`);
    const saved = () => P(`chrome.storage.local.get('settings').then(r => r.settings)`);
    check('“Unlock all navigation” starts unticked', JSON.stringify(await all()) === '{"checked":false,"mixed":false,"disabled":false}', JSON.stringify(await all()));
    check('the seekbar option is unavailable here (already draggable)', await P(`document.getElementById('slSeek').disabled`));
    await P(`document.getElementById('slAllNav').click(); 1`);
    await sleep(1000);
    let s = await saved();
    check('ticking it turns on free navigation and Unlock Next/Prev, and leaves the unavailable seekbar and Add Next/Prev alone', s && s.freeNav && s.nav && !s.unhide && !s.seekbar && !s.answers, JSON.stringify(s));
    check('… and it shows ticked', JSON.stringify(await all()) === '{"checked":true,"mixed":false,"disabled":false}', JSON.stringify(await all()));
    const reloaded = await waitP(`/opened as "free"/.test(document.getElementById('slFreeNote').textContent) && /kept enabled/.test(document.getElementById('slNavNote').textContent)`);
    check('the course reloads with both on', !!reloaded, await note('slNavNote'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    saveScreenshot('side-panel-all-nav.png', (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 400, height: 480, scale: 1 } }, panel)).result.data);
    await P(`document.getElementById('slNav').click(); 1`);
    await sleep(500);
    check('turning one off shows a dash (some on)', JSON.stringify(await all()) === '{"checked":false,"mixed":true,"disabled":false}', JSON.stringify(await all()));
    await P(`document.getElementById('slAllNav').click(); 1`);
    await sleep(500);
    s = await saved();
    check('clicking the dash turns them all on again', s && s.freeNav && s.nav && !s.unhide && (await all()).checked, JSON.stringify(s));
    await P(`document.getElementById('slAllNav').click(); 1`);
    await sleep(500);
    s = await saved();
    check('unticking it turns them all off', s && !s.freeNav && !s.nav && !s.unhide && !s.seekbar, JSON.stringify(s));
    check('the course goes back to the published one', !!(await waitP(`/"restricted"\\.$/.test(document.getElementById('slFreeNote').textContent.trim())`)), await note('slFreeNote'));
  } catch (e) {
    check('test ran without errors', false, e && e.message);
  } finally {
    b.close();
    finish();
  }
})();
