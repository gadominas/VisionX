// Safe start-up (app-blueprints recipe safe-startup 1.1.0): iCloud that never delivers, a file that can't be read,
// damaged files (copied aside, then saved normally), a page whose load never finishes, two windows at once,
// and the start-up log in Settings.
const { run, wait, until } = require("../harness");
const STORE = { savedAt: 1, settings: { instructions: "Count the boxes on the shelf.", interval: 15, engine: "apple" }, presets: [{ id: "p-box", name: "Boxes", text: "Count the boxes on the shelf." }], triggers: [] };
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const watch = (r) => { r.p.catch((e) => errors.push("SCRIPT " + e.stack)); return r; };
  const boot = (E) => until(() => E.win() && E.win().__booted, 6000, "boot");
  let E, p;
  const seed = () => {
    const f = {};
    const { E: e0 } = { E: require("../harness").makeEnv({}) };
    f[e0.path.settings] = JSON.stringify({ theme: "sepia", density: "compact", usageAsked: true });
    f[e0.path.store] = JSON.stringify(STORE);
    f[e0.path.usage] = JSON.stringify({ since: 1, p: { anthropic: { calls: 2, in: 10, out: 5, models: {}, features: {}, days: {} } } });
    return f;
  };

  // A: iCloud never delivers settings.json: the app opens within the time limit with defaults and never saves over it
  ({ E, p } = watch(await run({ files: seed(), slowCloud: "VisionX/settings.json" })));
  const before = E.files[E.path.settings];
  await boot(E);
  console.log("A slow iCloud: booted", E.win().__booted, "| theme shown:", E.doc().documentElement.dataset.theme, "| log:", (E.files[E.path.startLog].match(/iCloud didn't deliver[^\n]*/) || ["-"])[0]);
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  E.tap('#cfgsheet [data-act="look"][data-k="theme"][data-v="night"]'); await wait(300);
  E.finish(); await p;
  console.log("  settings.json untouched after a change:", E.files[E.path.settings] === before, "| presets kept:", E.json(E.path.store).presets[0].name);

  // B: vision-session.json can't be read: the app opens, says so, and saves nothing over it
  let files = seed();
  ({ E, p } = watch(await run({ files, unreadable: "vision-session.json" })));
  await boot(E); await wait(1200);
  console.log("B unreadable store: toast:", E.text("#toast") || E.text("#aitoast"), "| presets on screen:", E.$$("#preset option").map((o) => o.textContent).join(", "));
  E.type("#instructions", "Count the cats."); await wait(1000);
  E.finish(); await p;
  console.log("  store untouched:", E.files[E.path.store] === JSON.stringify(STORE), "| usage untouched:", JSON.parse(E.files[E.path.usage]).p.anthropic.calls === 2, "| log:", (E.files[E.path.startLog].match(/Couldn't read [^\n]*/) || ["-"])[0]);

  // C: damaged files: copied aside once, started fresh, and saving carries on
  files = seed();
  files[E.path.store] = "{oops";
  files[E.path.usage] = "not json";
  files[E.path.settings] = "{\"theme\": ";
  ({ E, p } = watch(await run({ files })));
  await boot(E); await wait(400);
  const broken = () => Object.keys(E.files).filter((f) => /\.broken-\d+\.json$/.test(f)).map((f) => f.split("/").slice(-2).join("/"));
  console.log("C damaged: toast:", E.text("#toast") || E.text("#aitoast"), "| copies:", broken().join(", "));
  console.log("  copies hold the old text:", Object.keys(E.files).filter((f) => /vision-session\.broken-/.test(f)).map((f) => E.files[f]).join(), "| presets on screen:", E.$$("#preset option").length - 1);
  E.type("#instructions", "Count the dogs."); await wait(1200);
  console.log("  settings.json stays as it is until something changes:", E.files[E.path.settings]);
  E.tap('#usageask [data-ua="0"]'); await wait(300);
  E.finish(); await p;
  console.log("  saved again: store", E.json(E.path.store).settings.instructions, "| settings after a change:", JSON.stringify(E.json(E.path.settings)).slice(0, 60));
  const copies = broken().length;
  ({ E, p } = watch(await run({ files: Object.assign(E.files, { [E.path.store]: "{oops" }), widget: "medium" }))); await p;
  ({ E, p } = watch(await run({ files: E.files, widget: "medium" }))); await p;
  console.log("  same damage seen by two widget runs: copies", copies, "→", broken().length, "(a damage already kept is not copied again)");

  // D: the page runs but its load never finishes (the blank-window case): the app still boots after the time limit
  ({ E, p } = watch(await run({ files: seed(), hangPage: true })));
  const t0 = Date.now();
  await boot(E);
  console.log("D page load never finishes: booted after", Math.round((Date.now() - t0) / 100) / 10, "s | presets:", E.$$("#preset option").map((o) => o.textContent).join(", "));
  E.finish(); await p;

  // E: two windows at once (quick taps on the widget): the second waits briefly for the first, then opens anyway
  files = seed();
  const one = watch(await run({ files })); await boot(one.E);
  const two = watch(await run({ files })); const t1 = Date.now(); await boot(two.E);
  console.log("E second window opened while the first was open:", !!two.E.win().__booted, "after", Date.now() - t1 < 3000 ? "a short wait" : "too long");
  one.E.finish(); await one.p; two.E.finish(); await two.p;

  // F: Settings › Updates › Start-up log
  ({ E, p } = watch(await run({ files })));
  await boot(E); await wait(200);
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  E.tap('#cfgsheet [data-act="startlog"]'); await until(() => E.$("#startlog") && !E.$("#startlog").hidden, 3000, "start-up log");
  console.log("F start-up log:", E.$("#startlog").textContent.split("\n").slice(-4).map((l) => l.slice(10)).join(" / "));
  E.finish(); await p;
  const all = errors.concat(E.problems());
  console.log("errors:", all.length ? all.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
