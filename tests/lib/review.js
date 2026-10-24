// An Articulate Review course in headless Edge, with the extension's core.js and hook.js injected into the course frame
// before it runs (where the content script runs), and the given settings in the frame's localStorage (as bridge.js
// would put them). Gives helpers to evaluate and click in the course frame, and to read the hook's state.
const fs = require('fs'), path = require('path');
const { launch, sleep, saveScreenshot } = require('./browser');
const SRC = path.join(__dirname, '..', '..', 'src');
const COURSE_FRAME = /articulateusercontent\.com\/review\/items\/[^/]+\/story/;

// The scripts the extension puts in the course frame, plus a listener that keeps the hook's latest state on window
function injection(settings) {
  return `localStorage.setItem('storylineReviewTools.settings', ${JSON.stringify(JSON.stringify(settings))});\n` +
    fs.readFileSync(path.join(SRC, 'core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(SRC, 'hook.js'), 'utf8') +
    `\ndocument.addEventListener('storyline-review-tools:state', e => { window.__srtState = JSON.parse(e.detail); });`;
}

async function openCourse(url, settings) {
  const b = await launch({ browser: 'edge' });
  const { cdp } = b;
  const errors = [];
  const pageTarget = (await cdp.send('Target.getTargets')).result.targetInfos.find(t => t.type === 'page');
  const page = (await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })).result.sessionId;
  const inject = injection(settings);
  cdp.on(async m => {
    if (m.method === 'Runtime.exceptionThrown' && m.sessionId && m.sessionId !== page) {
      const d = m.params.exceptionDetails; errors.push((d.url || '') + ' ' + ((d.exception && d.exception.description) || d.text));
    }
    // (Only new frames paused before they start; sessions the test opens itself to look at a frame are left alone)
    if (m.method === 'Target.attachedToTarget' && m.params.waitingForDebugger) {
      // Every frame in its own process: add the scripts (only the course frame runs them, as the manifest's matches do), then let it start
      const s = m.params.sessionId;
      await cdp.send('Page.enable', {}, s);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.host === 'articulateusercontent.com' && !/analytics-frame/.test(location.pathname)) {\n${inject}\n}` }, s);
      await cdp.send('Runtime.enable', {}, s);
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s);
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, s);
    }
  });
  await cdp.send('Page.enable', {}, page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page);
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, page);
  await cdp.send('Page.navigate', { url }, page);

  // The course frame. Review can replace it after the first load, so it's looked up again whenever its session goes.
  let course = null, courseTarget = null;
  async function findCourse() {
    for (let i = 0; i < 160; i++) {
      const ft = (await cdp.send('Target.getTargets')).result.targetInfos.find(t => t.type === 'iframe' && COURSE_FRAME.test(t.url));
      if (ft) {
        if (ft.targetId !== courseTarget || !course) { courseTarget = ft.targetId; course = (await cdp.send('Target.attachToTarget', { targetId: ft.targetId, flatten: true })).result.sessionId; }
        return;
      }
      await sleep(250);
    }
    throw new Error('The course frame didn’t appear (is the Review link still valid?)');
  }
  await findCourse();
  const ev = async (expr, retried) => {
    try { return await cdp.evaluate(expr, course); }
    catch (e) {
      if (!retried && e.cdp && /Session with given id not found/.test(e.cdp.message)) { course = null; await findCourse(); return ev(expr, true); }
      throw e;
    }
  };
  const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(expr); if (v) return v; } catch (e) {} await sleep(300); } return null; };
  // The hook's state (what the course locks, the answer key, what was changed)
  const state = async () => { await ev(`document.dispatchEvent(new Event('storyline-review-tools:get-state'))`); await sleep(200); return ev('window.__srtState || null'); };
  // Wait until the hook has read every slide file
  const ready = (ms = 60000) => waitFor(`(document.dispatchEvent(new Event('storyline-review-tools:get-state')),
    window.__srtState && window.__srtState.player && window.__srtState.locks && window.__srtState.locks.checked && document.querySelector('#outline-content li') ? window.__srtState : null)`, ms);

  // Review's Osano cookie notice sits over the course's lower-left corner and takes clicks meant for the course menu.
  // In this throwaway profile it's hidden: no cookie choice is made, it just isn't drawn.
  await cdp.evaluate(`(() => { const st = document.createElement('style'); st.textContent = '.osano-cm-window { display: none !important; }'; document.head.appendChild(st); })()`, page);

  // A real mouse click on an element in the course frame (scrolled into view; the frame's position comes from the top page)
  const click = async selector => {
    const fr = await cdp.evaluate(`(() => { const b = document.querySelector('iframe').getBoundingClientRect(); return { x: b.left, y: b.top }; })()`, page);
    const pt = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!pt) return false;
    const x = fr.x + pt.x, y = fr.y + pt.y;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, page);
    return true;
  };
  // Go to a slide through the course menu: open the sidebar, expand the slide's scene, click the slide
  const goToSlide = async slideId => {
    const item = `#outline-content .cs-listitem[data-ref$=".${slideId}"]`;
    if (!(await ev(`!!document.querySelector('${item}')`))) return false;
    if (await ev(`document.querySelector('#outline-content').getBoundingClientRect().left < 0`)) await click('#hamburger');
    await waitFor(`document.querySelector('#outline-content').getBoundingClientRect().left >= 0`, 5000);
    // A collapsed scene opens with its arrow (clicking the scene's name would go to the scene)
    const scene = await ev(`(() => { const s = document.querySelector('${item}').closest('ul').closest('li.item-collapsed'); if (!s) return null; const h = s.querySelector('.cs-listitem'); h.setAttribute('data-srt-scene', '1'); return true; })()`);
    if (scene) { await click('[data-srt-scene] .carrot'); await sleep(800); }
    await sleep(500);
    return click(item);
  };
  const shot = async name => saveScreenshot(name, (await cdp.send('Page.captureScreenshot', { format: 'png' }, page)).result.data);
  return { ev, waitFor, state, ready, click, goToSlide, shot, errors, close: b.close };
}

module.exports = { openCourse, injection };
