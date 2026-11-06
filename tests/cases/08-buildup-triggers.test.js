// "Build up over the session" on: triggers ask the model about the running summary, after each photo or on their
// own timer. "Each new occurrence" is told what had happened when it last ran; "each time it becomes true" waits
// for the condition to turn false; a shortcut that fails is reported; the debug log says what VisionX did.
const { run, wait, until, makeEnv } = require("../harness");
const T = (id, name, when, mode, send, extra) => Object.assign({ id, enabled: true, name, condition: name + " happened", shortcut: name + " SC", every: 5, when, mode, send, message: "" }, extra);
const STORE = { savedAt: 1, presets: [],
  settings: { instructions: "Count the thumbs-up gestures.", engine: "openai", accumulate: true, startMode: "manual", interval: 2 },
  triggers: [T("t-new", "Thumbs up", "photo", "new", "custom", { message: "{condition} / {check} / {photos} photos / {engine}" }),
    T("t-rise", "Crowd", "photo", "rise", "state"), T("t-fail", "Broken", "photo", "every", "summary", { shortcut: "Missing SC" }),
    T("t-timer", "Timer check", "interval", "once", "raw")] };
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const files = {}; files[makeEnv().path.store] = JSON.stringify(STORE);
  const { E, p } = await run({ files, kc: { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" }, shortcuts: { "Missing SC": "fail" } });
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  E.tap("#tab-triggers"); await wait(20);
  console.log("A triggers tab:", E.$$("#trigList .tItem b").map((b) => b.textContent).join(", "), "|", E.$$("#trigList .tsub").filter((_, i) => i % 2).map((s) => s.textContent.slice(0, 45)).slice(0, 2).join(" / "));
  E.tap("#toggle");
  await until(() => !E.$("#capBtn").disabled, 5000, "capture ready");
  const checks = () => E.log.ai.filter((r) => r.kind === "triggers");
  for (let i = 1; i <= 3; i++) {
    E.tap("#capBtn");
    await until(() => E.log.ai.filter((r) => /^analysis/.test(r.kind)).length >= i && /All \d+ analyzed/.test(E.text("#capTxt")), 8000, "photo " + i);
    await wait(150);
    console.log((i === 1 ? "B " : "  ") + "after photo " + i + ": checks so far " + checks().length + ", ran: " + (E.log.shortcutsRun.map((s) => s.name.replace(" SC", "")).join(", ") || "-"));
  }
  const c1 = checks()[0];
  console.log("C check prompt: condition", /CONDITION:\nThumbs up happened/.test(c1.text) || /CONDITION:\n\w+/.test(c1.text), "| summary in it:", /SUMMARY SO FAR:\n1 different people so far\./.test(c1.text), "| tracked details:", /TRACKED DETAILS \(JSON\):\n\{"people":1/.test(c1.text), "| max_tokens", c1.maxTokens);
  const newChecks = checks().filter((r) => /CONDITION:\nThumbs up happened/.test(r.text));
  console.log("D 'each new occurrence': first check without history:", !/ALREADY RAN/.test(newChecks[0].text), "| later checks are told it ran:", /THIS TRIGGER ALREADY RAN at .* \(after photo #1\)/.test(newChecks[1].text));
  console.log("  custom message:", JSON.stringify(E.log.shortcutsRun.find((s) => s.name === "Thumbs up SC").text));
  console.log("  'becomes true' ran once though still met:", E.log.shortcutsRun.filter((s) => s.name === "Crowd SC").length, "| sent tracked details:", E.log.shortcutsRun.find((s) => s.name === "Crowd SC").text.replace(/\s+/g, ""));
  console.log("E failing shortcut: tried", E.log.callbacks.filter((c) => c.name === "Missing SC").length, "times | row:", (E.$$("#trigStatus .tr2").find((r) => /Broken/.test(r.textContent)) || { textContent: "" }).textContent.replace(/\s+/g, " ").trim().slice(0, 90));
  E.tap('#debugBox summary'); E.$("#debugBox").open = true; await wait(50);
  const d = E.$("#debugList details.dbg"); d.open = true; d.dispatchEvent(new (E.win().Event)("toggle")); await wait(50);
  console.log("F debug, newest photo's checks:", [...d.querySelectorAll(".dbgCheck summary")].map((s) => s.textContent.replace("Trigger check: ", "").replace(/ at [\d:]+ [AP]M/, "")).join(" | "));
  console.log("  what VisionX did:", [...d.querySelectorAll(".dbgCheck pre.bad")].map((x) => x.textContent.slice(0, 80)).slice(0, 2).join(" || "));
  await until(() => E.log.shortcutsRun.some((s) => s.name === "Timer check SC"), 9000, "timer trigger");
  console.log("G timer trigger (every 5 s) ran on its own:", true, "| sent the raw reply:", E.log.shortcutsRun.find((s) => s.name === "Timer check SC").text.slice(0, 50));
  await wait(5500);
  console.log("  'only the first time' did not run again:", E.log.shortcutsRun.filter((s) => s.name === "Timer check SC").length === 1);
  console.log("H stats:", E.text(".stats") || ["sPhotos", "sReq", "sTok"].map((id) => E.text("#" + id)).join(" / "), "| usage features:", Object.keys(E.json(E.path.usage).p.anthropic.features).join(","));
  E.tap("#hStop");
  await until(() => !E.$("#sesDetail").classList.contains("hidden"), 6000, "report");
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
