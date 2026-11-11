// A published Storyline course (a .zip, or an unzipped folder) served from a local web server, for the tests
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
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

// Serve it on a free port: { url (of the story file), close() }
async function serveCourse(src) {
  const pkg = packageFolder(src);
  const server = http.createServer((req, res) => {
    const f = path.join(pkg.root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(pkg.root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}/${pkg.story}`,
    port: server.address().port,
    close: () => { server.close(); if (pkg.temp) try { fs.rmSync(pkg.temp, { recursive: true, force: true }); } catch (e) {} }
  };
}

module.exports = { packageFolder, serveCourse };
