// Saved sessions: each finished session is saved on the phone with its photos, the Sessions tab lists them,
// a report opens from its card, the bin deletes with two taps, only "Sessions kept" (3) are kept, and a damaged
// index doesn't lose the sessions that are still on the phone.
const { run, wait, until } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const kc = { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" };
  let E, p, files = {};
  const boot = async (o) => { ({ E, p } = await run(Object.assign({ files, kc }, o))); p.catch((e) => errors.push("SCRIPT " + e.stack)); await until(() => E.win() && E.win().__booted, 5000, "boot"); files = E.files; };
  const session = async (photos, preset) => {
    if (preset) E.type("#preset", preset);
    E.type("#startMode", "manual");
    E.tap("#toggle"); await until(() => !E.$("#capBtn").disabled, 5000, "capture ready");
    const n = E.log.ai.length;
    for (let i = 0; i < photos; i++) { E.tap("#capBtn"); await wait(10); }
    await until(() => E.log.ai.length === n + photos && /All \d+ analyzed/.test(E.text("#capTxt")), 6000, "photos");
    const t0 = Date.now();
    E.tap("#hStop"); await until(() => ((E.json(E.path.index) || [])[0] || {}).endedAt >= t0 && !E.$("#sesDetail").classList.contains("hidden"), 6000, "saved session");
    await wait(30);
  };
  const ids = () => (E.json(E.path.index) || []).map((m) => m.photos + "p");
  const onPhone = () => Object.keys(files).filter((f) => /\/VisionX-sessions\/s-[\w-]+\.json$/.test(f)).length;
  await boot({});
  E.tap("#tab-sessions"); await wait(20);
  console.log("A none yet:", E.text("#sesList .sesEmpty"));
  await session(1, "p-people"); await session(2, "p-objects"); await session(3);
  console.log("B three sessions (newest first):", ids().join(", "), "| files on the phone:", onPhone(), "| report after stop:", E.text("#sesDetail").slice(0, 60));
  await session(4);
  console.log("C a fourth: kept", ids().join(", "), "| files:", onPhone(), "(the oldest is deleted)");
  E.tap("#sesDetail .repTop .chip"); await wait(30);
  console.log("D list:", E.$$("#sesList .sesCard").map((c) => c.querySelector(".m").textContent).join(" || "), "| thumbnails:", E.$$("#sesList .sesCard img").length);
  E.tap(E.$$("#sesList .sesCard")[1]); await until(() => !E.$("#sesDetail").classList.contains("hidden"), 3000, "report");
  console.log("E report:", [...E.$("#sesDetail").querySelectorAll("h2,h3")].map((h) => h.textContent.trim()).filter(Boolean).slice(0, 8).join(" / "));
  E.tap("#sesDetail .repTop .chip"); await wait(30);
  const bin = E.$$("#sesList .sesDel")[2];
  E.tap(bin); await wait(10);
  console.log("F bin, first tap:", bin.textContent, "| aria:", bin.getAttribute("aria-label"));
  E.tap(bin); await until(() => E.$$("#sesList .sesCard").length === 2, 3000, "delete");
  console.log("  second tap: left", ids().join(", "), "| files:", onPhone(), "| Sessions tab:", E.text("#tab-sessions"));
  E.tap(E.$$("#sesList .sesDel")[0]); await wait(3300);
  console.log("  one tap, then 3 s: not deleted, disarmed:", E.$$("#sesList .sesCard").length === 2 && !E.$$("#sesList .sesDel")[0].classList.contains("armed"));
  E.finish(); await p;

  // A damaged index.json: the sessions still on the phone must not disappear from the list for good
  const before = ids().length;
  files[E.path.index] = "[{\"id\":";
  await boot({});
  E.tap("#tab-sessions"); await wait(20);
  const listed = E.$$("#sesList .sesCard").length, kept = Object.keys(files).some((f) => /index\.broken-\d+\.json$/.test(f));
  console.log("G damaged index: sessions listed", listed, "of", before, "on the phone | copy kept:", kept, "| toast:", E.text("#aitoast") || "-", "| index saved again:", Array.isArray(E.json(E.path.index)));
  if (listed !== before || !kept) errors.push("a damaged sessions index lost the saved sessions");
  await session(1);
  console.log("  after the next session: listed", ids().length, "| session files on the phone:", onPhone());
  if (ids().length !== onPhone()) errors.push("sessions on the phone that the list doesn't show");
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
