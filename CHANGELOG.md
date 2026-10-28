# Changelog

All notable changes to VisionX. Generated from `releases.json`; edit that file, not this one.

## 1.10.0 (2026-10-28): Watch it live, keep every session

- 🔴 **Live session tab**: See the live camera, the photo being analyzed and a countdown to the next one.
- 🗂️ **Sessions are saved**: Each finished session keeps its summary, photos, triggers and debug log.
- 📋 **Report when you stop**: End session opens a full report of everything that happened.

**Changes**

- Tabs: Setup, Live and Sessions
- Live: live camera, the photo being analyzed, countdown and progress bar, zoom and End session
- Ending a session collapses the page, saves the session and opens its report in Sessions
- Saved session report: what happened, stats, triggers, last photos, tracked details, instructions and the debug log (Copy as JSON, Delete)
- Settings › Capture: Sessions kept, 3 by default, up to 10; sessions are stored on this iPhone only

## 1.9.1 (2026-10-28): AI settings opens on top

- 🧭 **AI settings in view**: Tapping AI settings in Settings now opens it in front, not hidden behind.
- ↩️ **Back to Settings**: Done in AI settings brings you straight back to Settings.
- 💬 **Messages you can see**: Confirmations like Connection OK now show above Settings too.

**Fixes**

- AI settings opened behind the Settings sheet and only appeared after closing Settings
- Short confirmation messages were hidden behind the Settings and AI settings sheets

## 1.9.0 (2026-10-28): Settings, your way

- 🎨 **Colours and layout**: Six palettes or Auto, plus Compact and a Tiny layout that puts older photos on one line.
- 🔠 **Text size and font**: Pick Small to Larger text and a rounded or serif headline font.
- 🎛 **One Settings screen**: AI settings, update checks and capture limits behind the new sliders icon.

**Changes**

- New Settings sheet (sliders icon at the top): Appearance, AI, Updates with Check now, Capture tunables and Built with; changes apply at once
- Appearance shared with the other apps: Auto plus six palettes (VisionX teal in all), Comfortable, Compact or Tiny layout, four text sizes, rounded or serif headlines
- Tiny layout: older photos as one line each (number, time and summary); tap one to see it whole
- Capture limits are adjustable with ranges and Reset: AI request time limit, photos kept on screen, photos kept in Debug
- AI settings moved from the What to look for panel into Settings; the panel keeps a one-line status
- Settings are saved in settings.json in iCloud Drive › Scriptable › VisionX; presets, triggers and session choices stay in vision-session.json
- Built with: the blueprints this app follows, with links to read them

## 1.8.0 (2026-10-28): Claude joins OpenAI and Apple Intelligence

- 🤖 **Claude or OpenAI**: Photo analysis, triggers and refining now work with either provider. Switch any time in AI settings.
- 🧠 **Pick any model**: Load the models your own key can use, choose one and test the connection.
- 📊 **See your token usage**: Tokens per day, feature and model, so you always know what AI costs you.

**Changes**

- New AI settings sheet (Settings › AI settings): Claude and OpenAI keys, model picker loaded from your key, connection test, token usage per day, feature and model
- Keys are entered in a native secure prompt and stored in the iOS Keychain; the page no longer receives the key at all
- Photo analysis, trigger checks and instruction refining go through one shared AI call, following the app-blueprints AI configuration
- No key prompt at start: Apple Intelligence works without a key, and the cloud option appears under Analyze with once a key is saved
- The summary and refined instructions are labelled with the AI that wrote them
- Your existing OpenAI key moves over automatically
- The model is now chosen in AI settings rather than per preset; the OpenAI-only image detail setting stays

**Fixes**

- The API key was passed to the page and used for a direct-request fallback; both are gone

## 1.7.0 (2026-10-27): Never miss an update

- 🔔 **Update reminders**: VisionX tells you when a new version is out, and waits two days if you tap Later.
- ⬆️ **One-tap update**: Update right from the app. No need to run the installer again.
- ✨ **See what's new first**: Every update shows its three best features before you install it.

**Changes**

- Update check when VisionX opens, with a what's-new sheet (Update now / Later)
- Later, or tapping outside the sheet, hides the offer for two days
- An offer that arrives during a capture session waits until the session ends
- Version shown at the bottom of the app
- releases.json, CHANGELOG.md, tools/changelog.js and docs/RELEASING.md

## 1.6.0 (2026-10-26): Triggers for repeated moments

- 🔁 **Each new occurrence**: Run a shortcut every time something happens again, like each new thumbs-up.
- 🧾 **See why it ran**: Every trigger check shows whether its shortcut ran, and why or why not.
- 💡 **Clearer trigger options**: Each run setting explains itself in the trigger editor.

**Changes**

- New run setting "Each new occurrence": the check is told what had happened when the shortcut last ran
- "What VisionX did" in the debug log for every trigger check
- Hints for each run setting in the trigger editor

**Fixes**

- A trigger whose condition stayed true in a growing summary never ran again, with no explanation

## 1.5.0 (2026-10-26): Triggers in step with photos

- 📸 **Check after each photo**: Triggers can run right after every photo, against the newest summary.
- ⏸️ **Next photo waits**: No new photo is taken until the triggered shortcuts have finished.
- 🔒 **Steady screen**: Pinch and double-tap no longer zoom the app by accident.

**Changes**

- Trigger option "When to check": every few seconds, or after each photo is analyzed
- In fresh mode, the next photo waits for all triggered shortcuts
- Status shows "Running triggers for photo #n" while waiting

**Fixes**

- The interface could be pinch-zoomed or double-tap zoomed

## 1.4.0 (2026-10-26): See what the AI sees

- 🐞 **Debug log**: The last 10 photos with exactly what was sent and what came back.
- 🎨 **Readable JSON**: Tracked details and model replies are syntax-highlighted.
- 📋 **Copy as JSON**: Copy the whole log, without photos, to share or inspect.

**Changes**

- Debug panel with request, raw reply, parsed reply, usage and trigger checks per photo
- Syntax highlighting for JSON, including JSON inside text replies

## 1.3.1 (2026-10-26): Apple Intelligence, hands-free

- 🙌 **No paste prompts**: Turn off Show each photo here to run without iOS asking to paste.
- 📝 **Summary always shows**: Apple's replies are read in more shapes, so the summary never stays empty.
- 🧠 **Details stay intact**: Multi-line tracked details are kept and passed on to the next photo.

**Changes**

- "Show each photo here" switch for Apple Intelligence
- Apple Intelligence is asked for a simple labelled reply (FRAME, SUMMARY, STATE)

**Fixes**

- iOS asked to allow pasting after every photo
- The running summary stayed empty with Apple Intelligence
- Tracked details were cut to a single "{" from the second photo on

## 1.3.0 (2026-10-26): Better instructions in one tap

- ✍️ **Full-screen editor**: Expand your instructions into a roomy editor with a word count.
- 🪄 **Refine with AI**: Make instructions clearer, more specific or shorter with one tap.
- ↩️ **You decide**: Compare the suggestion with your text, then use it or undo it.

**Changes**

- Expand and Refine with AI buttons next to the instructions

## 1.2.0 (2026-10-26): Zoom while capturing

- 🔍 **Zoom slider**: Zoom from 1× to 5×, even in the middle of a session.
- 📷 **Sharp camera zoom**: Uses the iPhone's own zoom when available, cropping only beyond it.
- 🎯 **Aim with ease**: The live preview grows while you zoom so you can frame the shot.

**Changes**

- Higher camera resolution so digital zoom keeps more detail

## 1.1.0 (2026-10-26): Say it your way

- 💬 **Custom trigger messages**: Send your own text to a shortcut instead of the summary.
- 🧩 **Smart placeholders**: Fill in the reason, time, trigger name or summary automatically.
- 👀 **Clear at a glance**: The trigger list shows what each trigger will send.

**Changes**

- Per-trigger choice of Shortcut Input: the capture summary or a custom message

## 1.0.0 (2026-10-25): Your iPhone as a smart camera

- 📷 **AI photo watch**: Takes a photo every few seconds and has AI analyze it your way.
- ⚡ **Shortcut triggers**: Run any Apple Shortcut when a condition you describe is met.
- 🍎 **OpenAI or Apple**: Use any OpenAI model, or Apple Intelligence through Shortcuts.

**Changes**

- Timed capture with a running or per-photo summary beside the latest photo
- Instruction presets, API key management and a model list from your account
- Triggers with live status, on/off switches and session stats
- install.js installer and README with screenshots
