# Blueprints

VisionX follows the shared app blueprints in [gadominas/app-blueprints](https://github.com/gadominas/app-blueprints), so it looks and behaves like the other apps. Coding agents: read that repository's [AGENTS.md](https://github.com/gadominas/app-blueprints/blob/main/AGENTS.md) before changing these parts.

| Blueprint | Blueprint date | Applied in version | Deviations |
| --- | --- | --- | --- |
| [in-app-updates](https://github.com/gadominas/app-blueprints/blob/main/blueprints/in-app-updates.md) | 2026-10-27 | 1.7.0 | none |
| [ai-configuration](https://github.com/gadominas/app-blueprints/blob/main/blueprints/ai-configuration.md) | 2026-10-28 | 1.8.0 | AI settings and usage live in `visionx-ai-settings.json` and `visionx-usage.json`; `aiCall` also takes photos (`images`) and reports each call's tokens in `aiCall.last` for the session totals; Apple Intelligence stays a third engine outside AI settings, run through Shortcuts; no background AI jobs, so “What AI does” has no switch; JSON replies rely on the prompt and the app's tolerant parser instead of a provider JSON mode |
