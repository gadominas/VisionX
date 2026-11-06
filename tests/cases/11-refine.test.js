// The instructions editor and Refine with AI: Expand, Clearer (and your own request), the suggestion with Use this /
// Keep mine, Undo refine, ✨ Make it visual, Done and Cancel; then refining with Apple Intelligence without a key.
const { run, wait, until, makeEnv } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let { E, p } = await run({ kc: { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" } });
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  const original = E.$("#instructions").value;
  E.tap("#iExpand"); await wait(20);
  console.log("A editor open:", !E.$("#editor").classList.contains("hidden"), "| title:", E.text("#edTitle"), "| preset:", E.text("#edSub"), "| count:", E.text("#edCount"));
  E.$("#edAsk").value = "also note clothing colours";
  E.tap('#editor [data-ask^="Make it clearer"]');
  await until(() => !E.$("#edSuggest").classList.contains("hidden"), 4000, "suggestion");
  const r = E.log.ai[0];
  console.log("B request: kind", r.kind, "| asked:", (r.text.match(/REQUESTED CHANGE:\n([^\n]*)/) || [])[1], "| current text in it:", r.text.includes("CURRENT INSTRUCTIONS:\n" + original), "| build-up wording:", /merged into one running summary/.test(r.text));
  console.log("  suggestion:", E.text("#edProposal").slice(-50), "| why:", E.text("#edWhy"));
  E.tap("#edUse"); await wait(20);
  console.log("C Use this: text now ends", JSON.stringify(E.$("#edText").value.slice(-30)), "| Undo shown:", !E.$("#edUndo").classList.contains("hidden"), "| status:", E.text("#edStatus"));
  E.tap("#edUndo"); await wait(20);
  console.log("  Undo refine: back to the original", E.$("#edText").value === original, "|", E.text("#edStatus"));
  E.tap("#edVisual");
  await until(() => !E.$("#edSuggest").classList.contains("hidden"), 4000, "visual suggestion");
  console.log("D Make it visual: asked for visuals", /visually compelling/.test(E.log.ai[1].text), "| visual guide included:", /Use only these visuals/.test(E.log.ai[1].text), "| suggestion:", E.text("#edProposal").slice(-60));
  E.tap("#edKeep"); await wait(20);
  console.log("  Keep mine: suggestion hidden", E.$("#edSuggest").classList.contains("hidden"), "| text unchanged", E.$("#edText").value === original);
  E.tap('#editor [data-ask^="Make it shorter"]'); await until(() => !E.$("#edSuggest").classList.contains("hidden"), 4000, "suggestion");
  E.tap("#edUse"); E.tap("#edDone"); await wait(50);
  console.log("E Done: editor closed", E.$("#editor").classList.contains("hidden"), "| instructions:", E.$("#instructions").value.slice(-45), "| preset hint:", E.text("#pHint"));
  E.tap("#iExpand"); await wait(10); E.$("#edText").value = "Something else entirely"; E.tap("#edCancel"); await wait(20);
  console.log("  Cancel keeps the old text:", /ignore reflections\.$/.test(E.$("#instructions").value));
  E.tap("#iExpand"); await wait(10); E.$("#edText").value = "  "; E.tap("#edGo"); await wait(20);
  console.log("F empty text:", E.text("#edStatus"), "| no request:", E.log.ai.length === 3);
  E.tap("#edCancel");
  console.log("  token usage feature:", Object.keys(E.json(E.path.usage).p.anthropic.features).join(","));
  E.finish(); await p;
  // Without a key, with Apple Intelligence: refining goes through "Vision Session Check"
  ({ E, p } = await run({}));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  E.tap("#iRefine"); await wait(10);
  E.tap('#editor [data-ask^="Make it more specific"]');
  await until(() => !E.$("#edSuggest").classList.contains("hidden"), 4000, "apple suggestion");
  console.log("G Apple Intelligence: ran", E.log.callbacks.map((c) => c.name).join(","), "| why:", E.text("#edWhy"), "| no cloud request:", E.log.ai.length === 0);
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
