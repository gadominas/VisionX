// First start on a new phone: the empty window, the launch screen, the page booting from handed-over data,
// the seeded presets, the usage question and what is saved on close.
const { run, wait, until } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const { E, p } = await run({});
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  const w = E.win();
  console.log("A windows:", E.log.windows.map((x) => (x.real ? "page @" + x.base : "empty")).join(" → "), "| presented:", E.log.presented, "| booted:", w.__booted, "| placeholder gone:", !E.$(".booting"));
  console.log("  launch screen:", !!E.$("#splash"), "gone yet:", E.$("#splash").classList.contains("gone"));
  await wait(3000);
  console.log("  after 3 s, launch screen gone:", E.$("#splash").classList.contains("gone"));
  console.log("B tabs:", E.$$(".tabs [role=tab]").map((t) => t.textContent.trim()).join(" | "), "| selected:", E.$(".tabs [aria-selected=true]").textContent, "| status:", E.text("#status"));
  console.log("  presets:", E.$$("#preset option").map((o) => o.textContent).join(" | "), "| instructions:", E.$("#instructions").value.slice(0, 50) + "…");
  console.log("  analyze with:", E.$$("#engine option").map((o) => o.value + "=" + o.textContent.trim()).join(", "), "→", E.$("#engine").value, "| AI hint:", E.text("#aiStatus").slice(0, 70));
  console.log("  interval:", E.$("#interval").value, "| start in:", E.$("#startMode").value, "| build up:", E.$("#accumulate").checked, "| version line:", E.text("#verLine"));
  console.log("C usage question:", E.text("#usageask b"), "| Sessions tab:", E.text("#tab-sessions"));
  E.tap('#usageask [data-ua="0"]'); await wait(200);
  console.log("  after No thanks: card gone", !E.$("#usageask"), "| settings:", JSON.stringify((E.json(E.path.settings) || {})).slice(0, 120), "| PostHog calls:", E.log.posthog.length);
  E.tap("#tab-sessions"); await wait(50);
  console.log("D Sessions view:", E.text("#sesList").slice(0, 120));
  await wait(400);   // the update check (3.5 s at a tenth of the time) and the widget icon (6 s)
  console.log("E deferred work: update check", E.log.requests.some((r) => /releases\.json/.test(r.url)), "| widget icon cached", Object.keys(E.files).some((f) => /visionx-widget-icon-/.test(f)), "| offer shown:", !!E.$("#upd"));
  console.log("  start-up log:", E.files[E.path.startLog].split("\n").map((l) => l.slice(10)).join(" / "));
  console.log("  lock held while open:", E.path.lock in E.files);
  E.finish(); await p;
  const st = E.json(E.path.store);
  console.log("F on close: presets", st.presets.map((x) => x.name).join(", "), "| engine", st.settings.engine, "| triggers", st.triggers.length, "| lock released:", !(E.path.lock in E.files), "| Script.complete:", !!E.log.completed);
  console.log("  keys anywhere in files:", Object.values(E.files).some((v) => /sk-ant|sk-proj/.test(String(v))), "| WebViews built:", E.log.webviews);
  const all = errors.concat(E.problems());
  console.log("errors:", all.length ? all.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
