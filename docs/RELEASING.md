# Releasing a new version

`releases.json` is the single source of truth for versions and release notes. The app reads it from GitHub to decide whether to offer an update, and uses it to pitch the update to users.

## Steps

1. **Bump the version** in `VisionX.js`: `const VERSION = '1.8.0';`. Use [semantic versioning](https://semver.org): a new feature bumps the middle number (1.7.0 → 1.8.0), a fix-only release the last (1.8.0 → 1.8.1).
2. **Add a release at the top of `releases.json`**, with the same version.
3. **Regenerate the changelog**: `node tools/changelog.js`.
4. **Commit everything to `main`** in one push: the script, `releases.json` and `CHANGELOG.md`.

Keep `const VERSION = '…';` and `const APP_ID = 'visionx';` exactly in that form, with single quotes: the in-app updater reads both lines from the downloaded file to check that it really is a newer VisionX before installing it.

Users see the update the next time they open VisionX. GitHub can take a few minutes to serve new files.

## Release entry format

```json
{
  "version": "1.8.0",
  "date": "2026-11-02",
  "title": "Short headline for the update sheet",
  "highlights": [
    { "icon": "🔔", "title": "Feature name", "text": "One sentence on what it does for the user." },
    { "icon": "⬆️", "title": "Feature name", "text": "One sentence on what it does for the user." },
    { "icon": "✨", "title": "Feature name", "text": "One sentence on what it does for the user." }
  ],
  "changes": ["Everything new, one line each"],
  "fixes": ["Every bug fixed, one line each"]
}
```

## Writing good highlights

The three highlights are the update pitch. They are the first thing a user reads before deciding to update.

- **Exactly three**, ordered by how much a user will care.
- **Title:** two to four words, naming the benefit rather than the implementation.
- **Text:** one sentence, under 100 characters, saying what the user can now do.
- **Icon:** one emoji.

If a user skipped several versions, the pitch shows the newest release's highlights first and fills any gaps from older releases they missed.

## Behaviour in the app

- VisionX checks `releases.json` once per run, in the background, without slowing the start.
- **Update now** downloads the script over the current one; the user reopens VisionX to start the new version.
- **Later**, or tapping outside the sheet, hides the pitch for two days.
- Users can turn checks off with `const CHECK_UPDATES = false;` near the top of the script.
- An offer that arrives during a capture session waits until the session ends.

## Testing an update

Temporarily set `VERSION` lower than the newest entry in `releases.json` on GitHub and open VisionX: the sheet should appear a moment later. To bring back an offer you postponed with Later, run `Keychain.remove('visionx-update-snooze')` in a scratch Scriptable script.
