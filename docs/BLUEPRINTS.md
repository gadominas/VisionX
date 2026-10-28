# Blueprints

VisionX follows the shared blueprints in https://github.com/gadominas/app-blueprints.
The script's `BLUEPRINTS` block is the source of truth; this table mirrors it and adds deviations.

| Blueprint | Version | Since app version | Deviations |
| --- | --- | --- | --- |
| [in-app-updates](https://github.com/gadominas/app-blueprints/blob/in-app-updates-v1.0.0/blueprints/in-app-updates.md) | 1.0.0 | 1.7.0 | None |
| [settings](https://github.com/gadominas/app-blueprints/blob/settings-v1.0.0/blueprints/settings.md) | 1.0.0 | 1.9.0 | Session setup (presets, instructions, Analyze with, interval, camera, image detail, photo size, zoom, shortcut names) stays on the main screen as remembered picks in `vision-session.json`; "Sans serif" keeps the rounded headline font; the page script is a `String.raw` template, so the sheet code builds its markup with plain strings; sheet CSS is scoped under `#cfgsheet` because the app already uses `.switch`, `.chip` and `.sheet`; the old colour names are kept as aliases of the shared tokens, plus the app colour `--rec` per palette; AI settings is disabled in the sheet while a session runs; Tiny keeps the latest photo large and puts older photos on one line each |
| [ai-configuration](https://github.com/gadominas/app-blueprints/blob/ai-configuration-v1.0.0/blueprints/ai-configuration.md) | 1.0.0 | 1.8.0 | AI settings and usage live in `visionx-ai-settings.json` and `visionx-usage.json`; `aiCall` also sends one image per request and reports per-call tokens for the session totals; Apple Intelligence (via Shortcuts) stays as a separate engine outside AI settings |
