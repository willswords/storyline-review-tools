// Every pre-fillable question type (multiple choice, multiple response, true/false, fill in the blank, numeric, hotspot),
// on a published Storyline course served locally with the extension's scripts injected. Each question is opened from the
// menu, checked for its filled-in answer, and submitted; Storyline's feedback must say it's correct.
// Package: "questionTypesPackage" in tests/courses.json (a .zip, or an unzipped folder).
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const { launch, reporter, sleep, saveScreenshot } = require('./lib/browser');
const { injection } = require('./lib/review');
const { courses } = require('./lib/courses');
const { check, finish } = reporter();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };

// The package's folder (unzipping a .zip into a temp folder first), and the story file in it
function packageFolder(src) {
  let dir = src, temp = null;
  if (/\.zip$/i.test(src)) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-pkg-'));
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${src.replace(/'/g, "''")}' -DestinationPath '${temp}'`], { stdio: 'ignore' });
    dir = temp;
  }
  const find = d => { for (const n of ['story.html', 'story_html5.html']) if (fs.existsSync(path.join(d, n))) return { root: d, story: n };
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const f = find(path.join(d, e.name)); if (f) return f; } return null; };
  const found = find(dir);
  if (!found) throw new Error('No story.html in ' + src);
  return Object.assign(found, { temp });
}

(async () => {
  const pkg = packageFolder(courses().questionTypesPackage);
  const server = http.createServer((req, res) => {
    const f = path.join(pkg.root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(pkg.root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const b = await launch({ browser: 'edge' });
  const { cdp } = b;
  try {
    const target = (await cdp.send('Target.getTargets')).result.targetInfos.find(t => t.type === 'page');
    const s = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).result.sessionId;
    const errors = [];
    cdp.on(m => {
      if (m.sessionId !== s) return;
      if (m.method === 'Page.javascriptDialogOpening') cdp.send('Page.handleJavaScriptDialog', { accept: true }, s);   // "no LMS" alerts
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push((d.url || '') + ' ' + ((d.exception && d.exception.description) || d.text)); }
    });
    const ev = expr => cdp.evaluate(expr, s);
    const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(expr); if (v) return v; } catch (e) {} await sleep(300); } return null; };
    const click = async selector => {
      const pt = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
      if (!pt) return false;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, s);
      return true;
    };
    await cdp.send('Page.enable', {}, s); await cdp.send('Runtime.enable', {}, s);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injection({ freeNav: true, seekbar: true, nav: true, answers: true }) }, s);
    await cdp.send('Page.navigate', { url: `http://localhost:${server.address().port}/${pkg.story}` }, s);
    const st = await waitFor(`(document.dispatchEvent(new Event('storyline-review-tools:get-state')),
      window.__srtState && window.__srtState.locks && window.__srtState.locks.checked && document.querySelectorAll('.cs-listitem[data-ref]').length > 1 ? window.__srtState : null)`, 60000);
    check('the course loads with the hook', !!st);
    if (!st || !st.quiz) { check('the course has quiz questions', false); return; }
    const qs = st.quiz.questions, can = qs.filter(q => q.prefill);
    console.log('   questions: ' + qs.map(q => q.type + (q.prefill ? ' (' + q.prefill.how + ')' : '')).join(', '));
    for (const type of ['fillin', 'numeric', 'hotspot']) if (qs.some(q => q.type === type)) check(`${type} can be pre-filled`, can.some(q => q.type === type));
    await sleep(1500);
    for (const q of can) {
      const item = `.cs-listitem[data-ref$=".${q.slideId}"]`;
      if (await ev(`document.querySelector('${item}').getBoundingClientRect().left < 0`)) { await click('#hamburger'); await sleep(800); }
      await click(item);
      await sleep(3000);
      let filled;
      if (q.prefill.how === 'select') {
        filled = await ev(`(() => { const ids = ${JSON.stringify(q.apply.checked)}; const all = [...document.querySelectorAll('input.acc-radio, input.acc-checkbox')];
          return { right: ids.every(i => { const e = document.getElementById('acc-' + i); return e && e.checked; }), others: all.filter(e => e.checked && !ids.includes(e.id.slice(4))).length }; })()`);
        filled.ok = filled.right && filled.others === 0;
      } else if (q.prefill.how === 'type') {
        filled = await ev(`(() => { const i = [...document.querySelectorAll('input, textarea')].filter(e => !['radio', 'checkbox', 'range', 'button'].includes(e.type)).find(e => e.getBoundingClientRect().width > 100); return { value: i ? i.value : null }; })()`);
        filled.ok = filled.value === q.prefill.value;
      } else filled = { ok: true, how: 'a click recorded on the hotspot; judged by the feedback' };
      saveScreenshot(`question-${q.type}.png`, (await cdp.send('Page.captureScreenshot', { format: 'png' }, s)).result.data);
      await click('#submit');
      await sleep(2500);
      // The words on the feedback layer
      const feedback = await ev(`[...document.querySelectorAll('.slide-layer, [data-model-id]')].filter(l => l.getBoundingClientRect().width && getComputedStyle(l).visibility !== 'hidden' && getComputedStyle(l).display !== 'none')
        .map(l => l.innerText || '').join(' ').replace(/\\s+/g, ' ')`);
      const verdict = /\bincorrect\b/i.test(feedback) ? 'incorrect' : /\bcorrect\b/i.test(feedback) ? 'correct' : 'unknown';
      check(`${q.type}: opens filled in, and Storyline scores it correct`, filled.ok && verdict === 'correct', JSON.stringify({ filled, verdict }));
      const cont = await ev(`(() => { const b = [...document.querySelectorAll('.acc-button, button')].find(b => /^continue$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()) && b.getBoundingClientRect().width); return b ? '#' + b.id : null; })()`);
      if (cont) { await click(cont); await sleep(1500); }
    }
    check('no errors from the extension’s scripts', !errors.some(e => /storylineReview|core\.js|hook\.js/i.test(e)), errors.filter(e => /storylineReview/i.test(e)).slice(0, 2).join(' | ') || 'none');
  } finally {
    b.close(); server.close();
    if (pkg.temp) try { fs.rmSync(pkg.temp, { recursive: true, force: true }); } catch (e) {}
    finish();
  }
})().catch(e => { console.error(e); process.exit(1); });
