// The test courses: Review links and a local quiz package, from tests/courses.json (not in git; see courses.example.json).
// Anyone with a Review link can view the course, so the links are kept out of the repository.
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'courses.json');

function courses() {
  if (!fs.existsSync(FILE)) {
    console.error('tests/courses.json is missing. Copy tests/courses.example.json to tests/courses.json and fill in your Review links.');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
module.exports = { courses };
