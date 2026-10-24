# Changelog

## 1.0.0 (2026-10-24)

First version, based on the Storyline testing options of the [SCORM Test LMS](https://github.com/willswords/scorm-test-lms).

- **Runs on Articulate Review.** Works in the frame Review shows Storyline courses in (`articulateusercontent.com/review/…`), and changes the course's data as it loads in this browser only.
- **Free navigation (menu):** the menu opens as "free". Reads the setting from current Storyline output (`controlOptions.menuOptions`) and older output (top-level `menuOptions`).
- **Unlock seekbar:** a read-only seekbar opens as draggable.
- **Unlock Next/Prev buttons:** triggers that disable Next, Prev or the swipe gestures are kept enabled, in slide files and in slides embedded in `data.js`.
- **Pre-select correct quiz answers:** multiple choice, multiple response, true/false, fill in the blank, numeric and hotspot questions open with the correct answer filled in.
- **Side panel**, opened from the toolbar button:
  - the options, with notes on what the course locks and what's changed;
  - the course's quiz answers, as the course scores them, with each question's slide title so copies of a question (such as "1st Attempt" and "2nd Attempt" slides) can be told apart.
- Changing an option reloads the course. The options apply to every Review course until turned off, and the toolbar button shows **ON** while any is on.
- **Tests** (`tests/`): navigation, quiz answers and every pre-fillable question type on real courses in headless Edge, and the whole extension loaded into headless Chrome.
