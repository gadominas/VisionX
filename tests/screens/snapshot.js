#!/usr/bin/env node
// Smoke screenshots, step 1 (see docs/TESTING.md): drives the real VisionX.js through the harness with sample data and
// saves each screen as static HTML (scripts removed) in <tmp>/visionx-screens/html, or $VISIONX_TMP/html.
// These are a visual check of the real page, not the README cards (those come from app-blueprints/repo-site).
const fs = require("fs"), os = require("os"), path = require("path");
const { run, wait, until, makeEnv } = require("../harness");
const TMP = process.env.VISIONX_TMP || path.join(os.tmpdir(), "visionx-screens");
const OUT = path.join(TMP, "html");
fs.mkdirSync(OUT, { recursive: true });
const P = makeEnv().path;
const KEY = { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" };
const STORE = { savedAt: 1, presets: [{ id: "p-gate", name: "Gate: read plates", text: "Read the license plate of any car at the gate." }, { id: "p-count", name: "Count cars and plates", text: "Count the different vehicles that enter and list their plates by type." }],
  settings: { activePreset: "p-count", instructions: "Count the different vehicles that enter and list their plates by type.", engine: "openai", accumulate: true, startMode: "manual", interval: 10 },
  triggers: [{ id: "t-van", enabled: true, name: "Delivery van", condition: "A delivery van has entered", shortcut: "Notify Reception", every: 30, when: "photo", mode: "new", send: "summary", message: "" },
    { id: "t-full", enabled: false, name: "Lot is full", condition: "More than 40 vehicles have entered", shortcut: "Lot Full Sign", every: 30, when: "photo", mode: "rise", send: "custom", message: "Lot full at {time}" }] };
const SUMMARY = (n) => "**" + n + " vehicles** so far: " + Math.ceil(n / 2) + " cars, " + Math.floor(n / 2) + " vans.\n\n| Plate | Type |\n|---|---|\n| KXA 482 | car |\n| BTR 907 | van |";
const REL = { releases: [{ version: "9.0.0", title: "Sharper photos", highlights: [{ icon: "📷", title: "Sharper photos", text: "Photos are clearer in low light." }, { icon: "⚡", title: "Faster triggers", text: "Shortcuts run sooner after a match." }, { icon: "🗂", title: "Sessions kept longer", text: "Keep up to 20 finished sessions." }] }] };

function save(E, name, scrollTo) {
  // Form state lives in properties, not attributes: write it into the markup so the static copy shows it
  E.$$("input, textarea, select").forEach((n) => {
    if (n.type === "checkbox") n.toggleAttribute("checked", n.checked);
    else if (n.tagName === "TEXTAREA") n.textContent = n.value;
    else if (n.tagName === "SELECT") [...n.options].forEach((o) => o.toggleAttribute("selected", o.selected));
    else n.setAttribute("value", n.value);
  });
  const d = E.doc().documentElement.cloneNode(true);
  if (scrollTo) d.setAttribute("data-shot-scroll", scrollTo);
  d.querySelectorAll("script").forEach((s) => s.remove());
  const sp = d.querySelector("#splash"); if (sp && name !== "00-launch") sp.remove();
  fs.writeFileSync(path.join(OUT, name + ".html"), "<!doctype html>\n" + d.outerHTML);
  console.log("  " + name);
}
(async () => {
  const files = {}; files[P.store] = JSON.stringify(STORE); files[P.settings] = JSON.stringify({ usageAsked: true });
  let { E, p } = await run({ files, kc: KEY, ai: (kind, req, n) => (/^analysis/.test(kind) ? JSON.stringify({ frame: "Photo " + n + ": a van with plate BTR 907 enters.", state: { vehicles: n }, summary: SUMMARY(n) }) : undefined) });
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  save(E, "00-launch");
  await wait(3000);
  save(E, "01-setup");
  E.tap("#tab-triggers"); await wait(50); save(E, "02-triggers");
  E.tap("#toggle"); await until(() => !E.$("#capBtn").disabled, 5000, "session");
  for (let i = 1; i <= 3; i++) { E.tap("#capBtn"); await until(() => E.log.ai.filter((r) => /^analysis/.test(r.kind)).length >= i && /All \d+ analyzed/.test(E.text("#capTxt")), 5000, "photo"); }
  await wait(200); save(E, "03-live");
  E.$("#debugBox").open = true; const d = E.$("#debugList details.dbg"); d.open = true; d.dispatchEvent(new (E.win().Event)("toggle")); await wait(50);
  save(E, "04-debug", "#debugBox");
  const t0 = Date.now();
  E.tap("#hStop"); await until(() => ((E.json(P.index) || [])[0] || {}).endedAt >= t0, 6000, "saved"); await wait(200);
  save(E, "05-report");
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings"); save(E, "06-settings");
  E.tap('#cfgsheet [data-act="ai-open"]'); await until(() => E.$("#aisheet .aicard"), 3000, "AI"); save(E, "07-ai-settings");
  E.finish(); await p;
  ({ E, p } = await run({ files: E.files, kc: E.kc, releases: REL }));
  await until(() => E.$("#upd"), 5000, "update"); await wait(100); save(E, "08-update");
  E.finish(); await p;
  ({ E, p } = await run({ files: E.files, kc: E.kc, dark: true }));
  await until(() => E.win() && E.win().__booted, 5000, "boot"); await wait(3000);
  E.tap("#tab-sessions"); await wait(50); save(E, "09-sessions-dark");
  E.finish(); await p;
  // The widgets, as the trees the script handed to Script.setWidget
  const trees = {};
  for (const fam of ["small", "medium", "large"]) { const r = await run({ files: E.files, widget: fam }); await r.p; trees[fam] = JSON.parse(JSON.stringify(r.E.log.widgets[0])); }
  fs.writeFileSync(path.join(TMP, "widgets.json"), JSON.stringify(trees));
  console.log("  widgets.json");
  console.log("Saved in " + TMP);
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
