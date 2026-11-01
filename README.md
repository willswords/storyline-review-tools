# Storyline Review Tools

A Chrome and Edge extension for reviewing Articulate Storyline courses on **Articulate Review** (`360.articulate.com/review/…`) faster. It brings the Storyline testing options of the [SCORM Test LMS](https://github.com/willswords/scorm-test-lms) to Review:

| Option | What it does |
|---|---|
| **Free navigation (menu)** | Opens the course with the menu set to "free", so you can jump to any slide, including ones not viewed yet. |
| **Unlock seekbar** | Makes the seekbar draggable, if the course makes it read-only. |
| **Unlock Next/Prev buttons** | Keeps Next and Prev enabled on slides whose triggers disable them (for example "disable Next until the timeline ends"). |
| **Pre-select correct quiz answers** | Opens question slides with the correct answer already filled in, so you only press Submit. |

The side panel also lists the course's **quiz answers**, as the course scores them, and shows **when the course completes**: what its tracking needs, and the status it reports as you play it (see [Completion](#completion)).

Nothing is changed on Review. The extension changes what your own browser loads as the course starts, and only while an option is on. Other reviewers, and the published course, aren't affected.

## Installing

The extension isn't in the Chrome Web Store or Edge Add-ons, so it's installed from this folder ("unpacked"):

1. Open the extensions page: `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Turn on **Developer mode** (top right in Chrome; left side in Edge).
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Optional: pin it to the toolbar (the puzzle-piece button, then the pin next to **Storyline Review Tools**).

After updating the files, click the reload button on the extension's card, then reload any open Review tab.

## Using it

1. Open a Storyline course on Articulate Review.
2. Click the **Storyline Review Tools** button (a padlock) in the toolbar. The side panel opens beside the page.
3. Tick the options you want. The course reloads with them on.

The panel shows what the course in the current tab does, and what's being changed. For example:

```
Free navigation (menu)
  Menu navigation is "restricted" → opened as "free".
Unlock Next/Prev buttons
  63 trigger(s) in 21 slide(s) disable Next/Prev → kept enabled.
Pre-select correct quiz answers
  All 10 question(s) open with the correct answer filled in; you still press Submit.
```

An option is greyed out when the course has nothing for it to unlock.

**Unlock all navigation** turns on (or off) all three navigation options at once, skipping any that are greyed out, and reloads the course once. It shows a dash when only some of them are on; clicking it then turns them all on.

The options apply to **every Review course you open** until you turn them off. While any is on, the toolbar button shows **ON**. Turn them off before reviewing a course as a learner would see it.

### Quiz answers

**Pre-select correct quiz answers** fills in:

- **Multiple choice, multiple response and true/false:** the correct choices are selected.
- **Fill in the blank:** one of the accepted answers is typed in.
- **Numeric:** a number that's scored correct is typed in.
- **Hotspot:** a click is recorded in the centre of the correct area.

Other question types (drag and drop, matching, sequence, word bank and so on) are answered by hand. The **Quiz answers** list in the panel shows their correct answers.

### Completion

Use this to check that a course will complete correctly once it's published for an LMS (SCORM 1.2, SCORM 2004 or xAPI), before you publish it. It's always on and changes nothing in the course.

**How this course completes** (in the panel) reads the course's Tracking settings and says where each can be met:

```
Complete when any one is met (the first one met gives the status):
  • Reach a Complete Course trigger
      Slide 1.20 "Results Slide", when the timeline starts (on a layer)
  • Finish the quiz "…" (pass mark 0%, so any score passes)
      Slide 1.20 "Results Slide", when the timeline starts
Reports Passed when met, and Failed when the quiz is failed.
```

It warns about setups that never complete, such as tracking by Complete Course trigger with no slide that has one, a quiz no results slide submits, more slides to view than the course counts, or Complete Course triggers that the player ignores because tracking doesn't use triggers.

**As you play the course**, the panel shows the status it has reported, and when the status changes a message flashes over the course (like the SCORM Test LMS's), for example:

```
✓ Marked passed
  From the quiz result on slide 1.3 "Quiz Results", 0:42 into the session, score 100%.
  ▸ LMS details
```

**LMS details**, closed until you open it (in the message and in the panel), shows what the LMS would get, for example:

```
SCORM 1.2   cmi.core.lesson_status = "passed"
SCORM 2004  cmi.success_status = "passed", cmi.completion_status = "completed"
xAPI        a "passed" statement
```

A failed quiz shows **Marked failed** in red. Retrying the quiz sets the status back to Incomplete, and the next result is reported again.

The status comes from the Storyline player itself: on Review it works out the course's status just as it does in an LMS, but has no LMS to send it to. The extension follows the player's own status events and applies the same rules as the player's SCORM code, so it shows the moments a published course would report, and what it would send. Nothing is sent anywhere. Reloading the course starts again.

The words "Passed", "Completed", "Failed" and "Incomplete" come from the course's **Reporting** setting as published to Review. Check it's the same under **Publish › LMS › Reporting and Tracking** when you publish for an LMS.

## How it works

A Storyline course loads its content as data files (`html5/data/js/frame.js`, `data.js`, and one file per slide), each handed to the player through a function called `globalProvideData`. On Review, the course runs in a frame from `articulateusercontent.com`.

The extension runs a small script in that frame before the Storyline player starts. It wraps `globalProvideData`, and changes each file's content as it arrives:

- `frame.js`: the menu's `flow` setting becomes `"free"`; the seekbar's `readonly` settings become `false`.
- Slide files: triggers that disable Next, Prev or the seekbar (`enable_window_control` with `"enable": false`) become `"enable": true`.
- Question slides: the correct choices start selected, a hotspot's click starts recorded. Fill-in and numeric answers are set through the player's own `SetVar`.

To build the answer key and the counts in the panel, it reads the course's slide files (the same files the course loads anyway). Nothing is sent anywhere else.

For completion, it reads `data.js`'s `scorings` (the Tracking settings) and finds the slides with Complete Course triggers (`set_course_status`) and results slides (`setquizcomplete`). While the course plays, it listens to the player's event bus (`DS.pubSub`: `status:updated`, `course:completed`, `course:manuallyCompleted`, `course:viewed`, `quiz:retried`) and asks the player for the status (`DS.presentation.scorings().getStatus()`), sending a status once, as the player's SCORM code does.

[STORYLINE-NAVIGATION.md](https://github.com/willswords/scorm-test-lms/blob/main/STORYLINE-NAVIGATION.md) in the SCORM Test LMS explains Storyline's navigation locks in detail.

## What it doesn't unlock

- **Slides whose Next has no destination.** Some slides are designed to move on through their own buttons. Use free navigation to jump past them from the menu.
- **Hidden buttons**, and on-slide buttons, tabs or layers that wait for a variable. They're part of the slide, not the player's controls.
- **Courses that aren't on Articulate Review.** It only runs on Review's course frames.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | The extension's definition (Manifest V3). |
| `src/core.js` | The Storyline logic: reading settings and locks, building the answer key, filling in answers, reading the tracking settings. Shared with the side panel. |
| `src/hook.js` | Runs in the course frame before the player: makes the changes, follows the course's completion status, and shows the completion message. |
| `src/bridge.js` | Connects the course frame to the extension: passes the settings in, reloads the course when they change, reports to the side panel. |
| `src/background.js` | Opens the side panel from the toolbar button, and shows **ON** on it. |
| `sidepanel/` | The side panel. |
| `icons/` | The toolbar icon. |
| `tests/` | Automated tests in headless Edge and Chrome; see [tests/README.md](tests/README.md). |
| `pack.ps1` | Builds `storyline-review-tools.zip` for the Chrome Web Store and Edge Add-ons. |

## Packaging for the stores

```bash
powershell -ExecutionPolicy Bypass -File pack.ps1
```

This builds `storyline-review-tools.zip` with only what the extension runs: `manifest.json`, `src/`, `sidepanel/`, `icons/` and `LICENSE`. It checks that every file `manifest.json` names is included. Don't zip the folder by hand: that would take in `.git`, the tests, and `tests/courses.json` with your Review links. The zip isn't kept in git.

## Testing

```bash
node tests/run-all.js
```

The tests run against real courses: your own Review links and a published quiz, listed in `tests/courses.json` (not in git). [tests/README.md](tests/README.md) explains how to set them up and what each test checks.

## Permissions

- **storage:** to remember the options.
- **sidePanel:** to show the side panel.
- Content scripts run only on `https://articulateusercontent.com/review/*`, the frames Review shows courses in.
