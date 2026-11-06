// What goes wrong and what the person sees: no key (cloud is not offered), the camera refused or missing,
// a bad key (the session stops at once), a passing provider error and no internet (the session keeps going).
const { run, wait, until, makeEnv } = require("../harness");
const KEY = { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" };
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let E, p;
  const boot = async (o) => { ({ E, p } = await run(o)); p.catch((e) => errors.push("SCRIPT " + e.stack)); await until(() => E.win() && E.win().__booted, 5000, "boot"); };
  const seen = [];
  const err = () => { const t = E.text("#error"); if (t && !seen.includes(t)) seen.push(t); return t; };
  // A: the store says Claude or OpenAI, but no key is saved any more
  const files = {}; files[makeEnv().path.store] = JSON.stringify({ savedAt: 1, presets: [], triggers: [], settings: { engine: "openai", instructions: "Count the cars." } });
  await boot({ files });
  console.log("A no key: analyze with", E.$("#engine").value, "| options:", E.$$("#engine option").length, "| hint:", E.text("#aiStatus").slice(0, 60));
  E.finish(); await p;
  // B: camera refused, then a WebView without the camera API
  await boot({ kc: KEY, cameraDenied: true });
  E.tap("#toggle"); await until(() => err(), 4000, "camera error");
  console.log("B camera refused:", err(), "| status:", E.text("#status"), "| still on:", E.$(".tabs [aria-selected=true]").textContent);
  E.finish(); await p;
  await boot({ kc: KEY, noCamera: true });
  E.tap("#toggle"); await until(() => err(), 4000, "camera error");
  console.log("  no camera API:", err());
  E.finish(); await p;
  // C: a bad key: the first reply is an authentication error and the session stops instead of retrying every photo
  await boot({ kc: KEY, aiError: { status: 401, message: "invalid x-api-key" } });
  E.type("#interval", "2"); E.tap("#toggle");
  await until(() => /stopped the session/.test(err() || ""), 6000, "fatal");
  await wait(2500);
  console.log("C bad key:", err(), "| requests:", E.log.ai.length, "| saved session:", (E.json(E.path.index) || []).length);
  E.finish(); await p;
  // D: the provider is overloaded once: that photo isn't analyzed, the next one is
  await boot({ kc: KEY, aiError: (kind, n) => (n === 1 ? { status: 529, message: "Overloaded" } : null) });
  E.type("#interval", "2"); E.tap("#toggle");
  await until(() => E.log.ai.length >= 2 && /2 different|1 different/.test(E.text("#summary") || ""), 8000, "recovery");
  console.log("D overloaded once:", (E.log.jsErrors ? "" : "") + (E.text("#frames") + " " + E.text("#lastCap")).match(/wasn.t analyzed|Overloaded|Analyzed #\d+/g).join(", "), "| summary:", E.text("#summary"), "| error cleared:", !err() || E.$("#error").classList.contains("hidden"));
  E.tap("#hStop"); await wait(500);
  console.log("  stats saved: failed", (E.json(E.path.sessions + "/" + E.json(E.path.index)[0].id + ".json") || {}).rows ? "in report" : "-", "| report:", (E.text("#sesDetail").match(/Requests? sent\d+|Failed\d+|not analyzed\d*/gi) || []).join(", ") || E.text("#sesDetail").slice(0, 80));
  E.finish(); await p;
  // E: no internet: the photo isn't analyzed and the update check stays quiet
  await boot({ kc: KEY, offline: true });
  E.type("#interval", "2"); E.tap("#toggle");
  await until(() => /wasn.t analyzed/.test(err() || ""), 6000, "offline error");
  await wait(600);
  console.log("E offline:", err().slice(0, 110), "| update offer:", !!E.$("#upd"));
  E.tap("#hStop"); await wait(300);
  E.finish(); await p;
  if (seen.some((m) => /\.\./.test(m))) errors.push("an error message with \"..\": " + seen.find((m) => /\.\./.test(m)));
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
