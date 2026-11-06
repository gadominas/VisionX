// Apple Intelligence through Shortcuts, with no API key: the "Vision Session AI" shortcut takes the photo and answers
// in the labelled format, VisionX reads the photo from the clipboard (and clears it), triggers are checked with
// "Vision Session Check", "Show each photo here" off never reads the clipboard, and a missing shortcut stops the session.
const { run, wait, until, makeEnv } = require("../harness");
const STORE = { savedAt: 1, presets: [], settings: { instructions: "Count the people at the bench.", engine: "apple", accumulate: true, startMode: "auto", interval: 2 },
  triggers: [{ id: "t-bench", enabled: true, name: "Someone at the bench", condition: "Someone is at the bench", shortcut: "Notify Me", every: 30, when: "photo", mode: "rise", send: "summary", message: "" }] };
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const files = {}; files[makeEnv().path.store] = JSON.stringify(STORE);
  let { E, p } = await run({ files });
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("A no key: analyze with", E.$$("#engine option").map((o) => o.value).join(","), "| shortcut:", E.$("#shortcut").value, "| live preview hidden:", E.$("#liveWrap").classList.contains("hidden"), "| checker box:", !E.$("#checkBox").classList.contains("hidden"));
  E.tap("#toggle");
  await until(() => E.log.callbacks.filter((c) => /^You analyze/.test(c.text)).length >= 2, 8000, "two photos");
  await wait(300);
  const c1 = E.log.callbacks.find((c) => /^You analyze/.test(c.text));
  console.log("B shortcut run:", c1.url, "name", c1.name, "| labelled format asked:", /FRAME: [\s\S]*SUMMARY: [\s\S]*STATE: /.test(c1.text), "| photo attached note:", /The photo for this frame is attached\./.test(c1.text));
  console.log("  no camera opened:", E.log.camera.length === 0, "| clipboard cleared before and after:", E.log.pasteboard.filter((t) => t === "").length >= 2, "| clipboard read:", E.log.pasteImage);
  console.log("C summary:", E.text("#summary"), "| by:", E.text("#summaryBy"), "| photo shown:", !!E.$("#lastPhoto img") || !!E.$("#frames img"), "| tokens:", E.text("#sTok"));
  const checks = E.log.callbacks.filter((c) => c.name === "Vision Session Check");
  console.log("D trigger checked with", checks.length ? "Vision Session Check" : "-", "| ran:", E.log.shortcutsRun.map((s) => s.name).join(", "), "| no cloud requests:", E.log.ai.length === 0);
  E.tap("#hStop");
  await until(() => !E.$("#sesDetail").classList.contains("hidden"), 6000, "report");
  console.log("E saved engine:", E.json(E.path.index)[0].engine, "| photos:", E.json(E.path.index)[0].photos);
  E.tap("#tab-setup"); await wait(20);
  E.tap("#applePhotos"); await wait(20);
  const reads = E.log.pasteImage;
  E.tap("#toggle");
  await until(() => E.log.callbacks.filter((c) => /^You analyze/.test(c.text)).length >= 4, 8000, "photos without showing");
  await wait(200);
  console.log("F 'Show each photo here' off: clipboard reads", E.log.pasteImage - reads, "| photos still counted:", E.text("#sPhotos"), "| summary:", E.text("#summary"));
  E.tap("#hStop");
  await until(() => !E.$("#sesDetail").classList.contains("hidden"), 6000, "report");
  E.finish(); await p;
  // The shortcut doesn't exist: the session stops at once with what to do
  ({ E, p } = await run({ files: E.files, shortcuts: { "Vision Session AI": "fail" } }));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  E.tap("#toggle");
  await until(() => /stopped the session/.test(E.text("#error") || ""), 8000, "fatal error");
  await wait(300);
  console.log("G missing shortcut:", E.text("#error").slice(0, 150), "| running:", E.$(".tabs [aria-selected=true]").textContent);
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
