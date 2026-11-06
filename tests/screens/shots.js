#!/usr/bin/env node
// Smoke screenshots, step 2: opens each saved screen in Chromium (Playwright) at iPhone size and saves a PNG in
// <tmp>/visionx-screens/shots, or $VISIONX_SHOTS. The widget trees are drawn as HTML, roughly as Scriptable lays them out.
const fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const TMP = process.env.VISIONX_TMP || path.join(os.tmpdir(), "visionx-screens");
const OUT = process.env.VISIONX_SHOTS || path.join(TMP, "shots");
fs.mkdirSync(OUT, { recursive: true });
const ACCENT = "#E5383B";
const rgba = (c) => { if (!c || !c.hex) return null; if (c.hex.startsWith("#")) { const n = parseInt(c.hex.slice(1, 7), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + (c.alpha == null ? 1 : c.alpha) + ")"; } return c.hex; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function node(n, vertical) {
  if (n.kind === "spacer") return n.n == null ? '<div style="flex:1 1 0"></div>' : '<div style="flex:none;' + (vertical ? "height" : "width") + ":" + n.n + 'px"></div>';
  if (n.kind === "text") { const f = n.font || { size: 12, name: "" }; return '<div style="font-size:' + f.size + "px;font-weight:" + (/bold/i.test(f.name) ? 700 : /semi/i.test(f.name) ? 600 : 400) + ";color:" + (rgba(n.textColor) || "#fff") + ";" + (n.lineLimit === 1 ? "white-space:nowrap;overflow:hidden;text-overflow:ellipsis" : "-webkit-line-clamp:" + (n.lineLimit || 9) + ";display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden") + '">' + esc(n.text) + "</div>"; }
  if (n.kind === "image") { const s = n.imageSize || { width: 20, height: 20 }; return '<div style="flex:none;width:' + s.width + "px;height:" + s.height + "px;border-radius:" + (n.cornerRadius || 4) + "px;background:" + ACCENT + '"></div>'; }
  const v = !!n.vertical, st = ["display:flex", "flex-direction:" + (v ? "column" : "row"), "align-items:" + (n.align === "center" ? "center" : "flex-start"), "min-width:0"];
  if (n.spacing) st.push("gap:" + n.spacing + "px");
  if (n.pad) st.push("padding:" + n.pad[0] + "px " + n.pad[3] + "px " + n.pad[2] + "px " + n.pad[1] + "px");
  if (n.size && n.size.width) st.push("width:" + n.size.width + "px;flex:none");
  if (n.backgroundColor) st.push("background:" + rgba(n.backgroundColor));
  if (n.cornerRadius) st.push("border-radius:" + n.cornerRadius + "px");
  if ((n.children || []).some((c) => c.kind === "spacer" && c.n == null)) st.push("flex:1 1 auto;align-self:stretch");
  return '<div style="' + st.join(";") + '">' + (n.children || []).map((c) => node(c, v)).join("") + "</div>";
}
(async () => {
  const b = await chromium.launch();
  const htmls = fs.readdirSync(path.join(TMP, "html")).filter((f) => f.endsWith(".html")).sort();
  for (const f of htmls) {
    const dark = /dark/.test(f);
    const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
    await pg.goto("file://" + path.join(TMP, "html", f));
    await pg.waitForTimeout(f.startsWith("00-") ? 900 : 200);
    await pg.evaluate(() => { const sel = document.documentElement.dataset.shotScroll; const n = sel && document.querySelector(sel); if (n) window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 120); });
    await pg.screenshot({ path: path.join(OUT, f.replace(".html", ".png")) });
    console.log("  " + f.replace(".html", ".png"));
    await pg.close();
  }
  const trees = JSON.parse(fs.readFileSync(path.join(TMP, "widgets.json"), "utf8"));
  const SIZE = { small: [170, 170], medium: [364, 170], large: [364, 382] };
  let html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9d2dc;font-family:system-ui,sans-serif}.w{border-radius:22px;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box;margin:20px}</style></head><body>';
  for (const [fam, t] of Object.entries(trees)) {
    const g = t.backgroundGradient, p = t.pad || [14, 14, 14, 14];
    html += '<div id="' + fam + '" class="w" style="width:' + SIZE[fam][0] + "px;height:" + SIZE[fam][1] + "px;padding:" + p[0] + "px " + p[3] + "px " + p[2] + "px " + p[1] + "px;background:" + (g && g.colors ? "linear-gradient(180deg," + g.colors.map(rgba).join(",") + ")" : "#0E1116") + '">' + (t.children || []).map((c) => node(c, true)).join("") + "</div>";
  }
  fs.writeFileSync(path.join(TMP, "widgets.html"), html + "</body></html>");
  const pg = await b.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await pg.goto("file://" + path.join(TMP, "widgets.html"));
  for (const fam of Object.keys(trees)) { await (await pg.$("#" + fam)).screenshot({ path: path.join(OUT, "10-widget-" + fam + ".png") }); console.log("  10-widget-" + fam + ".png"); }
  await b.close();
  console.log("Screenshots in " + OUT);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
