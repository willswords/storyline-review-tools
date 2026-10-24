// Run every test, one after another, and summarise.
// Usage: node tests/run-all.js            (or name some: node tests/run-all.js navigation answers)
const { spawnSync } = require('child_process');
const path = require('path');
const ALL = ['navigation', 'answers', 'question-types', 'extension'];
const pick = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const results = [];
for (const name of pick) {
  console.log(`\n=== ${name}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, `test-${name}.js`)], { stdio: 'inherit' });
  results.push({ name, ok: r.status === 0, secs: Math.round((Date.now() - t0) / 1000) });
}
console.log('\n=== Summary');
for (const r of results) console.log(`${r.ok ? 'passed' : 'FAILED'}  ${r.name}  (${r.secs} s)`);
process.exit(results.every(r => r.ok) ? 0 : 1);
