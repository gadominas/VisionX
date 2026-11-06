// The debug log: each photo with what was sent and what came back (as received and as understood), replies in
// other shapes (fenced JSON, the labelled format, plain text shown as the summary), "Photos kept in Debug",
// and Copy as JSON without the photos, live and from a saved session.
const { run, wait, until } = require("../harness");
const REPLIES = {
  2: "```json\n{\"frame\": \"Photo 2: two people.\", \"state\": {\"people\": 2}, \"summary\": \"Two people so far.\"}\n```",
  3: "**FRAME:** Photo 3: three people.\n**SUMMARY:** Three people so far.\n**STATE:** {\"people\": 3}",
  4: "I can see some people, but I'm not sure how many.",
};
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const settings = { usageAsked: true, cfg: { debugKeep: 5 } };
  const files = {}; files[require("../harness").makeEnv().path.settings] = JSON.stringify(settings);
  const { E, p } = await run({ files, kc: { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" }, ai: (kind, req, n) => (/^analysis/.test(kind) ? REPLIES[n] : undefined) });
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  E.type("#startMode", "manual");
  E.tap("#toggle"); await until(() => !E.$("#capBtn").disabled, 5000, "capture ready");
  const summaries = [];
  for (let i = 1; i <= 6; i++) { E.tap("#capBtn"); await until(() => E.log.ai.length >= i && /All \d+ analyzed/.test(E.text("#capTxt")), 5000, "photo " + i); await wait(40); summaries.push(E.text("#summary")); }
  console.log("A summaries after each photo:", summaries.map((s) => JSON.stringify(s.slice(0, 32))).join(" → "));
  console.log("  plain-text reply note:", (E.log.ai.length && E.text("#frames")) ? (E.text("#frames").match(/The reply didn.t follow the expected format[^.]*\./) || ["(not on screen)"])[0] : "-");
  E.$("#debugBox").open = true;
  console.log("B debug:", E.text("#debugCount"), "| entries:", E.$$("#debugList details.dbg .dbgText b").map((b) => b.textContent.replace(/ at .*/, "")).join(","), "| statuses:", E.$$("#debugList .dbgStatus").map((s) => s.textContent).join(","));
  const open = (n) => { const d = E.$$("#debugList details.dbg").find((x) => x.dataset.id === "d-" + n); d.open = true; d.dispatchEvent(new (E.win().Event)("toggle")); return d; };
  const d3 = open(3);
  console.log("C photo #3 sections:", [...d3.querySelectorAll("h3")].map((h) => h.textContent).join(" / "));
  console.log("  as received:", d3.querySelectorAll("pre")[d3.querySelectorAll("pre").length - 2].textContent.slice(0, 40).replace(/\n/g, "⏎"), "| as understood:", JSON.parse(d3.querySelectorAll("pre")[d3.querySelectorAll("pre").length - 1].textContent).summary);
  const ov = JSON.parse(d3.querySelector("pre").textContent);
  console.log("  overview:", JSON.stringify({ engine: ov.engine, model: ov.model, mode: ov.summary_mode, photo: ov.photo, tokens: ov.usage && ov.usage.total_tokens }));
  console.log("  JSON highlighted:", d3.querySelectorAll("pre .jk").length > 0, "| request settings:", JSON.stringify(JSON.parse([...d3.querySelectorAll("pre")][3].textContent)).slice(0, 110));
  E.tap("#debugCopy"); await until(() => E.log.pasteboard.length, 3000, "copy");
  const copied = JSON.parse(E.log.pasteboard[E.log.pasteboard.length - 1]);
  console.log("D Copy as JSON:", copied.length, "entries | keys:", Object.keys(copied[0]).join(","), "| photo bytes in it:", /base64/.test(E.log.pasteboard[E.log.pasteboard.length - 1]), "| hint:", E.text("#debugHint"));
  E.tap("#hStop");
  await until(() => (E.json(E.path.index) || []).length, 6000, "saved");
  await until(() => E.$("#sesDetail .presetBar .chip"), 3000, "report");
  const btn = [...E.$("#sesDetail").querySelectorAll(".chip")].find((b) => b.textContent === "Copy as JSON");
  E.tap(btn); await wait(200);
  console.log("E from the saved session:", E.text("#sesDetail .dbgList").length > 0, "| copied", JSON.parse(E.log.pasteboard[E.log.pasteboard.length - 1]).length, "entries | hint:", btn.parentNode.nextSibling.textContent);
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
