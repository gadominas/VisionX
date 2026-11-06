// The AI invitation (app-blueprints ai-invitation 1.2.1): shown once the launch screen is gone when no key is saved,
// Later waits 3 days, Don't remind me again ends it, Turn on AI opens AI settings at Add key; never with a key,
// never with an update on offer, and never for someone already using Apple Intelligence (VisionX's deviation).
const { run, wait, until, makeEnv } = require("../harness");
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let E, p, files = {};
  const boot = async (o) => { ({ E, p } = await run(Object.assign({ files }, o))); p.catch((e) => errors.push("SCRIPT " + e.stack)); await until(() => E.win() && E.win().__booted, 5000, "boot"); files = E.files; };
  const shown = async () => { try { await until(() => E.$("#aiinv"), 5000, "invitation"); return true; } catch (e) { return false; } };
  // Not shown: the launch screen has gone and the moment it would have appeared (0.6 s later) has passed
  const absent = async () => { await until(() => E.$("#splash").classList.contains("gone"), 5000, "launch screen gone"); await wait(1500); return !!E.$("#aiinv"); };
  const inv = () => (E.json(E.path.settings) || {}).aiInvite || {};
  const day = (t) => Math.round((t - Date.now()) / 864e5);
  await boot({});
  console.log("A over the launch screen:", !!E.$("#aiinv"), "| shown after it:", await shown(), "| title:", E.text("#aiinv h2"), "| perks:", E.$$("#aiinv .aiinv-perks li").length);
  await wait(100);
  console.log("  recorded:", JSON.stringify({ shown: inv().shown, next: day(inv().next) + " days" }));
  E.tap('#aiinv [data-inv="later"]'); await wait(400);
  console.log("B Later:", !E.$("#aiinv"), "| recorded:", JSON.stringify({ later: inv().later, next: day(inv().next) + " days" }));
  E.finish(); await p;
  await boot({});
  console.log("C reopened the same day:", await absent());
  E.finish(); await p;
  const s = JSON.parse(files[E.path.settings]); s.aiInvite.next = Date.now() - 1000; files[E.path.settings] = JSON.stringify(s);
  await boot({});
  console.log("D three days later:", await shown());
  E.tap('#aiinv [data-inv="open"]');
  await until(() => E.$("#aisheet.open") && E.$("#aisheet .aiinv-nudge"), 4000, "AI sheet with nudge");
  console.log("E Turn on AI: AI sheet open", !!E.$("#aisheet.open"), "| nudged:", E.$("#aisheet .aiinv-nudge").textContent, "on", E.$("#aisheet .aiinv-nudge").closest(".aicard").querySelector("b").textContent);
  E.finish(); await p;
  s.aiInvite = Object.assign(JSON.parse(files[E.path.settings]).aiInvite, { next: 0 }); files[E.path.settings] = JSON.stringify(s);
  await boot({});
  await shown(); E.tap('#aiinv [data-inv="never"]'); await wait(400);
  console.log("F Don't remind me again:", JSON.stringify({ off: inv().off }));
  E.finish(); await p;
  const s2 = JSON.parse(files[E.path.settings]); s2.aiInvite.next = 0; files[E.path.settings] = JSON.stringify(s2);
  await boot({});
  console.log("  reopened, even when due:", await absent());
  E.finish(); await p;
  // Never with a key, never with an update on offer, never once Apple Intelligence has done the work
  files = {}; await boot({ kc: { VISIONX_OPENAI_KEY: "sk-proj-QRSTUVWXYZ0000005678" } });
  console.log("G with a key:", await absent());
  E.finish(); await p;
  files = {}; await boot({ releases: { releases: [{ version: "9.0.0", title: "Big one", highlights: [{ icon: "✨", title: "New", text: "Something." }] }] } });
  await until(() => E.$("#upd"), 4000, "update");
  console.log("H with an update on offer: update shown", !!E.$("#upd"), "| invitation:", await absent());
  E.finish(); await p;
  files = {};
  files[makeEnv().path.store] = JSON.stringify({ savedAt: 1, presets: [], triggers: [], settings: { engine: "apple" } });
  files[makeEnv().path.index] = JSON.stringify([{ id: "s-1", startedAt: Date.now() - 4e6, endedAt: Date.now() - 3e6, photos: 12, engine: "Apple Intelligence", summary: "Two people." }]);
  files[makeEnv().path.sessions + "/s-1.json"] = JSON.stringify({ id: "s-1", meta: {} });
  await boot({});
  console.log("I Apple Intelligence already in use:", await absent());
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
