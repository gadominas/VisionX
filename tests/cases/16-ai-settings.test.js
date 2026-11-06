// AI settings (app-blueprints ai-configuration 1.0.0): add a key in a native secure prompt, the model list, a
// connection test, choosing a model, a second provider, switching "In use", removing with two taps, resetting
// usage; keys appear only masked and never reach the page or a file; the old 1.7 key is moved on start;
// the sheet can't be opened during a session.
const { run, wait, until } = require("../harness");
const AKEY = "sk-ant-api03-ABCDEFGHIJKLMNOP1234", OKEY = "sk-proj-QRSTUVWXYZ0000005678";
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let { E, p } = await run({});
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  const ais = () => E.$("#aisheet");
  const toast = () => E.text("#aitoast");
  const act = (a, v) => E.tap(ais().querySelector('[data-aiact="' + a + '"]' + (v ? '[data-v="' + v + '"]' : "")));
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  console.log("A AI row:", E.text("#s-aistatus"));
  E.tap('#cfgsheet [data-act="ai-open"]'); await until(() => ais() && ais().querySelector(".aicard"), 3000, "AI sheet");
  console.log("  sheet:", [...ais().querySelectorAll(".aicard .aic-h b, h3.sec")].map((h) => h.textContent).join(" / "), "| keys:", [...ais().querySelectorAll(".aic-row")].filter((r) => /API key/.test(r.textContent)).map((r) => r.textContent.replace("API key", "")).join(", "));
  E.log.pushAlert({ cancel: true });
  act("aikey", "anthropic"); await wait(300);
  console.log("B cancelled prompt: saved", "VISIONX_ANTHROPIC_KEY" in E.kc, "| prompt:", E.log.alerts[0].title, "/", E.log.alerts[0].actions.join(","));
  E.log.pushAlert(["  " + AKEY + "  "]);
  act("aikey", "anthropic"); await until(() => /key saved/.test(toast() || ""), 3000, "key saved");
  console.log("C key added:", toast(), "| stored trimmed:", E.kc.VISIONX_ANTHROPIC_KEY === AKEY, "| shown:", ais().querySelector(".aicard.active code").textContent, "| models:", [...ais().querySelectorAll("#ms-anthropic option")].map((o) => o.value).join(","));
  console.log("  Setup now offers:", E.$$("#engine option").map((o) => o.textContent).join(" | "), "| AI row:", E.text("#s-aistatus"));
  act("aitest", "anthropic"); await until(() => /works/.test(toast() || ""), 3000, "test");
  console.log("D test:", toast().replace(/[\d.]+ s$/, "… s"), "| request:", E.log.ai[0].kind, "max_tokens", E.log.ai[0].maxTokens);
  const sel = ais().querySelector("#ms-anthropic"); sel.value = "claude-sonnet-5-5"; sel.dispatchEvent(new (E.win().Event)("change", { bubbles: true }));
  await until(() => /now uses/.test(toast() || ""), 3000, "model");
  console.log("  model:", toast(), "| saved:", JSON.stringify(E.json(E.path.aiSettings).model));
  E.log.pushAlert([OKEY]);
  act("aikey", "openai"); await until(() => /OpenAI key saved/.test(toast() || ""), 3000, "openai key");
  console.log("E OpenAI added:", toast(), "| models (text only):", [...ais().querySelectorAll("#ms-openai option")].map((o) => o.value).join(","), "| in use:", E.text("#aisheet .aicard.active b"));
  act("aiprov", "openai"); await until(() => E.text("#aisheet .aicard.active b") === "OpenAI", 3000, "switch");
  console.log("  switched: in use", E.text("#aisheet .aicard.active b"), "| first card:", E.text("#aisheet .aicard b"), "| Setup:", E.$("#engine").selectedOptions[0].textContent);
  act("airm", "anthropic"); await wait(20);
  console.log("F remove, first tap:", ais().querySelector('[data-aiact="airm"][data-v="anthropic"]').textContent, "| still saved:", "VISIONX_ANTHROPIC_KEY" in E.kc);
  act("airm", "anthropic"); await until(() => !("VISIONX_ANTHROPIC_KEY" in E.kc), 3000, "removed");
  console.log("  second tap:", toast(), "| in use:", E.text("#aisheet .aicard.active b"));
  console.log("G token usage:", E.text("#aisheet .sh-body").match(/Token usage.{0,80}/)[0]);
  act("usagereset"); await wait(10); act("usagereset"); await until(() => /reset/.test(toast() || ""), 3000, "reset");
  console.log("  reset:", toast(), "| calls now:", JSON.stringify(E.json(E.path.usage).p));
  const html = E.doc().documentElement.outerHTML;
  console.log("H keys in the page:", html.includes(AKEY) || html.includes(OKEY), "| in any file:", Object.values(E.files).some((v) => String(v).includes(OKEY) || String(v).includes(AKEY)), "| sent only to their own provider:", E.log.requests.every((r) => !String(JSON.stringify(r.headers)).includes(OKEY) || /openai\.com/.test(r.url)));
  act("aiclose"); await wait(20);
  E.finish(); await p;
  // A key from VisionX 1.7 (another Keychain name) is moved on start
  ({ E, p } = await run({ kc: { vision_session_openai_key: OKEY, vision_session_openai_key_skipped: "1" } }));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("I 1.7 key migrated:", JSON.stringify(Object.keys(E.kc)), "| in use:", E.json(E.path.aiSettings).aiProvider);
  // During a session the AI settings button is disabled
  E.tap("#toggle"); await until(() => E.log.ai.length, 5000, "session");
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  console.log("J during a session:", E.$('#cfgsheet [data-act="ai-open"]').disabled, "|", E.text("#cfgsheet .srow small.muted"));
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
