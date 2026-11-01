# Changelog

## 1.1.0 (2026-10-31)

- **Completion**, a new side panel section, to check a course will complete correctly once it's published for an LMS:
  - **How this course completes:** the course's Tracking settings (slides viewed, quiz result, Complete Course trigger), the slides where each can be met and when (for example "slide 1.3, when the timeline starts"), and the status words it reports. Warns about setups that never complete, and about Complete Course triggers the player ignores because tracking doesn't use triggers.
  - **The status as you play:** what the course has reported in this session, the score, and a history (including a retried quiz setting the status back to Incomplete).
  - **A message over the course** when it's marked passed, complete or failed, with a flash (green, or red for failed), like the SCORM Test LMS's.
  - **LMS details**, closed until opened, in the message and the panel: what SCORM 1.2, SCORM 2004 and xAPI would get.
  - Follows the Storyline player's own status events and the rules of its SCORM code, so the moments match a published course. Always on; changes nothing in the course.
- **Unlock all navigation:** one checkbox over the three navigation options (free navigation, seekbar, Next/Prev). It turns on the ones the course has something to unlock, in one save, so the course reloads once; it shows a dash when only some are on.
- **Changing options quickly** always reloads the course with the latest settings. The guard against a reload loop (3 reloads in 20 seconds) now only counts reloads for the same settings, so it no longer blocks real changes.
- **`pack.ps1`** builds the store zip with only the extension's own files. The zip is no longer kept in git: the 1.0.0 zip in the repository had been made from the whole folder, including `.git`, the tests, test screenshots and `tests/courses.json`.
- **Tests:** `test-completion.js` plays a course for each tracking option (trigger, slides viewed, and a quiz failed, retried and passed); the extension test checks the new section and Unlock all navigation.

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
