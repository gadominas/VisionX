// Settings (app-blueprints settings 1.1.2): the sections in order, Appearance applied at once and saved,
// tunables stepped, typed (and clamped), reset one by one or all with two taps, the Capture values reaching the
// page live, Built with opening only the blueprints repository, and a setting the page may not change.
const { run, wait, until } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let { E, p } = await run({});
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  const sheet = () => E.$("#cfgsheet");
  const saved = () => E.json(E.path.settings) || {};
  const settle = async (fn) => { await until(fn, 3000, "settings answer"); await wait(20); };
  E.tap("#cfgOpen"); await settle(() => E.$("#cfgsheet.open"));
  console.log("A sections:", [...sheet().querySelectorAll("h3.sec")].map((h) => h.textContent).join(" / "));
  console.log("  appearance choices:", [...sheet().querySelectorAll('[data-act="look"]')].map((b) => b.dataset.k + ":" + b.textContent.trim()).join(", ").slice(0, 200));
  for (const [k, v] of [["theme", "sepia"], ["density", "tiny"], ["textSize", "1.25"], ["font", "serif"]]) {
    E.tap(sheet().querySelector('[data-act="look"][data-k="' + k + '"][data-v="' + v + '"]'));
    await settle(() => String(saved()[k]) === v);
  }
  const html = E.doc().documentElement;
  console.log("B applied at once: theme", html.dataset.theme, "| font", html.dataset.font, "| text size", html.style.getPropertyValue("--ts"), "| layout class:", E.doc().body.className.match(/d-\w+/)[0]);
  console.log("  saved:", JSON.stringify(saved()).slice(0, 90));
  const cfgIn = (k) => sheet().querySelector('input.cfgin[data-k="' + k + '"]');
  E.tap(sheet().querySelector('[data-act="cfgstep"][data-k="keepSessions"][data-v="1"]'));
  await settle(() => saved().cfg && saved().cfg.keepSessions === 4);
  cfgIn("requestWait").value = "999"; cfgIn("requestWait").dispatchEvent(new (E.win().Event)("change", { bubbles: true }));
  await settle(() => saved().cfg.requestWait === 180);
  cfgIn("widgetRefreshMin").value = "22,5"; cfgIn("widgetRefreshMin").dispatchEvent(new (E.win().Event)("change", { bubbles: true }));
  await settle(() => saved().cfg.widgetRefreshMin);
  console.log("C tunables: +1 sessions →", saved().cfg.keepSessions, "| 999 s typed →", saved().cfg.requestWait, "| \"22,5\" min →", saved().cfg.widgetRefreshMin, "| footer:", E.text("#cfgsheet .cfg-foot .note"));
  console.log("  changed rows show the original:", [...sheet().querySelectorAll(".cfg.ch .range")].map((r) => r.textContent).join(" | "));
  console.log("  the page's Sessions view uses it at once:", (E.tap("#tab-sessions"), E.text("#sesList .hint")).match(/keeps the last \d+/)[0]);
  E.tap(sheet().querySelector('[data-act="cfgreset"][data-k="keepSessions"]'));
  await settle(() => !("keepSessions" in saved().cfg));
  console.log("D reset one:", JSON.stringify(saved().cfg));
  E.tap(sheet().querySelector('[data-act="cfgall"]')); await wait(20);
  console.log("  Reset all, first tap:", E.text('#cfgsheet [data-act="cfgall"]'), "| still saved:", Object.keys(saved().cfg).length);
  E.tap(sheet().querySelector('[data-act="cfgall"]'));
  await settle(() => !Object.keys(saved().cfg).length);
  console.log("  second tap:", JSON.stringify(saved().cfg), "| footer:", E.text("#cfgsheet .cfg-foot .note"));
  console.log("E Built with:", [...sheet().querySelectorAll(".srow.bp b")].map((b) => b.textContent).join(", "));
  E.tap(sheet().querySelector(".srow.bp")); await until(() => E.log.opened.length, 3000, "open link");
  console.log("  opens:", E.log.opened[0]);
  const w = E.win();
  // A crafted call from the page: anything but the blueprints repository is refused
  w.eval('document.getElementById("cfgsheet").insertAdjacentHTML("beforeend", \'<button id="evil" class="srow" data-act="openurl" data-v="https://example.com/phish">x</button>\')');
  E.tap("#evil"); await wait(300);
  console.log("F other links refused:", E.log.opened.length === 1);
  E.tap('#cfgsheet [data-act="cfgclose"]'); await wait(30);
  console.log("G Done closes:", !sheet().classList.contains("open"));
  E.finish(); await p;
  ({ E, p } = await run({ files: E.files }));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("H reopened with the saved look: theme", E.doc().documentElement.dataset.theme, "| font", E.doc().documentElement.dataset.font, "| layout", E.doc().body.className.match(/d-\w+/)[0]);
  E.finish(); await p;
  ({ E, p } = await run({ files: E.files, dark: true }));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  E.tap('#cfgsheet [data-act="look"][data-k="theme"][data-v="auto"]'); await wait(200);
  console.log("I Auto on a phone in dark mode:", E.doc().documentElement.dataset.theme);
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
