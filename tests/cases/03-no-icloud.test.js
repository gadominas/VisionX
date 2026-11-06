// A phone that isn't signed in to iCloud (app-blueprints stability-patterns 1.0.0): the script lives on the phone,
// Scriptable's iCloud manager throws on any use, and VisionX must never touch it: not to open, save, update or draw the widget.
const { run, wait, until } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let { E, p } = await run({ noICloud: true, releases: { releases: [{ version: "9.0.0", title: "Big one", highlights: [{ icon: "✨", title: "New", text: "Something new." }] }] } });
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("A opened without iCloud:", E.win().__booted, "| script at:", E.env.module.filename.replace(E.path.local, "<local Documents>"));
  E.tap('#usageask [data-ua="0"]');
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  E.tap('#cfgsheet [data-act="look"][data-k="density"][data-v="compact"]'); await wait(300);
  console.log("B settings saved on the phone:", E.path.settings.replace(E.path.local, "<local Documents>"), "→", JSON.stringify(E.json(E.path.settings)).slice(0, 80));
  E.tap('#cfgsheet [data-act="cfgclose"]');
  await until(() => E.$("#upd"), 3000, "update offer");
  E.tap("#upd .updgo"); await until(() => /Updated to/.test(E.text("#upd .updtag")), 3000, "update");
  console.log("C update installed on the phone:", E.text("#upd .updtag"), "| script now:", (E.files[E.env.module.filename] || "").match(/VERSION = '[^']+'/)[0]);
  E.finish(); await p;
  const touched = E.log.icloudTouched.slice();
  ({ E, p } = await run({ noICloud: true, files: E.files, widget: "small" })); await p;
  console.log("D widget run:", E.widgetText(E.log.widgets[0]).join(" · "));
  console.log("E iCloud calls:", touched.concat(E.log.icloudTouched).join(", ") || "none", "| files outside the phone's folders:", Object.keys(E.files).filter((f) => f.includes("Mobile Documents")).length);
  const all = errors.concat(E.problems());
  console.log("errors:", all.length ? all.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
