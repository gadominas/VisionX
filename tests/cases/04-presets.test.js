// Presets on the Setup tab: pick one, edit and update it, save a new one, delete with two taps,
// and everything is still there after reopening (vision-session.json, with the page's localStorage copy as a fallback).
const { run, wait, until } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let { E, p } = await run({});
  p.catch((e) => errors.push("SCRIPT " + e.stack));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  const names = () => E.$$("#preset option").map((o) => o.textContent).join(" | ");
  console.log("A presets:", names(), "| chosen:", E.$("#preset").selectedOptions[0].textContent, "| Update shown:", !E.$("#pUpdate").classList.contains("hidden"));
  E.type("#preset", "p-objects"); await wait(50);
  console.log("B picked:", E.$("#preset").selectedOptions[0].textContent, "| instructions:", E.$("#instructions").value, "| Update button:", E.text("#pUpdate"), "disabled", E.$("#pUpdate").disabled);
  E.type("#instructions", "Count objects on the desk and group them by colour."); await wait(50);
  console.log("C edited:", E.text("#pHint"), "| Update enabled:", !E.$("#pUpdate").disabled);
  E.tap("#pUpdate"); await wait(50);
  console.log("  after Update:", E.text("#pHint"));
  E.tap("#pNew"); await wait(20);
  console.log("D save row open:", !E.$("#pSaveRow").classList.contains("hidden"));
  E.tap("#pSave"); await wait(20);
  console.log("  without a name:", E.text("#pHint"));
  E.$("#pName").value = "Desk by colour"; E.tap("#pSave"); await wait(50);
  console.log("  saved:", E.text("#pHint"), "| presets:", names(), "| chosen:", E.$("#preset").selectedOptions[0].textContent);
  E.type("#preset", "p-people"); await wait(20);
  E.tap("#pDelete"); await wait(20);
  console.log("E first tap:", E.text("#pDelete"), "| still there:", /Count people/.test(names()));
  E.tap("#pDelete"); await wait(50);
  console.log("  second tap:", E.text("#pHint"), "| presets:", names(), "| text kept:", E.$("#instructions").value.slice(0, 30) + "…");
  E.type("#preset", ""); await wait(20);
  console.log("F custom:", E.$("#preset").selectedOptions[0].textContent, "| hint:", E.text("#pHint") || "(none)");
  // the page saves through the bridge 0.8 s after the last change
  const saved = await until(() => { const s = E.json(E.path.store); return s && !s.presets.some((x) => x.id === "p-people") && s; }, 5000, "save");
  console.log("G saved to vision-session.json:", saved.presets.map((x) => x.name + "=" + x.text.slice(0, 22)).join("; "));
  E.finish(); await p;
  const files = E.files, ls = E.ls;
  ({ E, p } = await run({ files, ls }));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("H reopened:", names(), "| chosen:", E.$("#preset").selectedOptions[0].textContent);
  E.finish(); await p;
  // The file is gone (a new phone restored from a backup without it): the page's own copy still has the presets
  delete files[E.path.store];
  ({ E, p } = await run({ files, ls }));
  await until(() => E.win() && E.win().__booted, 5000, "boot");
  console.log("I without vision-session.json, from the page's copy:", names());
  E.finish(); await p;
  const all = errors.concat(E.problems());
  console.log("errors:", all.length ? all.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
