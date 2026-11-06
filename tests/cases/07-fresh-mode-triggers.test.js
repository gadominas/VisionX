// Fresh mode ("Build up over the session" off): each photo stands alone, its own request answers every trigger's
// condition, and the run modes decide when the shortcut runs (each time it becomes true, only the first time,
// every check while true; "each new occurrence" acts as "becomes true" here). What each shortcut receives.
const { run, wait, until } = require("../harness");
const T = (id, name, mode, send, extra) => Object.assign({ id, enabled: true, name, condition: name + " condition", shortcut: name + " SC", every: 30, when: "photo", mode, send, message: "" }, extra);
const STORE = { savedAt: 1, presets: [{ id: "p-gate", name: "Gate", text: "Read the license plate of any car at the gate." }],
  settings: { activePreset: "p-gate", instructions: "Read the license plate of any car at the gate.", engine: "openai", accumulate: false, startMode: "manual", interval: 2 },
  triggers: [T("t-rise", "Open the gate", "rise", "summary"), T("t-once", "First car", "once", "custom", { message: "{name}: {reason} Plate: {frame} (photo {photo}, {shortcut})" }),
    T("t-every", "Log every car", "every", "all"), T("t-new", "New car", "new", "frame"), T("t-off", "Switched off", "every", "summary", { enabled: false })] };
// Met on photos 1, 2 and 4; not on photo 3
const MET = { 1: true, 2: true, 3: false, 4: true };
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const files = {}; files[require("../harness").makeEnv().path.store] = JSON.stringify(STORE);
  const { E, p } = await run({ files, kc: { VISIONX_OPENAI_KEY: "sk-proj-TESTKEY0000000000001234" }, verdict: (id, idx) => MET[idx] });
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("A mode:", E.$("#accumulate").checked ? "build up" : "fresh", "| summary title:", E.text("#summaryTitle"), "| triggers:", E.text("#trigCount"));
  E.tap("#toggle");
  await until(() => !E.$("#capBtn").disabled, 5000, "capture ready");
  for (let i = 1; i <= 4; i++) {
    E.tap("#capBtn");
    await until(() => E.log.ai.length >= i && !E.$("#capBtn").disabled && /All \d+ analyzed/.test(E.text("#capTxt")), 6000, "photo " + i);
    await wait(150);
    console.log((i === 1 ? "B " : "  ") + "after photo " + i + " (met: " + MET[i] + "): ran", E.log.shortcutsRun.map((s) => s.name.replace(" SC", "")).join(", ") || "-");
  }
  const r = E.log.ai[0];
  console.log("C provider", r.provider, "model", r.model, "| no max_tokens:", r.maxTokens === undefined, "| image detail:", r.images[0].image_url.detail, "| conditions sent:", [...r.system.matchAll(/^- "([^"]+)"/gm)].map((m) => m[1]).join(","), "| text:", r.text);
  console.log("  no separate trigger checks:", !E.log.ai.some((x) => x.kind === "triggers"));
  const runs = (n) => E.log.shortcutsRun.filter((s) => s.name === n + " SC");
  console.log("D runs: becomes true", runs("Open the gate").length, "| first time", runs("First car").length, "| every check", runs("Log every car").length, "| new (as becomes true)", runs("New car").length, "| switched off", runs("Switched off").length);
  console.log("E sent: summary →", JSON.stringify(runs("Open the gate")[0].text), "| frame →", JSON.stringify(runs("New car")[0].text.slice(0, 40)));
  console.log("  custom message →", JSON.stringify(runs("First car")[0].text));
  const all = JSON.parse(runs("Log every car")[0].text);
  console.log("  everything → keys:", Object.keys(all).join(","));
  console.log("F trigger rows:", E.$$("#trigStatus .tr2h").map((t) => t.textContent.replace(/\s+/g, " ").trim().slice(0, 60)).join(" || "));
  E.tap("#hStop");
  await until(() => !E.$("#sesDetail").classList.contains("hidden"), 6000, "report");
  const idx = E.json(E.path.index)[0];
  console.log("G saved: mode", idx.mode, "| trigger runs", idx.fired, "| ran (the widget's top 3):", (idx.ran || []).map((x) => x.name + "×" + x.fired).join(", "));
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
