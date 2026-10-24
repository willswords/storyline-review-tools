# Tests

Automated checks in headless Edge and Chrome against real Storyline courses. Each test prints `PASS`/`FAIL` lines and exits non-zero if anything fails.

## Setting up

You need:

- Node.js 22 or later (for the built-in `fetch` and `WebSocket`).
- Microsoft Edge and Google Chrome, installed in their usual places. Set `EDGE_PATH` or `CHROME_PATH` if they're elsewhere.
- Windows (the clean-up uses PowerShell).

The test courses go in `tests/courses.json`. It isn't in git, because anyone with a Review link can view the course:

1. Copy `courses.example.json` to `courses.json`.
2. Fill in the Review links, and the path to a published Storyline course with fill-in, numeric and hotspot questions.

## Running

From the project folder:

```bash
node tests/run-all.js
```

Or one or more by name, for example:

```bash
node tests/run-all.js navigation answers
```

All four take about three minutes. Screenshots go to `tests/output/` (not in git).

## The tests

| Test | Course | Checks |
|---|---|---|
| `test-navigation.js` | `navigation`: a "restricted" menu, and triggers disabling Next/Prev | With the settings off, the course is exactly as published: the menu locks slides, and the hook counts the locks without changing anything. With them on, the menu is free, Next is enabled, and it moves on. |
| `test-answers.js` | `answers`: courses with a multiple-choice or true/false quiz | Goes to the first question through the menu. With the settings on, the correct choice is selected and nothing else is; with them off, nothing is selected. |
| `test-question-types.js` | `questionTypesPackage`: a published course (.zip or folder), served locally | Every question type that can be pre-filled opens filled in, and Storyline's feedback after Submit says it's correct. |
| `test-extension.js` | `extension`: a "restricted" menu and a quiz | The extension itself, loaded into Chrome: the side panel finds the course, its notes and answer list are right, its checkboxes reload the course with the settings (menu free, toolbar badge ON), and turning them off goes back to the published course. |

The first three inject `src/core.js` and `src/hook.js` into the course frame the way the extension's content script would, which makes them faster to run and works in Edge. `test-extension.js` loads the whole extension.

## Things that broke these tests before

`lib/browser.js` handles these; they're listed here in case they come back.

- **Loading the extension.** Branded Edge and Chrome ignore `--load-extension`. The test loads it through the DevTools pipe (`Extensions.loadUnpacked`, with `--enable-unsafe-extension-debugging`). That works in Chrome. Edge relaunches itself and drops the pipe, so the extension test uses Chrome.
- **Headless Chrome crashing after about 20 seconds,** when its updater couldn't connect. It's started with `--disable-component-update --disable-background-networking --disable-gpu`.
- **`chrome.storage` failing** with `IO error: …/LOCK: File not found`, when the browser profile was in a long folder path: the files inside go past Windows' 260-character limit. Profiles are made in the system temp folder.
- **Tests talking to a browser left over from an earlier run.** Edge leaves processes behind, and one still listening on a reused port answered for the new run, still holding old scripts. Each run uses a free port, and every process using the run's profile folder is stopped afterwards (`kill-browser.ps1`).
- **Clicks not reaching the course menu.** Review's cookie notice covers the lower-left corner of the course. The tests hide it in their own profile (no cookie choice is made).
- **Scenes collapsed in the course menu.** A slide's menu item has no size until its scene is expanded with the scene's arrow (clicking the scene's name goes to the scene instead).
- **Review replacing the course frame** after its first load. The tests look the frame up again when its connection goes.
- **The course tab in the background.** After reloading there, the player may not finish building the page, so the extension test brings it to the front.
