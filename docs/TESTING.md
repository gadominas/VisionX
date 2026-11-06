# Testing VisionX

VisionX is one Scriptable script, so it can't run in a normal test runner. The `tests/` folder runs the **real `VisionX.js`** in Node instead, with Scriptable's APIs replaced by stand-ins, and taps through the app the way a person would. The same setup takes smoke screenshots of the real page.

## Run the tests

VisionX follows the [testing recipe](https://github.com/gadominas/app-blueprints/blob/testing-v1.0.0/recipes/testing.md): the shared testkit runs lint, the conformance packs (safe start-up, stability patterns, in-app updates, widgets, usage analytics) and every case in `tests/cases`, on every push (`.github/workflows/tests.yml`). With [app-blueprints](https://github.com/gadominas/app-blueprints) cloned next to this repository:

```sh
(cd ../app-blueprints/testkit && npm ci)
(cd tests && npm install)                    # jsdom, for the cases on tests/harness.js
node ../app-blueprints/testkit/bin/run.js    # everything: 27 of 27 must pass before a release
```

`tests/app.config.js` holds VisionX's per-app values. The cases still use the old harness below and run unchanged (`legacyCases`) until they are moved. The old runner works as before:

```sh
cd tests
npm install          # jsdom; Playwright is optional, only for screenshots
node run.js          # all 21 scenarios, one line each (about 2 minutes)
node run.js trigger  # only those whose name contains "trigger"
node run.js -v 12    # one scenario, printing everything it checks
```

A scenario **passes** when it finishes and reports no error from the script, from the page, from the harness (a request without a fixture, a call on iCloud on a phone without iCloud) or a crash. Every scenario also prints what it saw at each step (A, B, C…). Read those lines with `-v` after a change: most checks are things to look at (a value, a label, a prompt) rather than assertions. The bugs the tests found are asserted, so they fail if they come back.

To test another copy of the script, set `VISIONX_SCRIPT=/path/to/VisionX.js`.

Run them all before every release (see [RELEASING.md](RELEASING.md)). A release goes out only with 21 of 21 passing.

## How it works

**`tests/harness.js`** loads `VisionX.js` (or the file in `VISIONX_SCRIPT`) into a Node `vm` context with stand-ins for everything Scriptable provides:

| Scriptable | Stand-in |
|---|---|
| `WebView` | a [jsdom](https://github.com/jsdom/jsdom) page per `loadHTML` (the empty first window, then the real page at `https://localhost/`). `evaluateJavaScript` runs in it. The page's hidden `vsbridge://call?id=N` frames reach `shouldAllowRequest`, as on the phone. The page gets a fake camera (`getUserMedia`, a video with frames, optional lens zoom), a canvas whose photos are a 1×1 JPEG, images that load from `data:` URLs, `navigator.clipboard`, `matchMedia` (light or dark) and a `localStorage` that survives reopening |
| `Request` | answers only from built-in fixtures, by URL: GitHub raw (`releases.json`, `VisionX.js`, the widget icon), the Claude and OpenAI APIs (messages, chat completions, model lists) and PostHog. Nothing reaches the network, and an unknown URL fails the test |
| Claude / OpenAI | the fixtures recognise each prompt (photo analysis built up or fresh, trigger check, refine, connection test) and answer with fixed JSON. They keep each request in `E.log.ai` (provider, kind, system, text, images, model, max_tokens, headers) so a test can check what was sent |
| `FileManager` | files in memory (`E.files`), iCloud Drive and the phone's local Documents. Options: `slowCloud` (iCloud never delivers a file), `unreadable` (a read fails), `noICloud` (a phone without iCloud, where any call on the iCloud manager is an error), and damaged files written by the test |
| `Keychain` | in memory (`E.kc`). Keys are fake |
| `Alert` | answers you queue with `E.log.pushAlert([...])` (text fields), `{ action: n }` (a button) or `{ cancel: true }`; each one shown is kept in `E.log.alerts` |
| `CallbackURL` (Shortcuts) | runs pretend shortcuts: *Vision Session AI* answers in the labelled format and puts a photo on the clipboard, *Vision Session Check* answers trigger checks and refining, *VisionX Shortcut List* returns a list, and any other is a trigger's shortcut, kept in `E.log.shortcutsRun`. `opts.shortcuts` replaces or fails one |
| `Pasteboard`, `Data` | record copies; `pasteImage` returns the photo the last shortcut copied (or none with `clipboardPhoto: false`) |
| `ListWidget`, `DrawContext`, `Font`, `Color`… | build plain trees in `E.log.widgets`; `E.widgetText()` reads them |
| `Timer` | real timers at a tenth of the time (`timeScale`), so the deferred update check and the iCloud time limit don't slow the tests |
| `Safari`, `Script`, `UUID`, `Device`, `config`, `args`, `module` | record what happened (`E.log.opened`…), a widget family with `opts.widget`, dark mode with `opts.dark` |
| `Speech`, `Notification`, `Photos`, `DocumentPicker`, `QuickLook` | VisionX doesn't use them; any call is recorded in `E.log` |
| Browser APIs | `URL`, `setTimeout`, `fetch`, `atob` and the rest don't exist in the `vm` context, as in Scriptable's JavaScriptCore. A script that uses one on the Scriptable side fails here too |

`run(opts)` starts the script and returns `{ E, p }`. `E.getDom()` (or `E.win()`, `E.doc()`) is the page. Tap with `E.tap(selector)` and type with `E.type(selector, value)`. `E.files`, `E.kc` and `E.ls` are the stored data: pass them to the next `run()` to reopen the app. `E.json(path)` reads a stored file, `E.path` has the app's paths, and `E.log` holds what the script did: requests, AI requests, alerts, shortcuts, the pasteboard, widgets, PostHog batches, photos taken. `E.problems()` lists what the harness caught. `E.finish()` closes the app, and `p` settles when the script ends. `until(fn)` and `wait(ms)` pace a test.

## The scenarios

| Test | Covers |
|---|---|
| 01 first-start | The empty window, the launch screen, booting from handed-over data, seeded presets, the usage question, what's saved on close |
| 02 safe-startup | iCloud that never delivers settings, an unreadable store, damaged files (copied aside once, then saved again), a page whose load never finishes, two windows at once, the start-up log |
| 03 no-icloud | A phone without iCloud: open, save settings, update, widget, and iCloud never touched |
| 04 presets | Pick, edit and update, save new, delete with two taps, kept after reopening, the page's own copy when the file is gone |
| 05 cloud-session | Claude in Auto: camera, the photo and prompt sent, the summary building up, stats, pause and resume, stop, the saved session, token usage |
| 06 manual-capture | Manual capture: queue and meter, order, a full queue, Manual → Auto mid-session, paused |
| 07 fresh-mode-triggers | Each photo on its own: conditions inside the photo's request, the four run modes, what each shortcut receives (summary, frame, custom message, everything), OpenAI without `max_tokens` |
| 08 buildup-triggers | Checks after each photo and on a timer, the check prompt, "each new occurrence" history, a failing shortcut, the debug log's decisions |
| 09 trigger-editor | Add, the checks before saving, Load my shortcuts, custom message, Edit, Duplicate, Delete, on/off, kept after reopening |
| 10 apple-intelligence | Shortcuts instead of a key: the labelled reply, the photo from the clipboard, the checker shortcut, "Show each photo here" off, a missing shortcut stopping the session |
| 11 refine | The editor: Clearer and your own request, Use this, Undo refine, Make it visual, Keep mine, Done, Cancel; refining with Apple Intelligence |
| 12 sessions | Saved sessions, the list, a report, the bin with two taps, Sessions kept, a damaged index rebuilt from the saved sessions |
| 13 debug-log | Replies as fenced JSON, bold labels and plain text, the entry's sections, Photos kept in Debug, Copy as JSON without photos, live and saved |
| 14 errors | No key, camera refused or missing, a bad key stopping the session, an overloaded provider once, no internet |
| 15 settings | Sections, Appearance applied and saved, tunables stepped, typed and clamped, reset, Reset all, Built with links (and only those), dark mode |
| 16 ai-settings | Add a key (cancel, trim), models, test, choose a model, a second provider, In use, Remove, usage reset, the 1.7 key migration, locked during a session |
| 17 ai-invitation | When it shows, Later, three days later, Turn on AI, Don't remind me again; never with a key, an update offer or Apple Intelligence in use |
| 18 widget | Empty, offline logo, cached logo, last session in every size, Live, stale Live, refresh time, plain-text summary, not Live after Stop |
| 19 updates | The offer (escaped, topped up from skipped versions), Later, Check now, Update now and its three refusals, held during a session, switched off |
| 20 usage-analytics | Nothing before yes, the events and their properties, nothing personal sent, the shortcut list isn't a trigger run, Send test, off deletes the ID |
| 21 installer | `install.js`: first install, up to date, update, bad download, offline, a phone without iCloud |

## Add a test

Copy the closest scenario in `tests/cases/` to `NN-what-it-covers.test.js` and keep its shape. Start with `run()`, tap through, and print one line per step. End with `console.log("errors:", …, "| JS errors:", E.log.jsErrors || "none")`, which is what `run.js` checks; add `E.problems()` to the errors. If VisionX calls a new service, add its fixture to `route()` in `harness.js` next to the others: match on the URL and answer with the smallest realistic JSON or text. For a new AI feature, teach `aiKind()` its system prompt and answer it, so the request is kept for the test to check. A new Scriptable API goes into `env` in `makeEnv()`. Never change the app to suit the harness.

## Screenshots

```sh
cd tests
npm install playwright && npx playwright install chromium   # once
node screens/run.js       # PNGs in <tmp>/visionx-screens/shots, or $VISIONX_SHOTS
```

`screens/snapshot.js` drives the app through the harness with sample data and saves each screen as static HTML: Setup, Triggers, Live, Debug, the report, Settings, AI settings, the update sheet, Sessions in dark mode, and the widget trees. `screens/shots.js` opens them in Chromium at iPhone size and takes the PNGs. These are a visual check that the page still renders. The README's labelled cards are made separately, by [app-blueprints/repo-site](https://github.com/gadominas/app-blueprints/tree/main/repo-site) from [`docs/site/scenario.js`](site/scenario.js).

## What it doesn't cover

- Real network answers. Claude, OpenAI and GitHub can change their formats, so check on the phone after such a change.
- The real camera and WebKit: drawing, scrolling and the half-height photo row, Reduce Motion.
- How iOS draws widgets, Lock Screen tinting, and when iOS refreshes them.
- Native alerts as they look, real Shortcuts and Apple Intelligence's *Use Model* output, the "Allow Paste" prompt, and switching to Shortcuts and back.
- iCloud sync itself, Back Tap and the Action Button, the screen locking during a session, and speed on a real phone.
- Timing that depends on real seconds, such as the AI request time limit (30 s at least), the 25 s "Still loading…" note and the update snooze running out.

These are checked on the iPhone before a release.
