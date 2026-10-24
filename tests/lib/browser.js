// Headless Edge/Chrome for the tests: start one with a fresh profile, talk to it over the DevTools protocol, and clean up.
// Lessons built in:
//   - A fresh port each time. Edge leaves processes behind, and a leftover one on a reused port answers for the wrong browser.
//   - Stop every process using the profile folder when done (killing the started process isn't enough on Windows).
//   - A short profile path (in the system temp folder). Chrome's extension storage files inside a long path go past
//     Windows' 260-character limit, and chrome.storage then fails.
//   - Branded Edge and Chrome ignore --load-extension. An unpacked extension is loaded through the DevTools pipe
//     (Extensions.loadUnpacked), which works in Chrome; Edge relaunches itself and drops the pipe.
//   - Headless Chrome on Windows can crash about 20 seconds in when its updater can't connect, so it's kept from trying.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');

const BROWSERS = {
  edge: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'],
  chrome: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')]
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const OUTPUT = path.join(__dirname, '..', 'output');

function findBrowser(name) {
  const env = process.env[name.toUpperCase() + '_PATH'];
  const found = (env ? [env] : []).concat(BROWSERS[name]).find(p => fs.existsSync(p));
  if (!found) throw new Error(`${name} not found; set ${name.toUpperCase()}_PATH to its .exe`);
  return found;
}

// A DevTools connection: send(method, params, sessionId) and on(event handler)
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0; const pending = new Map(); const handlers = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    for (const h of handlers) h(m);
  });
  const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  // Evaluate in a session (or the target the connection is on) and return the value; throws on errors
  const evaluate = async (expr, sessionId) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (!r.result) { const err = new Error('DevTools: ' + JSON.stringify(r.error)); err.cdp = r.error; throw err; }
    if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  return { send, evaluate, on: h => handlers.push(h), close: () => { try { ws.close(); } catch (e) {} } };
}

// Start a headless browser. With extension: <folder>, it's loaded unpacked (Chrome) and its id returned.
async function launch({ browser = 'edge', extension = null, width = 1440, height = 900 } = {}) {
  const exe = findBrowser(browser);
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-'));
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
    '--disable-component-update', '--disable-background-networking', '--disable-gpu'];
  if (extension) args.push('--remote-debugging-pipe', '--enable-unsafe-extension-debugging');
  args.push('about:blank');
  const proc = spawn(exe, args, { stdio: extension ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore' });
  let exited = null;
  proc.on('exit', code => { exited = code; });
  const keepAlive = setInterval(() => {}, 1000);   // the pipe alone doesn't keep Node running if the browser goes

  let extensionId = null;
  if (extension) {
    let buf = '';
    const reply = new Promise(r => proc.stdio[4].on('data', d => { buf += d; const i = buf.indexOf('\0'); if (i >= 0) r(JSON.parse(buf.slice(0, i))); }));
    proc.stdio[3].write(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: path.resolve(extension) } }) + '\0');
    const r = await Promise.race([reply, sleep(20000).then(() => ({ error: { message: 'no reply (the browser may not support loading extensions over the pipe)' } }))]);
    if (!r.result) throw new Error('Loading the extension failed: ' + JSON.stringify(r.error));
    extensionId = r.result.id;
  }
  let version = null;
  for (let i = 0; i < 80 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { await sleep(250); } }
  if (!version) throw new Error(`${browser} didn't start` + (exited !== null ? ` (exit code ${exited})` : ''));
  const cdp = await connect(version.webSocketDebuggerUrl);

  const close = () => {
    clearInterval(keepAlive);
    cdp.close();
    try { proc.kill(); } catch (e) {}
    try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'kill-browser.ps1'), path.basename(profile)], { stdio: 'ignore' }); } catch (e) {}
    // The profile can stay locked for a moment after the browser stops
    for (let i = 0; i < 5; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (e) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); } }
  };
  return { cdp, port, profile, extensionId, close, alive: () => exited === null };
}

// Screenshots go to tests/output (ignored by git)
function saveScreenshot(name, base64) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const file = path.join(OUTPUT, name);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

// PASS/FAIL lines and a count, for each test script
function reporter() {
  let failed = 0;
  const check = (name, pass, detail) => { if (!pass) failed++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && detail !== '' ? '  — ' + detail : '')); };
  const finish = () => { console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0); };
  return { check, finish, failed: () => failed };
}

module.exports = { launch, connect, sleep, saveScreenshot, reporter, OUTPUT };
