# Changelog

## 1.6.0 (2026-11-05)

- **Changes since an earlier version**, a new side panel section (starts collapsed): for a course republished to Review, the slides added, removed, moved or renamed, and the text and notes changed on each, shown as “old → new”. Pick the version to compare with; by default it's the latest one published before the version showing. Each slide in the list is a link that goes straight to it, even when the menu is restricted (through the player's `requestSlideForReview`, which Review uses for comments, or in older players the request Next makes). Slides are matched by Storyline's slide IDs. Images, media, triggers and layout aren't compared.
- Each version's text is kept in the browser when it's opened (the most recent 30 versions, in the storage of Review's course pages), since Review doesn't share its list of versions with the course. Nothing is sent anywhere; the privacy policy says so.
- **Copy text includes closed captions**: the captions of the slide's audio and video (from each clip's captions file, listed in `data.js` `assetLib`), one caption per line, after the slide's text and before its notes. Each clip is labelled ("Closed captions: Audio", "Closed captions: Video “Media1.mp4”"), with its layer if it isn't on the base layer.
- **Tests:** `test-versions.js` uses Review's own version menu on a course with four versions; the extension test checks the new section's starting message, and the captions in Copy text.

## 1.5.0 (2026-11-04)

- **Copy text**, in This slide's heading: a box with all the text on the slide you're on, layer by layer, in reading order, to select part of and paste into a Review comment (or **Copy all**). Line breaks inside a paragraph are kept. The slide's notes (the player's Notes tab, from `notesData` in `frame.js`) come last, under the tab's name in the course, such as "Transcript".

## 1.2.0 (2026-11-04)

- **This slide**, a new side panel section that explains why you can or can't move on. For the slide you're on, it shows whether Next and Prev are available, greyed out or not showing right now, and why: turned off in the slide's Player features, or triggers that disable, enable, hide or show them, each with when it runs and what it waits for (for example "Disabled as the slide appears, if the timeline hasn't played to the end yet"; "Shown and enabled when “Tab A” is visited…"). It also shows where Next and Prev go, the slide's own buttons that go to other slides, the current values of variables the triggers check, and which option gets past a lock. It starts collapsed, so a new user isn't shown everything at once; once opened, it stays open.
- **Estimated seat time**, in the Completion section, for LMS catalogue entries: slide timelines, plus reading time for slides whose text takes longer to read than their timeline (200 words a minute), with layers as "up to" and question bank draws at the bank's average. "How it's worked out" shows each part, and says how many questions' answering time isn't included.
- **The Next/Prev lock count leaves out Storyline's own trigger** that disables Prev on the first slide you open (it's on every slide, so it made courses look far more locked than they are).
- **Add Next/Prev buttons where turned off is no longer part of Unlock all navigation.** It adds buttons the course doesn't have, rather than unlocking ones it has, so it now sits on its own below the group and is turned on separately.
- **Unlock all navigation** no longer shows a dash, or turns on options the course doesn't need, while a reloaded course is still being checked.
- **Tests:** the navigation test checks This slide on two courses (a timeline lock; a slide with Next turned off and one that greys it out until its timeline ends); the extension test checks the section in the side panel, and the seat time.

## 1.1.1 (2026-11-02)

- **Add Next/Prev buttons where turned off**, a new option next to Unlock Next/Prev buttons. Unlock keeps buttons enabled that triggers disable (greyed out); Add Next/Prev buttons where turned off shows buttons that a slide's Player features leave out (a control layout in `frame.js` with `"previous": false` or `"next": false`), question slides included, where Next appears beside Submit. Those slides are published without a Next or Prev trigger, so they get Storyline's usual ones: Next goes to the next slide in the menu, Prev goes back. The panel counts them, for example "42 slide(s) turn off Next/Prev in their Player features". Unlock all navigation includes it.
- **Tests:** the navigation test checks a course whose slides hide Next/Prev; the extension test waits for the slide check before using Unlock all navigation.

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
