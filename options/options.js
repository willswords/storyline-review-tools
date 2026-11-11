// Storyline Review Tools options: the sites the extension works on besides Articulate Review.
// Each is a match pattern, saved in chrome.storage.local ("extraSites"); Chrome asks the user to allow each one
// (an optional host permission), and background.js runs the extension's scripts on the ones allowed.
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const BUILTIN = 'https://articulateusercontent.com/review/*';

// A match pattern from what was typed: "lms.example.com" → "https://lms.example.com/*". Returns { pattern } or { error }.
function toPattern(text) {
  let t = String(text || '').trim();
  if (!t) return { error: 'Type a web address first.' };
  if (!/^[a-z*]+:\/\//i.test(t)) t = 'https://' + t;
  if (!/^[a-z*]+:\/\/[^/]+\//i.test(t)) t += '/*';
  const m = /^(https?|\*):\/\/([^/]+)(\/.*)$/i.exec(t);
  if (!m) return { error: 'Use a web address starting with https:// or http://.' };
  // (Chrome's patterns have no port: a site's pattern covers all its ports)
  const port = /:\d+$/.test(m[2]), host = m[2].toLowerCase().replace(/:\d+$/, '');
  if (host === '*' || /^\*\.[^.]+$/.test(host)) return { error: 'That would cover every site, or a whole domain ending. Name the site, such as lms.example.com or *.example.com.' };
  if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) return { error: '“' + m[2] + '” isn’t a site name. A * can only start it, as in *.example.com.' };
  return { pattern: m[1].toLowerCase() + '://' + host + m[3], port };
}

const getSites = async () => { const r = await chrome.storage.local.get('extraSites'); return Array.isArray(r.extraSites) ? r.extraSites : []; };
const setSites = list => chrome.storage.local.set({ extraSites: list });
const allowed = p => chrome.permissions.contains({ origins: [p] }).catch(() => false);

async function render() {
  const list = $('sites');
  const rows = ['<li class="site builtin"><code>' + esc(BUILTIN) + '</code><span class="state ok">Articulate Review, always on</span></li>'];
  for (const p of await getSites()) {
    const ok = await allowed(p);
    rows.push('<li class="site"><code>' + esc(p) + '</code>' +
      (ok ? '<span class="state ok">Allowed</span>' : '<span class="state warn">Not allowed in Chrome</span><button class="small allow" data-p="' + esc(p) + '">Allow</button>') +
      '<button class="small remove" data-p="' + esc(p) + '" aria-label="Remove ' + esc(p) + '">Remove</button></li>');
  }
  list.innerHTML = rows.join('');
}
const say = (text, cls) => { $('msg').textContent = text; $('msg').className = 'msg ' + (cls || ''); };

// Add: ask Chrome first (it needs the click that started this), then save
$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const r = toPattern($('pattern').value);
  if (r.error) return say(r.error, 'err');
  const p = r.pattern;
  if (p === BUILTIN) return say('Articulate Review is always on.', 'ok');
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [p] }); } catch (err) { return say('Chrome didn’t accept that address: ' + err.message, 'err'); }
  const sites = await getSites();
  if (!sites.includes(p)) await setSites(sites.concat(p));
  $('pattern').value = '';
  say(granted ? 'Added ' + p + (r.port ? ' (any port)' : '') + '. Reload any course already open there.' :'Added ' + p + ', but Chrome wasn’t allowed to give access to it. Click Allow to try again.', granted ? 'ok' : 'err');
  render();
});
$('sites').addEventListener('click', async e => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  const p = b.dataset.p;
  if (b.classList.contains('allow')) {
    const ok = await chrome.permissions.request({ origins: [p] }).catch(() => false);
    say(ok ? 'Allowed ' + p + '.' : 'Not allowed.', ok ? 'ok' : 'err');
  } else {
    await setSites((await getSites()).filter(x => x !== p));
    // (access that came with the extension itself stays, and so does reviewmyelearning.com's while its switch is on)
    const keep = p === RMEL && (await chrome.storage.local.get('reviewMyElearning')).reviewMyElearning;
    if (!keep) await chrome.permissions.remove({ origins: [p] }).catch(() => {});
    say('Removed ' + p + '.', 'ok');
  }
  render();
});
// Side panel sections: all shown unless turned off here ("panelSections": { <section id>: false })
const sectionBoxes = [...document.querySelectorAll('#sections input[data-sec]')];
async function renderSections() {
  const { panelSections } = await chrome.storage.local.get('panelSections');
  for (const box of sectionBoxes) box.checked = !(panelSections && panelSections[box.dataset.sec] === false);
}
for (const box of sectionBoxes) {
  box.addEventListener('change', async () => {
    const { panelSections } = await chrome.storage.local.get('panelSections');
    await chrome.storage.local.set({ panelSections: Object.assign({}, panelSections, { [box.dataset.sec]: box.checked }) });
  });
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.panelSections) renderSections(); });
renderSections();

// Review sites: courses shared for review on reviewmyelearning.com, a setting of its own ("reviewMyElearning": true),
// separate from the added sites below. Turning it on asks Chrome for access; turning it off gives the access back
// (unless the same address is also an added site).
const RMEL = 'https://reviewmyelearning.com/content/*';
async function renderRmel() {
  const { reviewMyElearning } = await chrome.storage.local.get('reviewMyElearning');
  $('rmel').checked = !!reviewMyElearning;
  const missing = !!reviewMyElearning && !(await allowed(RMEL));
  $('rmelState').innerHTML = '(<code>' + esc(RMEL) + '</code>)' + (missing ? ' <span class="state warn">Not allowed in Chrome: turn it off and on to ask again</span>' : '');
}
$('rmel').addEventListener('change', async e => {
  const on = e.target.checked, msg = (t, cls) => { $('rmelMsg').textContent = t; $('rmelMsg').className = 'msg ' + (cls || ''); };
  if (on) {
    // (asked first, while Chrome still counts the click)
    const ok = await chrome.permissions.request({ origins: [RMEL] }).catch(() => false);
    if (!ok) { e.target.checked = false; return msg('Not turned on: Chrome wasn’t allowed to give access to reviewmyelearning.com.', 'err'); }
    await chrome.storage.local.set({ reviewMyElearning: true });
    msg('On. Reload any course already open on reviewmyelearning.com.', 'ok');
  } else {
    await chrome.storage.local.set({ reviewMyElearning: false });
    if (!(await getSites()).includes(RMEL)) await chrome.permissions.remove({ origins: [RMEL] }).catch(() => {});
    msg('Off.', 'ok');
  }
  renderRmel();
});
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.reviewMyElearning) renderRmel(); });
chrome.permissions.onAdded.addListener(renderRmel);
chrome.permissions.onRemoved.addListener(renderRmel);
renderRmel();

// Sites is an administrator's setting, so it's hidden until asked for: Ctrl+click the page's heading, or press
// Ctrl+Shift+S (options.html#sites also opens with it showing). Chrome doesn't tell an extension which keys were held
// when Options was chosen from its menu, so the page asks instead.
function showSites() {
  if (!$('sitesPart').hidden) return;
  $('sitesPart').hidden = false;
  $('pattern').focus();
}
$('title').addEventListener('click', e => { if (e.ctrlKey || e.metaKey) showSites(); });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); showSites(); } });
if (location.hash === '#sites') showSites();

chrome.permissions.onAdded.addListener(render);
chrome.permissions.onRemoved.addListener(render);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.extraSites) render(); });
render();
