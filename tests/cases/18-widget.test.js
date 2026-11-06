// The Home Screen and Lock Screen widget (app-blueprints widgets 1.0.0): no sessions yet, the last session with the
// shortcuts that ran and its summary, ● Live during a session, every size, the logo tile (fetched once, a monogram
// offline), the refresh time from Settings, and a widget run never builds a WebView. Then: the widget right after
// a session is stopped must no longer say Live.
const { run, wait, until, makeEnv } = require("../harness");
const P = makeEnv().path;
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  const widget = async (files, family, o) => {
    const { E, p } = await run(Object.assign({ files, widget: family }, o));
    await p.catch((e) => errors.push("SCRIPT " + e.stack));
    if (E.log.webviews || E.log.alerts.length || E.log.presented) errors.push("a widget run built UI: " + JSON.stringify({ wv: E.log.webviews, alerts: E.log.alerts.length }));
    errors.push(...E.problems());
    return E;
  };
  let files = {};
  let E = await widget(files, "medium", { offline: true });
  console.log("A no sessions, offline:", E.widgetText(E.log.widgets[0]).join(" · "), "| logo:", E.log.widgets[0].children[0].children[0].img.drawn.join(","));
  E = await widget(files, "medium");
  const iconFile = Object.keys(E.files).find((f) => /visionx-widget-icon-/.test(f));
  console.log("  online: logo fetched and cached:", !!iconFile, "| refresh after (min):", Math.round((E.log.widgets[0].refreshAfterDate - Date.now()) / 60e3), "| opens:", E.log.widgets[0].url);
  const fetched = E.log.requests.length;
  E = await widget(E.files, "medium");
  console.log("  next run uses the cached logo:", E.log.requests.length === 0, "(first run fetched " + fetched + ")");
  files = E.files;
  const ended = Date.now() - 25 * 60e3;
  files[P.index] = JSON.stringify([{ id: "s-2", startedAt: ended - 30 * 60e3, endedAt: ended, photos: 37, fired: 3, engine: "Claude — claude-haiku-5-5", preset: "Count cars and plates",
    summary: "**41 vehicles** entered: 29 cars, 8 vans and 4 trucks.\n\n| Type | Count |\n|---|---|\n| Car | 29 |\n\n```donut\nCars: 29\nVans: 8", ran: [{ name: "Delivery van", fired: 2 }, { name: "Lot is full", fired: 1 }] }]);
  files[P.sessions + "/s-2.json"] = "{}";
  for (const fam of ["small", "medium", "large", "accessoryRectangular", "accessoryCircular", "accessoryInline"]) {
    E = await widget(files, fam);
    console.log((fam === "small" ? "B " : "  ") + fam + ":", E.widgetText(E.log.widgets[0]).join(" · ").slice(0, 190));
    if (/\*\*|```|\|/.test(E.widgetText(E.log.widgets[0]).join(" "))) errors.push("Markdown shown as text in the " + fam + " widget");
  }
  files[P.widget] = JSON.stringify({ running: true, preset: "Gate: read plates", interval: 10, photos: 12, startedAt: Date.now() - 3 * 60e3, at: Date.now() - 30e3 });
  E = await widget(files, "medium");
  console.log("C live:", E.widgetText(E.log.widgets[0]).join(" · "));
  E = await widget(files, "accessoryCircular");
  console.log("  Lock Screen circle:", E.widgetText(E.log.widgets[0]).join(" · "));
  files[P.widget] = JSON.stringify({ running: true, preset: "Gate: read plates", interval: 10, photos: 12, startedAt: Date.now() - 3 * 3600e3, at: Date.now() - 11 * 60e3 });
  E = await widget(files, "medium");
  console.log("D live state 11 min old (the app was closed mid-session): back to the last session:", /Last session/.test(E.widgetText(E.log.widgets[0]).join(" ")));
  files[P.settings] = JSON.stringify({ usageAsked: true, cfg: { widgetRefreshMin: 60 } });
  E = await widget(files, "small");
  console.log("E refresh from Settings › Widget (60 min):", Math.round((E.log.widgets[0].refreshAfterDate - Date.now()) / 60e3));

  // A session runs and is stopped: the widget must show the finished session, not ● Live
  delete files[P.widget];
  let r = await run({ files, kc: { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" } });
  r.p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => r.E.win() && r.E.win().__booted, 5000, "boot");
  r.E.type("#startMode", "manual"); r.E.tap("#toggle");
  await until(() => !r.E.$("#capBtn").disabled, 5000, "capture");
  r.E.tap("#capBtn"); await until(() => r.E.log.ai.length && /All 1 analyzed/.test(r.E.text("#capTxt")), 5000, "photo");
  console.log("F during the session:", JSON.stringify(r.E.json(P.widget)).replace(/"(at|startedAt)":\d+/g, '"$1":…'));
  const t0 = Date.now();
  r.E.tap("#hStop"); await until(() => (r.E.json(P.index)[0] || {}).endedAt >= t0, 6000, "saved");
  await wait(300);
  console.log("  after Stop:", JSON.stringify(r.E.json(P.widget)).replace(/"(at|startedAt)":\d+/g, '"$1":…'));
  r.E.finish(); await r.p;
  errors.push(...r.E.problems());
  E = await widget(r.E.files, "medium");
  console.log("  widget right after Stop:", E.widgetText(E.log.widgets[0]).join(" · ").slice(0, 120));
  if (r.E.json(P.widget).running || /Live/.test(E.widgetText(E.log.widgets[0]).join(" "))) errors.push("the widget still says Live after the session was stopped");
  const errs = errors;
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", r.E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
