# Storyline Review Tools

A Chrome and Edge extension for reviewing Articulate Storyline courses on **Articulate Review** (`360.articulate.com/review/…`) faster. It brings the Storyline testing options of the [SCORM Test LMS](https://github.com/willswords/scorm-test-lms) to Review:

| Option | What it does |
|---|---|
| **Free navigation (menu)** | Opens the course with the menu set to "free", so you can jump to any slide, including ones not viewed yet. If the course's Player features turn the menu off, for the whole course or on some slides, it shows the menu too. |
| **Unlock seekbar** | Makes the seekbar draggable, if the course makes it read-only. |
| **Unlock Next/Prev buttons** | Keeps Next and Prev enabled on slides whose triggers disable them (for example "disable Next until the timeline ends"). The buttons are there but greyed out. |
| **Add Next/Prev buttons where turned off** | Shows Next and Prev on slides whose Player features (slide properties) leave them out, including question slides, where Next appears beside Submit. Next goes to the next slide in the menu, Prev goes back. |
| **Number the menu entries** | Shows the course menu with each entry numbered (1.1, 1.2…), as the player's "Number entries automatically" menu setting does, so it's easy to refer to a slide by its number in comments. |
| **Pre-select correct quiz answers** | Opens question slides with the correct answer already filled in, so you only press Submit. |

The side panel also explains **why you can or can't move on from the slide you're on** (see [This slide](#this-slide)), shows **what changed since an earlier version** (see [Changes since an earlier version](#changes-since-an-earlier-version)), lists the course's **quiz answers**, as the course scores them, and shows **when the course completes**: what its tracking needs, and the status it reports as you play it (see [Completion](#completion)).

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

### Review sites

Besides Articulate Review, the extension can work on courses shared for review on **reviewmyelearning.com**. Turn on **Courses on reviewmyelearning.com** in the extension's Options (right-click the toolbar button › **Options**); Chrome asks you to allow the site. Turning it off takes the access away again.

### Other sites

The extension works on Articulate Review. To use it on another site that serves Storyline courses, such as your LMS, add the site in the extension's **Options** (right-click the toolbar button › **Options**, or **Details › Extension options** on the extensions page):

1. On the Options page, **Ctrl+click the heading** ("Storyline Review Tools"), or press **Ctrl+Shift+S**, to show **Sites**. It's hidden otherwise, as it's a setting for whoever sets the extension up, not for reviewers.
2. Type the site's address, such as `https://burnsmcd.csod.com/*` (a bare name such as `burnsmcd.csod.com` becomes `https://burnsmcd.csod.com/*`), and press **Add**.
3. Chrome asks you to allow the extension on that site. Allow it.
4. Reload any course already open on the site.

`*` matches anything: `https://*.example.com/*` covers every site under example.com, and `https://lms.example.com/content/*` only that part of one. A site's ports are all included. Patterns that would cover every site aren't accepted. **Remove** takes a site off the list and takes away the extension's access to it. If you take away the access in Chrome instead, the site stays listed as "Not allowed in Chrome", with **Allow** to ask again.

**Changes since an earlier version** only works on Articulate Review, where each version has its own folder, so the side panel leaves it out on other sites. An LMS records what the course reports while you play it, against your account, so options such as **Pre-select correct quiz answers** can pass a course for you there.

### Side panel sections

The Options page, at the top, chooses which sections the side panel shows: **Storyline testing**, **This slide**, **Changes since an earlier version**, **Completion** and **Quiz answers**. They're all on to start with. A section turned off is hidden in every course, and its settings stay as they were (turning off Storyline testing hides the options, not their effect).

### Developer mode

The panel starts simple, for a content reviewer such as a subject matter expert: the options (without the notes explaining them), the text of the slide you're on ready to copy into a comment, changes since an earlier version, whether the course has completed and its estimated seat time, and the quiz answers (collapsed).

Tick **Developer mode** (at the top of the panel) for everything else: a note under each option on what the course does and what's being changed, why Next and Prev are locked on the slide you're on (see [This slide](#this-slide)), and how the course completes and what an LMS would get (see [Completion](#completion)). The choice is remembered, and doesn't reload the course.

### Text size

**A−** and **A+** at the top of the panel make its text smaller or larger (90% to 180%), remembered in this browser. The browser's own zoom (Ctrl+ and Ctrl−) zooms the page that has the keyboard focus, which is usually the course rather than the side panel.

In Developer mode, the panel shows what the course in the current tab does, and what's being changed. For example:

```
Free navigation (menu)
  Menu navigation is "restricted" → opened as "free".
Unlock Next/Prev buttons
  42 trigger(s) in 21 slide(s) disable Next/Prev → kept enabled.
Add Next/Prev buttons where turned off
  42 slide(s) turn off Next/Prev in their Player features → added; Next goes to the next slide, Prev goes back.
Pre-select correct quiz answers
  All 10 question(s) open with the correct answer filled in; you still press Submit.
```

An option is greyed out when the course has nothing for it to unlock.

**Prev and Next in the panel:** below **Add Next/Prev buttons where turned off** are **◀ Prev** and **Next ▶** buttons, in both the simple view and Developer mode. They work on every slide, without reloading the course or turning any option on: each runs the slide's own Prev or Next, as the course's buttons would, even while the course hides or greys them out. On a slide whose Player features turn the button off (so it has no Prev or Next of its own), Next goes to the next slide in the menu's order and Prev goes back. A button is **orange** when the course hides it on the slide you're on, with a note saying which.

**Unlock all navigation** turns on (or off) the three unlocking options (free navigation, seekbar, Next/Prev) at once, skipping any that are greyed out, and reloads the course once. It shows a dash when only some of them are on; clicking it then turns them all on.

The options apply to **every Review course you open** until you turn them off. While any is on, the toolbar button shows **ON**. Turn them off before reviewing a course as a learner would see it.

### Quiz answers

**Pre-select correct quiz answers** fills in:

- **Multiple choice, multiple response and true/false:** the correct choices are selected.
- **Fill in the blank:** one of the accepted answers is typed in.
- **Numeric:** a number that's scored correct is typed in.
- **Hotspot:** a click is recorded in the centre of the correct area.

Other question types (drag and drop, matching, sequence, word bank and so on) are answered by hand. The **Quiz answers** list in the panel shows their correct answers.

### Slide numbers

Everywhere the panel shows a slide number (This slide, Changes since an earlier version, Completion), it's the slide's number in the course menu, as **Number the menu entries** shows it. The menu can group slides differently from the scenes: a slide that's slide 18 of scene 1 may be the 3rd entry under the 6th heading in the menu, so it's 6.3. A slide that isn't in the menu, such as a results slide, has its scene number, marked "(not in menu)".

### This slide

When you're stuck on a slide, **This slide** in the panel says why. It starts collapsed: click its heading to open it (the panel remembers whether it's open). It follows the slide you're on and shows, for Next and for Prev:

- whether the button is **available**, **greyed out** or **not showing** right now;
- whether it's turned off in the slide's Player features;
- each trigger that disables, enables, hides or shows it, when it runs and what it waits for, in Storyline's words;
- where it goes.

It also lists the slide's own buttons that go to other slides, and the current values of any variables the triggers check. For example:

```
Slide 1.6 "What Should I Do?"
Next  [Not showing]
  • Hidden when the timeline starts, if "Tab A" is in its Normal state and "Tab B" is in its Normal state.
  • Disabled as the slide appears, if the timeline hasn't played to the end yet.
  • Shown and enabled when "Tab A" is visited or when "Tab B" is visited, if "Tab A" is visited and "Tab B" is visited.
  • Goes to slide 1.9 "Service Recovery".
  No option overrides a trigger that hides it; Free navigation (menu) lets you jump on from the menu.
```

**Copy text**, in the section's heading, opens a box with all the text on the slide, layer by layer (base layer first, then "Layer 2", "Layer 3"…, as published layers have no names), top to bottom and left to right. Sentences aren't broken across lines: each paragraph is on one line (a line break inside a paragraph becomes a space, and a paragraph that carries on a sentence, such as a title wrapped onto two lines, joins the one before). Select the part you want to change, copy it (Ctrl+C) and paste it into your Review comment, or use **Copy all**. It includes text that's hidden at first, such as feedback and pop-ups, then the closed captions of the slide's audio and video (one sentence per line, labelled with their layer), and ends with the slide's notes from the player's Notes tab, under the tab's name in the course (often "Transcript"). The box keeps your selection while you stay on the slide, and shows the next slide's text when you move on.

When the button isn't available, it says which option gets past it: **Unlock Next/Prev buttons** for a disabled button, **Add Next/Prev buttons where turned off** for one turned off in Player features. Storyline's own trigger that disables Prev on the first slide you open isn't counted as a lock.

### Changes since an earlier version

When a course has been republished to Review, **Changes since an earlier version** shows what's different, so you only need to re-check those slides:

```
Compare with  [Published 10/31/2026 at 8:08 PM · 3 slides ▾]
From that version to this one: 1 changed, 1 added, 2 removed slides.
  • Slide 1.1 "Go to the next slide to finish the course."
      renamed from "Answer the question correctly to complete the course."
      "Answer the question correctly…" →
      "Go to the next slide…"
  • Added Slide 1.2 "You have finished the course…"
  • Removed Slide 1.3 "Quiz Results"
```

Each slide in the list is a link: click it to go straight to that slide, even if the course's menu is restricted (as Review does when you click a comment). A slide that's only in the other version, such as one removed since, isn't a link. The slide you're on in the course is highlighted in the list, tagged "You're on this slide", and the highlight follows you as you move through the course.

It compares slide titles, text (on every layer), the closed captions of the slide's audio and video (listed under "Captions:", or "Captions (Layer 2):" and so on for a layer's captions), notes (under "Notes:") and slide order. Captions and notes are compared sentence by sentence, and line breaks and spacing don't count as changes, so rewording one sentence shows only that sentence, not every caption after it.

In a changed line, the words that changed stand out: in the new text, added words are **bold and highlighted**, and a red **[…]** marks where words were removed (point at it to see them); in the old, struck-through text, the removed words are bold. For example: "Many areas in our buildings have both ivory **or white** and red electrical outlets." Versions remembered by an earlier version of the extension have no captions, so captions aren't compared with them until they're opened again. Slides are matched between versions by Storyline's own slide IDs, so a slide that moved or was renamed is still the same slide. Images, media, triggers and layout aren't compared.

Review doesn't let the extension see its list of versions, so the extension remembers each version **when you open it**: it keeps a copy of the version's text in your browser (the most recent 30 versions), and nothing is sent anywhere. So:

- If you reviewed an earlier version in this browser, opening the new one shows the changes straight away.
- Otherwise, choose the earlier version from Review's version menu (**Current Version ▾** at the top) and let it load, then go back to the current version.

The section starts collapsed. The times in **Compare with** are when Storyline published each version, which can be a minute or two before the time in Review's version menu.

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

#### Estimated seat time

The Completion section also estimates how long the course takes, for LMS catalogue entries, for example "About 12 min (up to 17 min if every layer is opened)". Storyline doesn't record a seat time, so it's worked out from the slides:

- each slide's timeline, which runs as long as its narration and video;
- at least the time to read a slide's text (at 200 words a minute), for slides whose timeline is shorter;
- layers (feedback, tabs, pop-ups) as "up to", since a learner opens only some of them;
- question bank draws, at the average length of the bank's slides.

Time spent answering questions isn't included (the panel says how many there are), and it assumes every slide is viewed once. **How it's worked out**, below the estimate, shows each part.

## How it works

A Storyline course loads its content as data files (`html5/data/js/frame.js`, `data.js`, and one file per slide), each handed to the player through a function called `globalProvideData`. On Review, the course runs in a frame from `articulateusercontent.com`.

The extension runs a small script in that frame before the Storyline player starts. It wraps `globalProvideData`, and changes each file's content as it arrives:

- `frame.js`: the menu's `flow` setting becomes `"free"`, and a menu turned off in Player features is shown: the Menu tab (`outline`) is added to the sidebar's tabs if it isn't there, the sidebar is turned on (`sidebarEnabled`), and slide layouts that leave the menu out (`"outline": { "enabled": false }`) include it; for Number the menu entries, its `autonumber` becomes `true`; the seekbar's `readonly` settings become `false`. For Add Next/Prev buttons where turned off, in the control layouts slides pick with their Player features (`controlLayouts`), `"previous"` and `"next"` (and their swipes) become `true`.
- Slide files: triggers that disable Next, Prev or the seekbar (`enable_window_control` with `"enable": false`) become `"enable": true`. For Add Next/Prev buttons where turned off, a slide that hides a button is published without the trigger it runs, so it gets Storyline's usual one: Next goes to the next slide in the menu's order, Prev goes back.
- Question slides: the correct choices start selected, a hotspot's click starts recorded. Fill-in and numeric answers are set through the player's own `SetVar`.

To build the answer key and the counts in the panel, it reads the course's slide files (the same files the course loads anyway). Nothing is sent anywhere else.

For completion, it reads `data.js`'s `scorings` (the Tracking settings) and finds the slides with Complete Course triggers (`set_course_status`) and results slides (`setquizcomplete`). While the course plays, it listens to the player's event bus (`DS.pubSub`: `status:updated`, `course:completed`, `course:manuallyCompleted`, `course:viewed`, `quiz:retried`) and asks the player for the status (`DS.presentation.scorings().getStatus()`), sending a status once, as the player's SCORM code does.

[STORYLINE-NAVIGATION.md](https://github.com/willswords/scorm-test-lms/blob/main/STORYLINE-NAVIGATION.md) in the SCORM Test LMS explains Storyline's navigation locks in detail.

## What it doesn't unlock

- **Slides whose Next has no destination.** Some slides are designed to move on through their own buttons. Use free navigation to jump past them from the menu.
- **On-slide buttons that are hidden**, and on-slide buttons, tabs or layers that wait for a variable. They're part of the slide, not the player's controls.
- **Courses on other sites, until they're added.** It runs on Review's course frames, and on the sites added in Options (see [Other sites](#other-sites)).

## Files

| File | Purpose |
|---|---|
| `manifest.json` | The extension's definition (Manifest V3). |
| `src/core.js` | The Storyline logic: reading settings and locks, building the answer key, filling in answers, reading the tracking settings. Shared with the side panel. |
| `src/hook.js` | Runs in the course frame before the player: makes the changes, follows the course's completion status, and shows the completion message. |
| `src/bridge.js` | Connects the course frame to the extension: passes the settings in, reloads the course when they change, reports to the side panel. |
| `src/background.js` | Opens the side panel from the toolbar button, shows **ON** on it, and runs the course scripts on the sites added in Options. |
| `sidepanel/` | The side panel. |
| `options/` | The Options page: the other sites the extension works on, and which side panel sections show. |
| `icons/` | The toolbar icon. |
| `tests/` | Automated tests in headless Edge and Chrome; see [tests/README.md](tests/README.md). |
| `pack.ps1` | Builds `storyline-review-tools.zip` for the Chrome Web Store and Edge Add-ons. |

## Packaging for the stores

```bash
powershell -ExecutionPolicy Bypass -File pack.ps1
```

This builds `storyline-review-tools.zip` with only what the extension runs: `manifest.json`, `src/`, `sidepanel/`, `options/`, `icons/` and `LICENSE`. It checks that every file `manifest.json` names is included. Don't zip the folder by hand: that would take in `.git`, the tests, and `tests/courses.json` with your Review links. The zip isn't kept in git.

## Testing

```bash
node tests/run-all.js
```

The tests run against real courses: your own Review links and a published quiz, listed in `tests/courses.json` (not in git). [tests/README.md](tests/README.md) explains how to set them up and what each test checks.

## Permissions

- **storage:** to remember the options.
- **sidePanel:** to show the side panel.
- Content scripts run on `https://articulateusercontent.com/review/*`, the frames Review shows courses in, and on the sites added in Options.
- **scripting:** to run the course scripts on the sites added in Options.
- **Optional access to other sites:** asked for one site at a time, only when you add it in Options. The extension has no access to a site until you add and allow it.
