// In-app updates (app-blueprints in-app-updates 1.0.1): the offer a moment after opening, its text escaped and topped
// up from skipped versions, Later (2 days, in the Keychain), Settings › Check now, Update now with its three checks
// (HTTP 200, this app's APP_ID, a newer VERSION), offers held back during a session, and update checks switched off.
const { run, wait, until } = require("../harness");
const REL = { name: "VisionX", script: "VisionX.js", releases: [
  { version: "1.25.0", title: "Sharper <b>photos</b>", highlights: [{ icon: "📷", title: "Sharper photos", text: "Photos are <i>clearer</i>." }] },
  { version: "1.24.0", title: "Older", highlights: [{ icon: "⚡", title: "Faster triggers", text: "Shortcuts run sooner." }, { icon: "🔔", title: "Quieter", text: "Fewer alerts." }, { icon: "x", title: "A fourth", text: "Not shown." }] },
  { version: "1.0.0", title: "Ancient", highlights: [{ icon: "🦕", title: "Old", text: "Already installed." }] }] };
(async () => {
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push("UNHANDLED " + (e && e.stack || e)));
  let E, p, files = {}, kc = {};
  const boot = async (o) => { ({ E, p } = await run(Object.assign({ files, kc, releases: REL }, o))); p.catch((e) => errors.push("SCRIPT " + e.stack)); await until(() => E.win() && E.win().__booted, 5000, "boot"); files = E.files; kc = E.kc; };
  const offer = async (ms = 3000) => { try { await until(() => E.$("#upd"), ms, "offer"); return true; } catch (e) { return false; } };
  await boot({});
  const t0 = Date.now();
  console.log("A offer:", await offer(), "| tag:", E.text("#upd .updtag"), "| title:", E.text("#upd .updt"), "| raw HTML from GitHub rendered:", !!E.$("#upd .updt b"));
  console.log("  intro:", E.text("#upd .upds"), "| highlights:", E.$$("#upd .updi b").map((b) => b.textContent).join(", "), "| text escaped:", E.text("#upd .updi div span"));
  console.log("  checked with a cache-buster:", /releases\.json\?t=\d+/.test(E.log.requests.find((r) => /releases/.test(r.url)).url));
  E.tap("#upd .updlater"); await wait(200);
  console.log("B Later: closed", !E.$("#upd"), "| snoozed for", Math.round((+kc["visionx-update-snooze"] - Date.now()) / 3600e3), "h");
  E.finish(); await p;
  await boot({});
  console.log("C reopened: offer", await offer(1500), "| GitHub asked:", E.log.requests.some((r) => /releases/.test(r.url)));
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  E.tap('#cfgsheet [data-act="updcheck"]'); await offer();
  console.log("D Check for updates now: offer", !!E.$("#upd"), "| snooze cleared:", !("visionx-update-snooze" in kc), "| Settings closed:", !E.$("#cfgsheet.open"));
  E.tap("#upd .updgo"); await until(() => /Updated to|Try again|Got it/.test(E.text("#upd") || ""), 3000, "update");
  console.log("E Update now:", E.text("#upd .updtag"), "|", E.text("#upd .updmsg"), "| script written:", (files[E.env.module.filename] || "").match(/VERSION = '[^']+'/)[0], "| button:", E.text("#upd .updgo"));
  E.tap("#upd .updgo"); await wait(20);
  console.log("  Got it closes:", !E.$("#upd"));
  E.finish(); await p;
  // The three checks before overwriting the script
  for (const [label, o] of [["an error page", { newScript: "<html>Rate limited</html>", newScriptStatus: 429 }], ["another app's file", { newScript: "const VERSION = '9.0.0';\nconst APP_ID = 'stockit';" }],
    ["the same version (GitHub's cache)", { newScript: "const VERSION = '" + E.version + "';\nconst APP_ID = 'visionx';" }]]) {
    files = {}; kc = {};
    await boot(o);
    await offer(); E.tap("#upd .updgo"); await until(() => /Try again/.test(E.text("#upd .updgo") || ""), 3000, "refusal");
    console.log((label === "an error page" ? "F " : "  ") + label + ":", E.text("#upd .updmsg"), "| script untouched:", !(E.env.module.filename in files));
    E.finish(); await p;
  }
  // An offer that arrives during a session waits until the session ends
  files = {}; kc = {};
  await boot({ kc: { VISIONX_ANTHROPIC_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOP1234" }, timeScale: 1 });   // real time: the check runs 3.5 s after opening
  E.type("#startMode", "manual"); E.tap("#toggle");
  await until(() => !E.$("#capBtn").disabled, 5000, "session");
  await until(() => E.log.requests.some((r) => /releases/.test(r.url)), 6000, "update check");
  await wait(300);
  console.log("G during a session: offer shown", !!E.$("#upd"), "| checked:", E.log.requests.some((r) => /releases/.test(r.url)));
  E.tap("#hStop");
  console.log("  after the session ends:", await offer(4000));
  E.finish(); await p;
  // Updates switched off: nothing is asked
  files = {}; kc = {};
  files[require("../harness").makeEnv().path.settings] = JSON.stringify({ checkUpdates: false, usageAsked: true });
  await boot({});
  await wait(800);
  console.log("H Offer new versions off: GitHub asked", E.log.requests.some((r) => /releases/.test(r.url)), "| offer:", !!E.$("#upd"));
  // and no newer version
  E.finish(); await p;
  files = {}; kc = {};
  await boot({ releases: { releases: [{ version: E.version }] } });
  await wait(800);
  console.log("I already on the newest:", !E.$("#upd"));
  E.tap("#cfgOpen"); await until(() => E.$("#cfgsheet.open"), 3000, "settings");
  E.tap('#cfgsheet [data-act="updcheck"]'); await until(() => /latest/.test(E.text("#updmsg") || ""), 3000, "message");
  console.log("  Check now:", E.text("#updmsg"));
  E.finish(); await p;
  const errs = errors.concat(E.problems());
  console.log("errors:", errs.length ? errs.join(" | ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
