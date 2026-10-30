// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: camera;

/*
  VisionX — timed photo capture + AI analysis (Claude, OpenAI or Apple Intelligence).
  https://github.com/gadominas/VisionX

  • Takes a photo every N seconds from the live camera (no taps needed).
  • Sends each photo + your custom instructions + the accumulated state to Claude or OpenAI.
  • The model merges each frame into a cumulative result for the whole session.
  • Shows the latest photo large and the two before it small (last 3 only).
  • Photos live only in memory and are never written to disk or Photos.
  • End the session to see photos taken, requests sent and tokens used.

  Apple Intelligence runs through a Shortcut (Scriptable has no direct access);
  setup steps are in the app under "Analyze with".

  Settings (instructions, interval, photo size…) are edited inside the app UI.
  VisionX checks GitHub for new versions when it opens (Settings › Updates).
  Claude and OpenAI keys, models and token usage live under Settings › AI settings
  (github.com/gadominas/app-blueprints · ai-configuration). Keys stay in the iOS Keychain.
  Opens on a 2.4 s launch screen with the VisionX eye (app-blueprints · launch-screen).
  Its Home Screen and Lock Screen widget uses the shared widget frame (app-blueprints · widgets).
  Without a Claude or OpenAI key (and with Apple Intelligence not in use), a short card invites you to turn AI on
  (app-blueprints · ai-invitation). It opens on an empty window first and reads its data after (recipe safe-startup).
  The BLUEPRINTS block below lists every shared blueprint this app follows (Settings › Built with).
*/

const DEFAULT_SHORTCUT = "Vision Session AI";
const STORE_FILE = "vision-session.json"; // presets + settings, in Scriptable's local Documents

// ───────── Version and in-app updates ─────────
// This build's version. When releasing, bump it and add a matching entry to releases.json.
// Keep these two lines exactly in this form (single quotes): the updater reads them from downloads.
const VERSION = '1.20.0';
const APP_ID = 'visionx';   // unique per app, never changes
const REPO_RAW = 'https://raw.githubusercontent.com/gadominas/VisionX/main/';
const SCRIPT_FILE = 'VisionX.js';   // the script's file name in the repository
const UPDATE_SNOOZE_MS = 2 * 24 * 3600 * 1000;   // "Later" = 2 days
const KC_UPDATE_SNOOZE = 'visionx-update-snooze';   // Keychain key, unique per app

// ───────── Blueprints ─────────
// Shared blueprints this app was built with (github.com/gadominas/app-blueprints). One line per blueprint, in this exact shape:
// inventory tools read it without running the script, and Settings › Built with shows it.
const BLUEPRINTS_REPO = 'https://github.com/gadominas/app-blueprints';
const BLUEPRINTS = [
  { id: 'in-app-updates', name: 'In-app updates', version: '1.0.0', since: '1.7.0' },
  { id: 'settings', name: 'Settings', version: '1.0.0', since: '1.9.0' },
  { id: 'ai-configuration', name: 'AI configuration', version: '1.0.0', since: '1.8.0' },
  { id: 'launch-screen', name: 'Launch screen', version: '1.0.0', since: '1.17.1' },
  { id: 'widgets', name: 'Widgets', version: '1.0.0', since: '1.19.0' },
  { id: 'ai-invitation', name: 'AI invitation', version: '1.2.0', since: '1.20.0' },
];

// ───────── AI invitation (app-blueprints · ai-invitation) ─────────
// What the invitation promises. Exactly three perks, each a real feature that needs a key.
const AI_INVITE = {
  title: "Give VisionX superpowers",            // punchy, names the app, at most 32 characters
  perks: [                                      // icon + at most 48 characters each
    { icon: "✦", text: "Every photo described and summed up for you" },
    { icon: "🎥", text: "Hands-free capture with a live, zoomable view" },
    { icon: "⚡", text: "Your shortcuts run the moment it spots a match" },
  ],
};

// ───────── Settings (app-blueprints · settings) ─────────
// Appearance, updates and tunables live in settings.json in iCloud Drive › Scriptable › VisionX.
// Presets, triggers and the session picks stay in vision-session.json (on this iPhone only), as before.
const sfm = (() => { try { return FileManager.iCloud(); } catch (e) { return FileManager.local(); } })();
const SET_DIR = sfm.joinPath(sfm.documentsDirectory(), "VisionX");
const SP = (n) => sfm.joinPath(SET_DIR, n + ".json");
// A short start-up log on the phone (local, not iCloud): Settings › Updates › Start-up log, and on screen if opening stalls.
const LOG_PATH = FileManager.local().joinPath(FileManager.local().documentsDirectory(), APP_ID + "-startup.log");
function startLog(msg) {
  try {
    const lfm = FileManager.local(), line = new Date().toISOString().slice(11, 19) + "  " + msg;
    const old = lfm.fileExists(LOG_PATH) ? lfm.readString(LOG_PATH).split("\n").slice(-60) : [];
    lfm.writeString(LOG_PATH, old.concat(line).join("\n"));
  } catch (e) {}
}
const loadIssues = [];   // files iCloud didn't hand over in time
async function load(n, def, waitMs = 10000) {
  const p = SP(n);
  if (!sfm.fileExists(p)) return def;
  try {
    if (sfm.isFileStoredIniCloud(p) && !sfm.isFileDownloaded(p)) {
      // iCloud can take a long time (or forever, offline): never let start-up hang on it
      await Promise.race([sfm.downloadFileFromiCloud(p), new Promise(r => Timer.schedule(waitMs, false, r))]);
      if (!sfm.isFileDownloaded(p)) { loadIssues.push(n); startLog(`iCloud didn't deliver ${n}.json in ${waitMs / 1000} s`); return def; }
    }
    return JSON.parse(sfm.readString(p));
  } catch (e) { loadIssues.push(n); startLog(`Couldn't read ${n}.json: ${e}`); return def; }   // a broken file falls back to defaults, never crashes
}
// Settings that were never read are never saved over (set by loadSettings). VisionX's data files live on this
// iPhone (vision-session.json, the sessions folder, visionx-usage.json); writeStore() and aiWrite() guard them.
let settingsOk = false;
let dataLoaded = false;
const write = (n, v) => {
  if (n === "settings" && !settingsOk) return false;
  try { if (!sfm.fileExists(SET_DIR)) sfm.createDirectory(SET_DIR, true); sfm.writeString(SP(n), JSON.stringify(v)); return true; }
  catch (e) { console.warn("Couldn't save " + n + ": " + e); return false; }
};
// Defaults first, saved choices on top (loadSettings runs before the app starts).
const settings = {
  theme: "auto", density: "comfortable", font: "sans", textSize: 1,
  checkUpdates: true,   // offer new versions from GitHub (asks again 2 days after "Later")
  cfg: {},
};
const saveSettings = () => write("settings", settings);
// Every key the page may change, with its check (all apply at once on the page).
const SET_KEYS = {
  theme: (v) => v === "auto" || !!PALETTES[v], density: (v) => ["comfortable", "compact", "tiny"].includes(v),
  font: (v) => ["sans", "serif"].includes(v), textSize: (v) => [0.92, 1, 1.12, 1.25].includes(+v),
  checkUpdates: "bool",
};
function setSetting(k, v) {
  const s = SET_KEYS[k];
  if (!s) return false;
  if (s === "bool") v = v === true || v === "true";
  else if (!s(v)) return false;
  if (k === "textSize") v = +v;
  settings[k] = v;
  return true;
}
async function loadSettings() {
  const saved = await load("settings", null);
  if (saved) Object.assign(settings, saved);
  const d = { theme: "auto", density: "comfortable", font: "sans", textSize: 1 };
  for (const k of Object.keys(d)) if (!setSetting(k, settings[k])) settings[k] = d[k];
  settings.cfg = settings.cfg && typeof settings.cfg === "object" ? settings.cfg : {};
  settingsOk = !loadIssues.includes("settings");   // settings that were never read are never saved over
}
// Data is read in loadData(): the app shows its first screen before reading it (safe-startup recipe).
// Presets and triggers, the saved sessions and token usage; settings and AI settings are read before every branch.
let store = null;        // vision-session.json: presets, triggers and the session picks (this iPhone)
let sessions = [];       // saved sessions, newest first (index entries only)
async function loadData() {
  loadIssues.length = 0;
  store = readStore();
  sessions = sesIndex();             // read only: the app tidies the list in bootApp, the widget never deletes
  usage = aiLoad("usage", usage);
  dataLoaded = loadIssues.length === 0;   // anything missing: show what we have, save nothing over it
}
// Everything tunable lives here; the Settings screen edits these (stored in settings.cfg, defaults below).
const CONFIG = [
  ["Capture", [
    { k: "requestWait", label: "Time limit per AI request", help: "A photo whose answer takes longer is marked as not analyzed", unit: "s", def: 90, min: 30, max: 180, step: 10 },
    { k: "keepFrames", label: "Photos kept on screen", help: "The latest photo and the ones before it; older photos leave memory", unit: "photos", def: 3, min: 1, max: 10, step: 1 },
    { k: "debugKeep", label: "Photos kept in Debug", help: "The newest photos with what was sent and what came back; saved with the session when it ends", unit: "photos", def: 10, min: 5, max: 30, step: 5 },
    { k: "keepSessions", label: "Sessions kept", help: "Finished sessions saved on this iPhone with their photos and debug log; the oldest goes first", unit: "sessions", def: 3, min: 1, max: 10, step: 1 },
  ]],
  ["Widget", [
    { k: "widgetRefreshMin", label: "Ask iOS to refresh every", help: "iOS decides the exact timing", unit: "min", def: 30, min: 15, max: 240, step: 15 },
    { k: "widgetStaleMin", label: "Mark the widget as out of date after", help: "Older data shows \"Updated …\" in amber", unit: "min", def: 720, min: 60, max: 2880, step: 60 },
  ]],
];
const CFG_FLAT = CONFIG.flatMap(([, items]) => items);
const cfgDef = (k) => CFG_FLAT.find((x) => x.k === k);
const cfg = (k) => { const v = settings.cfg && settings.cfg[k]; return v === undefined ? cfgDef(k).def : v; };
function setCfg(k, v) {
  const d = cfgDef(k);
  if (!d) return "Unknown setting";
  settings.cfg = settings.cfg || {};
  if (v === null) { delete settings.cfg[k]; return ""; }   // Reset
  v = Number(String(v).replace(",", "."));   // accept a decimal comma
  if (!isFinite(v)) v = d.def;
  v = Math.min(d.max, Math.max(d.min, v));
  v = d.step < 1 ? Math.round(v / d.step) * d.step : Math.round(v);
  v = Number(v.toFixed(2));
  if (v === d.def) delete settings.cfg[k]; else settings.cfg[k] = v;   // store only what differs
  return "";
}
// ───────── Saved sessions ─────────
// Each finished session (summary, stats, triggers, photos and debug log) is saved as one JSON
// file on this iPhone only, never iCloud, because it contains photos. index.json lists them
// newest first; only the last "Sessions kept" (Settings › Capture) are kept.
const sesFm = FileManager.local();
const SES_DIR = sesFm.joinPath(sesFm.documentsDirectory(), "VisionX-sessions");
const sesPath = (id) => sesFm.joinPath(SES_DIR, String(id).replace(/[^\w-]/g, "") + ".json");
function sesEnsureDir() { if (!sesFm.fileExists(SES_DIR)) sesFm.createDirectory(SES_DIR, true); }
function sesIndex() {
  try {
    const p = sesFm.joinPath(SES_DIR, "index.json");
    if (sesFm.fileExists(p)) { const list = JSON.parse(sesFm.readString(p)); if (Array.isArray(list)) return list; }
  } catch (e) { console.log("Sessions: couldn't read the index: " + e); }
  return [];
}
function sesWriteIndex(list) { sesEnsureDir(); sesFm.writeString(sesFm.joinPath(SES_DIR, "index.json"), JSON.stringify(list)); }
// Newest first; removes sessions beyond the limit (files too) and entries whose file is gone.
function sesPrune(list) {
  const keep = cfg("keepSessions");
  const sorted = list.filter((m) => m && m.id && sesFm.fileExists(sesPath(m.id))).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  sorted.slice(keep).forEach((m) => { try { sesFm.remove(sesPath(m.id)); } catch (e) {} });
  return sorted.slice(0, keep);
}
function sessionList() {
  const before = sesIndex();
  const list = sesPrune(before);
  if (list.length !== before.length) sesWriteIndex(list);
  return list;
}
function sessionSave(rec) {
  if (!rec || !rec.id || !rec.meta) throw new Error("nothing to save");
  sesEnsureDir();
  sesFm.writeString(sesPath(rec.id), JSON.stringify(rec));
  const list = sesPrune([rec.meta].concat(sesIndex().filter((m) => m && m.id !== rec.id)));
  sesWriteIndex(list);
  return list;
}
function sessionGet(id) {
  const p = sesPath(id);
  if (!sesFm.fileExists(p)) throw new Error("this session is no longer saved");
  return JSON.parse(sesFm.readString(p));
}
function sessionDelete(id) {
  try { if (sesFm.fileExists(sesPath(id))) sesFm.remove(sesPath(id)); } catch (e) {}
  const list = sesIndex().filter((m) => m && m.id !== id);
  sesWriteIndex(list);
  return sessionList();
}

// ───────── Widget content (app-blueprints · widgets) ─────────
// The session running now, else the last saved one. The page saves the live state through the
// bridge action "widget" when a session starts, after each photo and when it stops.
// Read only: sesIndex(), never sessionList(), which deletes files. No photo ever reaches the widget.
async function widgetModel() {
  const live = readWidget();
  if (live && live.running && Date.now() - live.at < 10 * 60e3) {
    return { badge: '● Live', kicker: 'Recording · every ' + live.interval + ' s', title: live.preset || 'Session',
      caption: live.photos + (live.photos === 1 ? ' photo' : ' photos') + ' so far', footer: 'Started ' + wWhen(live.startedAt),
      accessory: { glyph: '●', value: live.photos } };
  }
  const last = sesIndex().filter((m) => m && m.endedAt).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
  if (!last) return { empty: 'No sessions yet. Tap to start one.' };
  const mins = Math.round((Date.now() - last.endedAt) / 60e3);
  const ago = mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : wWhen(last.endedAt);
  const ran = (last.ran || []).map((t) => ({ icon: '⚡', text: t.name, sub: t.fired + (t.fired === 1 ? ' run' : ' runs') }));
  return {
    kicker: 'Last session · ' + ago,
    title: last.preset || 'Session',
    caption: last.photos + (last.photos === 1 ? ' photo' : ' photos') + (last.fired ? ', ' + last.fired + (last.fired === 1 ? ' trigger run' : ' trigger runs') : ''),
    rows: ran.concat(last.summary ? [{ icon: '✦', text: last.summary, lines: 3 }] : []),
    footer: last.engine,
    accessory: { glyph: '◉', value: last.photos },
  };
}

// ───────── Widget ─────────
// Shared widget frame (github.com/gadominas/app-blueprints › blueprints/widgets.md).
// An app changes only WIDGET and widgetModel(); everything below WB is the same in every app.
const WIDGET = {
  name: ['Vision', 'X'],                  // as on the launch screen: plain part, highlighted part, optional rest
  accent: '#E5383B',                      // the logo's focal colour (the launch screen's --sp-accent)
  icon: REPO_RAW + 'docs/icon-1024.png',  // the app icon, cached on the phone after the first fetch
  words: { open: 'Tap to open', nothing: 'Nothing to show yet.', updated: 'Updated', yesterday: 'yesterday' },   // in the app's language
};
// Brand colours, the same in every app and in light and dark mode: the logo tile's ground and lines.
const WB = { ground: '#0E1116', raised: '#171B22', ink: '#F6F7F9', ink2: '#C9CED6', muted: '#9AA3AE', good: '#2DD4BF', warn: '#FBBF24' };
const wfm = FileManager.local();
const wPath = (n) => wfm.joinPath(wfm.documentsDirectory(), APP_ID + '-' + n);

// What the widget shows is saved by the app and only read by the widget: fast, offline, no sign-in.
function saveWidget(data) {
  try { wfm.writeString(wPath('widget.json'), JSON.stringify(Object.assign({}, data, { at: Date.now() }))); }
  catch (e) { console.log('Widget: not saved: ' + e); }
}
function readWidget() {
  try { const p = wPath('widget.json'); return wfm.fileExists(p) ? JSON.parse(wfm.readString(p)) : null; }
  catch (e) { return null; }
}

// Tones: ink, soft, muted, accent, good, warn, or a hex colour.
const wColor = (c, a = 1) => {
  const k = c === 'soft' ? 'ink2' : c;
  return new Color(k === 'accent' ? WIDGET.accent : (WB[k] || k), a);
};
// Rounded system fonts, falling back to the plain system font on older Scriptable versions.
function wFont(weight, size) {
  const name = { bold: 'boldRoundedSystemFont', semi: 'semiboldRoundedSystemFont', med: 'mediumRoundedSystemFont' }[weight] || 'regularRoundedSystemFont';
  if (typeof Font[name] === 'function') return Font[name](size);
  return weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semi' ? Font.semiboldSystemFont(size) : weight === 'med' ? Font.mediumSystemFont(size) : Font.systemFont(size);
}
function wText(stack, s, size, weight, tone, lines = 1) {
  const t = stack.addText(String(s));
  t.font = wFont(weight, size);
  t.textColor = wColor(tone);
  t.lineLimit = lines;
  if (lines === 1) t.minimumScaleFactor = 0.75;
  return t;
}
function wWhen(ts) {
  const d = new Date(ts), now = new Date(), f = new DateFormatter();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5);
  if (ago === 1) return WIDGET.words.yesterday;
  f.dateFormat = ago === 0 ? 'HH:mm' : 'd MMM';
  return f.string(d);
}

// The app's logo tile, from the repository's icon, cached per app version; a monogram until then.
async function widgetIcon() {
  const p = wPath('widget-icon-' + VERSION + '.png');
  try {
    if (wfm.fileExists(p)) return wfm.readImage(p);
    const r = new Request(WIDGET.icon);
    r.timeoutInterval = 8;
    const dc = new DrawContext();
    dc.size = new Size(96, 96); dc.opaque = false; dc.respectScreenScale = false;
    dc.drawImageInRect(await r.loadImage(), new Rect(0, 0, 96, 96));
    const img = dc.getImage();
    const dir = wfm.documentsDirectory();
    wfm.listContents(dir).filter((f) => f.startsWith(APP_ID + '-widget-icon-')).forEach((f) => { try { wfm.remove(wfm.joinPath(dir, f)); } catch (e) {} });
    wfm.writeImage(p, img);
    return img;
  } catch (e) {
    return widgetMonogram();
  }
}
function widgetMonogram() {
  const dc = new DrawContext();
  dc.size = new Size(96, 96); dc.opaque = false; dc.respectScreenScale = false;
  dc.setFillColor(wColor('raised')); dc.fillRect(new Rect(0, 0, 96, 96));
  dc.setFont(wFont('bold', 54)); dc.setTextColor(wColor('accent')); dc.setTextAlignedCenter();
  dc.drawTextInRect(WIDGET.name.join('').charAt(0), new Rect(0, 14, 96, 70));
  return dc.getImage();
}

// Rows that fit: a line counts 1, a sub line 0.8; medium holds 5.5 (3 rows at most), large 12 (6 at most).
function wFit(rows, budget, max) {
  const out = [];
  let used = 0;
  for (const r of rows || []) {
    const n = (r.lines || 1) + (r.sub ? 0.8 : 0);
    if (out.length >= max || used + n > budget + 1e-9) break;   // 1e-9: 3 + 5 × 1.8 must still fit in 12
    used += n;
    out.push(r);
  }
  return out;
}
function wRows(stack, rows) {
  rows.forEach((r, i) => {
    if (i) stack.addSpacer(5);
    const row = stack.addStack();
    row.topAlignContent(); row.spacing = 6;
    if (r.url) row.url = r.url;
    if (r.icon) { const ic = row.addStack(); ic.size = new Size(15, 0); wText(ic, r.icon, 11.5, 'reg', 'ink'); }
    const tx = row.addStack();
    tx.layoutVertically();
    wText(tx, r.text, 12.5, r.lines ? 'reg' : 'med', r.tone || (r.lines ? 'soft' : 'ink'), r.lines || 1);
    if (r.sub) wText(tx, r.sub, 11, 'reg', 'muted');
  });
}

async function renderWidget(m) {
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget();
  w.url = m.url || URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + cfg('widgetRefreshMin') * 60e3);
  if (fam.startsWith('accessory')) return renderAccessory(w, fam, m);
  const small = fam === 'small', medium = fam === 'medium', large = !small && !medium;
  const g = new LinearGradient();
  g.colors = [wColor('raised'), wColor('ground')]; g.locations = [0, 1];
  g.startPoint = new Point(0, 0); g.endPoint = new Point(0, 1);
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);

  // 1. Header: logo tile, name (highlighted part in the accent), badge
  const hd = w.addStack();
  hd.centerAlignContent();
  const icon = hd.addImage(await widgetIcon());
  const is = small ? 18 : 20;
  icon.imageSize = new Size(is, is); icon.cornerRadius = is * 0.225;
  hd.addSpacer(6);
  WIDGET.name.forEach((part, i) => {
    if (!part) return;
    const t = hd.addText(part);
    t.font = wFont('bold', small ? 13 : 14); t.textColor = wColor(i === 1 ? 'accent' : 'ink'); t.lineLimit = 1;
  });
  hd.addSpacer();
  if (m.badge && !small) {
    const b = hd.addStack();
    b.setPadding(2, 7, 2, 7); b.cornerRadius = 8;
    b.backgroundColor = wColor(m.badgeTone || 'accent', 0.16);
    wText(b, m.badge, 11.5, 'semi', m.badgeTone || 'accent');
  }
  w.addSpacer(small ? 8 : 10);

  // Empty state: what to do next, never an error
  if (m.empty) {
    wText(w, m.empty, 13, 'semi', 'soft', 3);
    w.addSpacer();
    wText(w, m.footer || WIDGET.words.open, 11, 'reg', 'muted');
    Script.setWidget(w);
    return;
  }

  // 2. Hero: kicker, then a big value with its caption, or a title with its caption
  const body = w.addStack();
  body.topAlignContent();
  const left = body.addStack();
  left.layoutVertically();
  if (medium) left.size = new Size(136, 0);
  if (m.kicker) wText(left, m.kicker, 11, 'semi', m.kickerTone || 'accent');
  if (m.value != null && m.value !== '') {
    wText(left, m.value, small ? 40 : 42, 'bold', m.valueTone || 'ink');
    if (m.caption) wText(left, m.caption, 13, 'semi', 'ink');
  } else {
    if (m.title) wText(left, m.title, small ? 16 : 18, 'bold', 'ink', 2);
    if (m.caption) { left.addSpacer(2); wText(left, m.caption, 12, 'reg', 'soft', 2); }
  }

  // 3. Rows: beside the hero on medium, under it on large, none on small
  const rows = m.rows || [];
  if (medium && wFit(rows, 5.5, 3).length) {
    body.addSpacer(12);
    const right = body.addStack();
    right.layoutVertically();
    wRows(right, wFit(rows, 5.5, 3));
  }
  body.addSpacer();
  if (large && wFit(rows, 12, 6).length) { w.addSpacer(14); wRows(w, wFit(rows, 12, 6)); }

  // 4. Footer: one muted line; amber when the data is stale. Small shows the badge here if there's no footer.
  w.addSpacer();
  const ft = small ? (m.footer || m.badge) : m.footer;
  if (ft) wText(w, (m.stale ? '⟳ ' : '') + ft, 11, 'reg', m.stale ? 'warn' : 'muted');
  Script.setWidget(w);
}

// Lock Screen: iOS tints these, so text only, no colours or logo.
function renderAccessory(w, fam, m) {
  const name = WIDGET.name.join('');
  const a = m.accessory || {};
  const hasValue = m.value != null && m.value !== '';
  const hero = m.empty || (hasValue ? (m.value + ' ' + (m.caption || '')).trim() : (m.title || ''));
  if (fam === 'accessoryInline') {
    w.addText(a.inline || (hero ? name + ': ' + hero : name));
  } else if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const c = w.addStack();
    c.layoutVertically(); c.centerAlignContent();
    const gl = c.addText(a.glyph || name.charAt(0)); gl.font = Font.systemFont(11); gl.centerAlignText();
    const v = c.addText(String(a.value != null ? a.value : hasValue ? m.value : '–'));
    v.font = wFont('bold', 20); v.minimumScaleFactor = 0.5; v.centerAlignText();
  } else {
    const lines = [
      [[name, m.badge || m.kicker].filter(Boolean).join(' · '), 'semi', 12],
      [hero, 'bold', 15],
      [m.empty ? '' : hasValue ? (m.footer || '') : (m.caption || m.footer || ''), 'reg', 12],
    ];
    lines.forEach(([s, wt, size]) => { if (!s) return; const t = w.addText(s); t.font = wFont(wt, size); t.lineLimit = 1; t.minimumScaleFactor = 0.7; });
  }
  Script.setWidget(w);
}

// Widget runs come here and only here: no WebView, Alert or QuickLook may be built or presented.
async function runWidget() {
  const name = WIDGET.name.join('');
  let m = null;
  try { m = await widgetModel(args.widgetParameter || '', config.widgetFamily || 'medium'); }
  catch (e) { console.error('Widget model: ' + e); }
  if (!m) m = { empty: WIDGET.words.nothing };
  try {
    if (m.at && !m.empty && Date.now() - m.at > cfg('widgetStaleMin') * 60e3) {
      m.stale = true;
      m.footer = WIDGET.words.updated + ' ' + wWhen(m.at);
    }
    await renderWidget(m);
  } catch (e) {
    console.error('Widget render: ' + e);
    const w = new ListWidget();
    w.backgroundColor = wColor('ground');
    w.url = URLScheme.forRunningScript();
    wText(w, name, 14, 'bold', 'ink');
    w.addSpacer(4);
    wText(w, WIDGET.words.open, 12, 'reg', 'muted');
    Script.setWidget(w);
  }
}
// ───────── end of Widget ─────────

// Six palettes on the shared colour tokens. VisionX teal is the accent in all of them;
// rec (the recording red) is this app's own extra colour.
const PALETTES = {
  ink:      { paper: "#F6F7F9", sheet: "#FFFFFF", ink: "#15181D", ink2: "#353B44", muted: "#5B6470", rule: "#DDE1E6", signal: "#0F766E", signalWash: "#DDF1EE", amber: "#9A6200", amberWash: "#FDF0D2", danger: "#C42B2E", rec: "#E5383B", scheme: "light" },
  sepia:    { paper: "#F3EAD6", sheet: "#FBF5E6", ink: "#2A1F14", ink2: "#4B3B2A", muted: "#73604A", rule: "#E1D3B5", signal: "#1F6F63", signalWash: "#DDE7DC", amber: "#A16207", amberWash: "#F6E5BF", danger: "#9F1239", rec: "#C2342F", scheme: "light" },
  mint:     { paper: "#F1F6F3", sheet: "#FFFFFF", ink: "#0D2318", ink2: "#2C4A3B", muted: "#556D60", rule: "#D3E2D9", signal: "#0F766E", signalWash: "#DCEFEA", amber: "#B45309", amberWash: "#FBEED8", danger: "#B91C1C", rec: "#DC2626", scheme: "light" },
  contrast: { paper: "#FFFFFF", sheet: "#FFFFFF", ink: "#000000", ink2: "#111111", muted: "#333333", rule: "#9A9A9A", signal: "#005A52", signalWash: "#D9F2EE", amber: "#7A4B00", amberWash: "#FFEEC2", danger: "#A30000", rec: "#C00000", scheme: "light" },
  slate:    { paper: "#1C2128", sheet: "#22272E", ink: "#E6EDF3", ink2: "#C5CED8", muted: "#9AA5B1", rule: "#373E47", signal: "#2DD4BF", signalWash: "#173A37", amber: "#E3B341", amberWash: "#3A2F12", danger: "#FF8A7A", rec: "#FF5C5E", scheme: "dark" },
  night:    { paper: "#0E1116", sheet: "#161A21", ink: "#E8EBEF", ink2: "#C8CDD5", muted: "#8C96A3", rule: "#252B34", signal: "#2DD4BF", signalWash: "#12302D", amber: "#F0C52E", amberWash: "#2D240C", danger: "#FF6B6B", rec: "#FF4D4F", scheme: "dark" },
};
const PALETTE_CSS = Object.entries(PALETTES).map(([k, p]) => "[data-theme=" + k + "]{--paper:" + p.paper + ";--sheet:" + p.sheet + ";--ink:" + p.ink + ";--ink-2:" + p.ink2 + ";--muted:" + p.muted + ";--rule:" + p.rule + ";--signal:" + p.signal + ";--signal-wash:" + p.signalWash + ";--amber:" + p.amber + ";--amber-wash:" + p.amberWash + ";--danger:" + p.danger + ";--rec:" + p.rec + ";color-scheme:" + p.scheme + "}").join("\n");
// The look for the first paint, so the page never flashes the default palette (the page keeps Auto live afterwards).
function lookState() {
  return { theme: settings.theme, density: settings.density, font: settings.font, textSize: settings.textSize,
           shown: settings.theme === "auto" ? (Device.isUsingDarkAppearance() ? "night" : "ink") : settings.theme };
}
// What the Settings sheet shows. Keys never go to the page: AI settings has its own sheet.
function settingsState() {
  return {
    settings: Object.fromEntries(Object.keys(SET_KEYS).map((k) => [k, settings[k]])),
    cfg: Object.fromEntries(CFG_FLAT.map((d) => [d.k, cfg(d.k)])),
    cfgSchema: CONFIG.map(([title, items]) => ({ title, items })),
    palettes: PALETTES, version: VERSION, appName: "VisionX",
    blueprints: BLUEPRINTS, blueprintsRepo: BLUEPRINTS_REPO,
    hasKey: !!aiKey(), aiStatus: aiStatusLine(),
  };
}

// Compares "1.10.0" and "1.9.2" as numbers: returns 1, 0 or -1.
function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Never throws and never blocks: any failure just means no update is offered this time.
async function checkForUpdate() {
  if (!settings.checkUpdates || updateSnoozed()) return null;
  try {
    const req = new Request(`${REPO_RAW}releases.json?t=${Date.now()}`);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    if (!data || !Array.isArray(data.releases)) return null;
    const newer = data.releases
      .filter(r => r && r.version && cmpVer(r.version, VERSION) > 0)
      .sort((x, y) => cmpVer(y.version, x.version));
    if (!newer.length) return null;
    // The newest release's highlights first, topped up from older versions the user skipped.
    const highlights = [];
    newer.forEach(r => (r.highlights || []).forEach(h => {
      if (highlights.length < 3 && h && h.title) highlights.push(h);
    }));
    return {
      current: VERSION, latest: newer[0].version, title: newer[0].title || '',
      skipped: newer.length, highlights, script: data.script || SCRIPT_FILE,
    };
  } catch (e) {
    console.log('Update check skipped: ' + e);
    return null;
  }
}

function updateSnoozed() {
  try {
    return Keychain.contains(KC_UPDATE_SNOOZE) && Date.now() < +Keychain.get(KC_UPDATE_SNOOZE);
  } catch (e) { return false; }
}

function snoozeUpdate() {
  Keychain.set(KC_UPDATE_SNOOZE, String(Date.now() + UPDATE_SNOOZE_MS));
}

function clearUpdateSnooze() {
  if (Keychain.contains(KC_UPDATE_SNOOZE)) Keychain.remove(KC_UPDATE_SNOOZE);
}

// Downloads the new script, checks it three ways, then writes it over this script's own file.
async function applyUpdate(info) {
  const req = new Request(`${REPO_RAW}${encodeURI((info && info.script) || SCRIPT_FILE)}?t=${Date.now()}`);
  req.timeoutInterval = 30;
  const code = await req.loadString();
  const okStatus = req.response && req.response.statusCode === 200;
  const m = code && code.match(/const VERSION = '([^']+)'/);
  // 1. A real script for THIS app, not an error page or another project's file
  if (!okStatus || !m || !code.includes(`const APP_ID = '${APP_ID}'`)) {
    throw new Error("The download didn't look right. Try again later.");
  }
  // 2. Actually newer: GitHub's cache can serve the old file for a few minutes after a release
  if (cmpVer(m[1], VERSION) <= 0) {
    throw new Error('GitHub is still serving the old version. Try again in a few minutes.');
  }
  // 3. Write it where the running script lives (iCloud or on the phone)
  const path = module.filename;
  let fm = FileManager.local();
  try {
    const ic = FileManager.iCloud();
    if (path.startsWith(ic.documentsDirectory())) fm = ic;
  } catch (e) {}
  fm.writeString(path, code);
  return m[1];   // the version now installed
}

function storePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), STORE_FILE);
}
function readStore() {
  const fm = FileManager.local();
  const path = storePath();
  if (!fm.fileExists(path)) return null;
  try { return JSON.parse(fm.readString(path)); } catch (_) { return null; }
}
function writeStore(data) {
  if (!dataLoaded) return;   // never save presets over a file that was never read
  FileManager.local().writeString(storePath(), JSON.stringify(data, null, 2));
}

// After the WebView closes, read the latest presets/settings from it and save them.
async function saveOnClose(wv) {
  try {
    const json = await Promise.race([
      wv.evaluateJavaScript("window.exportStore ? window.exportStore() : null"),
      new Promise((resolve) => Timer.schedule(3000, false, () => resolve(null))),
    ]);
    if (json) writeStore(JSON.parse(json));
  } catch (e) {
    console.warn("Couldn't save presets: " + e);
  }
}

// ─────────────── AI configuration ───────────────
// Follows github.com/gadominas/app-blueprints · blueprints/ai-configuration.md (reference: BlogPulse.js).
// Every AI request goes through aiCall. Keys live in the iOS Keychain only; the page sees them masked.

// AI providers. Keychain names are unique per app; models are defaults until the user picks one.
const AI = {
  anthropic: { key: "VISIONX_ANTHROPIC_KEY", model: "claude-haiku-5-5" },
  openai:    { key: "VISIONX_OPENAI_KEY",    model: "gpt-4.1-mini" },
};
const PROVIDERS = { anthropic: "Claude", openai: "OpenAI" };

// AI settings and token usage live in their own small JSON files on this iPhone (never the keys).
const aiFm = FileManager.local();
const aiPath = name => aiFm.joinPath(aiFm.documentsDirectory(), "visionx-" + name + ".json");
function aiLoad(name, fallback) {
  try { const p = aiPath(name); if (aiFm.fileExists(p)) return JSON.parse(aiFm.readString(p)); }
  catch (e) { console.log("AI: couldn't read " + name + ": " + e); }
  return fallback;
}
function aiWrite(name, data) {
  if (name === "usage" && !dataLoaded) return;   // usage is read in loadData(): never save over it before
  try { aiFm.writeString(aiPath(name), JSON.stringify(data)); } catch (e) { console.log("AI: couldn't save " + name + ": " + e); }
}
const aiSettings = Object.assign({
  aiProvider: "anthropic",   // the provider marked "In use"
  ai: true,                  // background AI jobs on/off ("What AI does")
  // model:  { anthropic: "…", openai: "…" }   set when the user picks a model
  // models: { anthropic: { at, list: [{ id, name }] }, openai: … }   cached model lists
}, aiLoad("ai-settings", {}));
const saveAiSettings = () => aiWrite("ai-settings", aiSettings);

const keyFor   = p => Keychain.contains(AI[p].key) ? Keychain.get(AI[p].key) : null;
const aiKey    = () => keyFor(aiSettings.aiProvider);   // the key of the provider in use
const modelFor = p => (aiSettings.model && aiSettings.model[p]) || AI[p].model;
const maskKey  = k => k ? (k.length > 14 ? k.slice(0, 7) + "…" + k.slice(-4) : "…" + k.slice(-4)) : null;

// Run once at start: move a key an earlier version stored elsewhere, then use whichever provider has a key.
function aiMigrate(oldKeyNames, oldModel) {
  for (const old of oldKeyNames || []) {
    if (!Keychain.contains(old)) continue;
    if (!Keychain.contains(AI.openai.key)) Keychain.set(AI.openai.key, Keychain.get(old));
    Keychain.remove(old);
    if (!keyFor("anthropic")) aiSettings.aiProvider = "openai";   // use the key that now exists
  }
  if (oldModel && !(aiSettings.model && aiSettings.model.openai)) aiSettings.model = Object.assign({}, aiSettings.model, { openai: oldModel });
  if (!PROVIDERS[aiSettings.aiProvider]) aiSettings.aiProvider = "anthropic";
  if (!aiKey()) { const other = Object.keys(PROVIDERS).find(p => keyFor(p)); if (other) aiSettings.aiProvider = other; }
  saveAiSettings();
}

async function askKey(p) {
  const cur = keyFor(p);
  const al = new Alert();
  al.title = `${PROVIDERS[p]} API key`;
  al.message = cur ? `The saved key ends in …${cur.slice(-4)}. Paste a new key to replace it.`
                   : "Paste your API key. It's stored in the iOS Keychain on this device only.";
  al.addSecureTextField(p === "openai" ? "sk-…" : "sk-ant-…", "");
  al.addAction("Save key");
  al.addCancelAction("Cancel");
  if (await al.present() !== 0) return false;
  const v = al.textFieldValue(0).trim();
  if (!v) return false;
  Keychain.set(AI[p].key, v);
  if (!aiKey()) aiSettings.aiProvider = p;   // first key saved: use that provider
  return true;
}

function removeKey(p) {
  if (Keychain.contains(AI[p].key)) Keychain.remove(AI[p].key);
}

// The only way the app calls AI. feature: a short tag for the usage table.
// provider: defaults to the one in use; "Test connection" passes the card's provider.
// images: optional photos sent with the user text, as base64 strings (JPEG) or { data, type, detail } (VisionX analyses photos).
// aiCall.last holds this call's input and output tokens, for VisionX's per-session totals.
async function aiCall(system, user, maxTokens = 2500, feature = "other", provider = aiSettings.aiProvider, images = []) {
  const key = keyFor(provider);
  if (!key) throw new Error(`No ${PROVIDERS[provider]} key saved`);
  const openai = provider === "openai", model = modelFor(provider);
  const r = new Request(openai ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages");
  r.method = "POST";
  r.timeoutInterval = 90;
  const imgs = images.map(i => typeof i === "string" ? { data: i } : i);
  const oaUser = imgs.length ? [{ type: "text", text: user }].concat(imgs.map(i => ({ type: "image_url", image_url: Object.assign({ url: `data:${i.type || "image/jpeg"};base64,${i.data}` }, i.detail ? { detail: i.detail } : {}) }))) : user;
  const anUser = imgs.length ? imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.type || "image/jpeg", data: i.data } })).concat([{ type: "text", text: user }]) : user;
  if (openai) {
    r.headers = { "Authorization": "Bearer " + key, "Content-Type": "application/json" };
    r.body = JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: oaUser }] });
  } else {
    r.headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    r.body = JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: anUser }] });
  }
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || "AI request failed");
  const u = j.usage || {};
  recordUsage(provider, model, feature,
    openai ? (u.prompt_tokens || 0) : (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    openai ? (u.completion_tokens || 0) : (u.output_tokens || 0));
  aiCall.last = openai ? { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 }
    : { in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0 };
  return openai ? ((j.choices && j.choices[0] && j.choices[0].message.content) || "")
                : (j.content || []).map(c => c.text || "").join("");
}

// For prompts that ask for JSON: tolerate code fences and stray text around it.
function parseJSON(txt) {
  const s = String(txt).replace(/```json|```/g, "").trim();
  const a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  return JSON.parse(s.slice(a, b + 1));
}

// Token usage, counted from what the provider reports, per provider, model, feature and local day.
var usage = { since: Date.now(), p: {} };   // read in loadData()
const aiDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function recordUsage(provider, model, feature, tin, tout) {
  const P = usage.p[provider] = usage.p[provider] || { calls: 0, in: 0, out: 0, models: {}, features: {}, days: {} };
  const b = (o, k) => o[k] = o[k] || { calls: 0, in: 0, out: 0 };
  for (const x of [P, b(P.models, model), b(P.features, feature), b(P.days, aiDayKey())]) {
    x.calls++; x.in += tin; x.out += tout;
  }
  const days = Object.keys(P.days).sort();
  while (days.length > 400) delete P.days[days.shift()];   // keep about 13 months of days
  aiWrite("usage", usage);   // save after every call: the app can be closed at any moment
}

function resetUsage() { usage = { since: Date.now(), p: {} }; aiWrite("usage", usage); }

// The models the user's own key can call, newest first; cached so the menu works offline.
async function fetchModels(p) {
  const key = keyFor(p);
  if (!key) throw new Error(`Add a ${PROVIDERS[p]} key first`);
  const r = new Request(p === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models?limit=100");
  r.headers = p === "openai" ? { "Authorization": "Bearer " + key } : { "x-api-key": key, "anthropic-version": "2023-06-01" };
  r.timeoutInterval = 20;
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || "Couldn't load models");
  let list = (j.data || []).map(m => ({
    id: m.id, name: m.display_name || m.id,
    t: m.created_at ? Date.parse(m.created_at) : (m.created || 0) * 1000,
  }));
  // OpenAI lists every model the key can reach; keep only the ones that write text.
  if (p === "openai") list = list.filter(m => /^(gpt-|o\d|chatgpt-)/.test(m.id)
    && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation)/.test(m.id));
  list.sort((a, b) => b.t - a.t);
  aiSettings.models = aiSettings.models || {};
  aiSettings.models[p] = { at: Date.now(), list: list.map(m => ({ id: m.id, name: m.name })) };
  saveAiSettings();
  return list.length;
}

// Bridge actions from the AI settings sheet. Returns the toast to show ("" for none).
const AI_ACTIONS = ["aistate", "aikey", "airm", "aiprov", "aimodels", "aimodel", "aitest", "usagereset", "aitoggle"];
async function aiAction(head, m) {
  const P = PROVIDERS[m.v] ? m.v : aiSettings.aiProvider;
  let msg = "";
  switch (head) {
    case "aikey":
      if (await askKey(P)) {
        aiSettings.ai = true; saveAiSettings();
        try { const n = await fetchModels(P); msg = `${PROVIDERS[P]} key saved — ${n} models available`; }
        catch (e) { msg = `Key saved, but checking it failed: ${String(e.message || e).slice(0, 70)}`; }
      }
      break;
    case "airm": removeKey(P); msg = `${PROVIDERS[P]} key removed`;
      if (!aiKey()) { const other = Object.keys(PROVIDERS).find(p => keyFor(p)); if (other) aiSettings.aiProvider = other; }
      aiInviteKeyRemoved();   // the last key gone: the AI invitation may come back from the next launch
      break;
    case "aiprov": if (PROVIDERS[m.v] && keyFor(m.v)) aiSettings.aiProvider = m.v; break;
    case "aimodels":
      try { const n = await fetchModels(P); msg = `${n} ${PROVIDERS[P]} models found`; }
      catch (e) { msg = String(e.message || e).slice(0, 90); }
      break;
    case "aimodel":
      if (PROVIDERS[m.p] && m.v) { aiSettings.model = aiSettings.model || {}; aiSettings.model[m.p] = m.v; msg = `${PROVIDERS[m.p]} now uses ${m.v}`; }
      break;
    case "aitest": {
      const t0 = Date.now();
      try {
        await aiCall("Reply with the single word OK.", "Connection test.", 10, "test", P);
        msg = `${PROVIDERS[P]} works — ${modelFor(P)} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
      } catch (e) { msg = `${PROVIDERS[P]} test failed: ${String(e.message || e).slice(0, 80)}`; }
      break;
    }
    case "usagereset": resetUsage(); msg = "Usage counters reset"; break;
    case "aitoggle": aiSettings.ai = !aiSettings.ai; break;
  }
  saveAiSettings();
  return msg;
}

// What the page gets. Keys appear only masked.
function aiClientState() {
  return {
    provider: aiSettings.aiProvider,
    keys:  Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, maskKey(keyFor(p))])),
    model: Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, modelFor(p)])),
    models: aiSettings.models || {}, usage, today: aiDayKey(),
    ai: aiSettings.ai, hasKey: !!aiKey(),
  };
}
// One-line status for the app's Settings row: "Claude — claude-haiku-5-5 — 12.4k tokens used".
function aiStatusLine() {
  if (!aiKey()) return "";
  const P = usage.p[aiSettings.aiProvider];
  return `${PROVIDERS[aiSettings.aiProvider]} — ${modelFor(aiSettings.aiProvider)}` +
    (P && P.calls ? ` — ${aiFmtN(P.in + P.out)} tokens used` : "");
}
const aiFmtN = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
// ─────────────── end of AI configuration ───────────────

// ── AI invitation (app-blueprints · ai-invitation) ──
// When it may appear. Its state lives in settings.json as settings.aiInvite (no UI of its own).
const INVITE_DAY = 864e5;
const INVITE_GAP = 3;          // days between invitations (about twice a week)
const INVITE_GAP_SLOW = 7;     // days between invitations after the 4th "Later"
function aiInviteDue(now = Date.now()) {
  const s = settings.aiInvite || (settings.aiInvite = {});
  if (aiKey()) return false;   // a key means AI is on: nothing to invite to
  if (appleIntelligenceInUse()) return false;   // VisionX deviation: Apple Intelligence already does the AI, without a key
  if (s.off) return false;     // "Don't remind me again"
  return now >= (s.next || 0); // from the very first launch (right after install), then at most every 3 days
}
// VisionX deviation (docs/BLUEPRINTS.md): Apple Intelligence analyzes photos, refines instructions and checks
// triggers through Shortcuts, with no key. While it is picked under "Analyze with" and has already worked
// (a saved session with photos analyzed on it), AI is on for this user, so there is nothing to invite to.
// "Analyze with" alone can't tell: without a key it always shows Apple Intelligence, set up or not.
function appleIntelligenceInUse() {
  const engine = (store && store.settings && store.settings.engine) || "apple";
  return engine === "apple" && sessions.some((m) => m && m.engine === "Apple Intelligence" && m.photos > 0);
}
// Removing the last key turns AI off: invite again from the next launch (called in the "airm" action).
function aiInviteKeyRemoved() {
  if (aiKey()) return;
  const s = settings.aiInvite || (settings.aiInvite = {});
  s.next = 0; saveSettings();
}
// The page reports what happened: "shown", "open", "later" or "never".
function aiInviteNote(what, now = Date.now()) {
  const s = settings.aiInvite || (settings.aiInvite = {});
  if (what === "shown") { s.shown = (s.shown || 0) + 1; s.next = now + INVITE_GAP * INVITE_DAY; }
  else if (what === "later") { s.later = (s.later || 0) + 1; s.next = now + (s.later >= 4 ? INVITE_GAP_SLOW : INVITE_GAP) * INVITE_DAY; }
  else if (what === "never") s.off = true;
  else return;   // "open": the AI sheet takes over; "shown" already set the next date
  saveSettings();
}

// Photo analysis, instruction refining and trigger checks all come here from the page.
// p: { system, text, image (data URL), detail, maxTokens, feature }
async function visionAI(p) {
  if (!aiKey()) {
    const e = new Error("no Claude or OpenAI key is saved. Add one in Settings › AI settings, or use Apple Intelligence");
    e.fatal = true;
    throw e;
  }
  const provider = aiSettings.aiProvider, model = modelFor(provider);
  const m = /^data:(image\/[a-z]+);base64,/.exec(String(p.image || ""));
  const images = p.image ? [{ data: String(p.image).slice(m ? m[0].length : 0), type: m ? m[1] : "image/jpeg", detail: p.detail }] : [];
  try {
    const text = await aiCall(p.system || "Follow the user's instructions exactly.", String(p.text || ""), p.maxTokens || 2000, p.feature || "other", provider, images);
    const u = aiCall.last || { in: 0, out: 0 };
    return { text, by: PROVIDERS[provider], model, usage: { prompt_tokens: u.in, completion_tokens: u.out, total_tokens: u.in + u.out } };
  } catch (e) {
    const err = new Error(String((e && e.message) || e));
    // A bad key, a missing model or no credit won't fix itself: stop the session instead of retrying every photo.
    err.fatal = /api.?key|authenticat|permission|not.?found|does not exist|quota|credit balance|billing/i.test(err.message);
    throw err;
  }
}

// ───────── Bridge: the page asks Scriptable to make calls on its behalf ─────────
// Page → Scriptable: the page loads a hidden "vsbridge://call?id=N" frame, which
// shouldAllowRequest intercepts. Scriptable then pulls the request with take(N),
// does the work natively and hands the answer back with reply(N, json).
function attachBridge(wv, ctx) {
  wv.shouldAllowRequest = (req) => {
    const url = String((req && req.url) || "");
    if (url.indexOf("vsbridge://") === 0) {
      const id = parseInt(url.split("id=")[1], 10);
      if (id) handleBridgeCall(wv, ctx, id);
      return false;
    }
    return true;
  };
}

async function handleBridgeCall(wv, ctx, id) {
  let reply;
  try {
    const raw = await wv.evaluateJavaScript("window.__bridge.take(" + id + ")");
    if (!raw) return;
    const msg = JSON.parse(raw);
    let result;
    if (msg.type === "ai") result = await visionAI(msg.payload || {});
    else if (AI_ACTIONS.includes(msg.type)) {   // AI settings sheet (app-blueprints · ai-configuration)
      const t = await aiAction(msg.type, msg.payload || {});
      await wv.evaluateJavaScript("window.__aiState(" + JSON.stringify(aiClientState()) + "); 'ok'").catch(() => {});
      if (t) await wv.evaluateJavaScript("window.__aiToast(" + JSON.stringify(t) + "); 'ok'").catch(() => {});
      result = true;
    }
    else if (msg.type === "apple") result = await runAppleShortcut(msg.payload);
    else if (msg.type === "appleText") result = (await runShortcutText(msg.payload.shortcut, msg.payload.text)).text;
    else if (msg.type === "runShortcut") result = await runShortcutText(msg.payload.shortcut, msg.payload.text);
    else if (msg.type === "save") { writeStore(msg.payload); result = true; }
    // Settings (app-blueprints · settings): each change is applied and saved at once; the answer is the fresh state.
    else if (msg.type === "settings-get") result = settingsState();
    else if (msg.type === "sessionSave") result = sessionSave(msg.payload);
    else if (msg.type === "sessionGet") result = sessionGet(msg.payload && msg.payload.id);
    else if (msg.type === "sessionDelete") result = sessionDelete(msg.payload && msg.payload.id);
    else if (msg.type === "sessionList") result = sessionList();
    else if (msg.type === "widget") {   // the live session for the Home Screen widget (app-blueprints · widgets): only these fields are kept
      const q = msg.payload || {};
      saveWidget(q.running ? { running: true, preset: String(q.preset || "").slice(0, 60), interval: Math.round(+q.interval) || 0,
        photos: Math.round(+q.photos) || 0, startedAt: +q.startedAt || Date.now() } : { running: false });
      result = true;
    }
    else if (msg.type === "set") {
      const q = msg.payload || {};
      if (!setSetting(q.k, q.v)) throw new Error("That setting can\u2019t be changed here.");
      saveSettings(); result = settingsState();
    }
    else if (msg.type === "cfg") {
      const q = msg.payload || {};
      if (q.k === "*") settings.cfg = {}; else setCfg(q.k, q.reset ? null : q.v);
      saveSettings(); result = settingsState();
    }
    else if (msg.type === "update-check") {   // Settings › Check for updates now: clears "Later" and checks at once
      clearUpdateSnooze();
      const was = settings.checkUpdates; settings.checkUpdates = true;
      const u = await checkForUpdate(); settings.checkUpdates = was;
      ctx.update = u || ctx.update;
      result = { available: !!u, info: u, msg: u ? "Version " + u.latest + " is available" : "You're on the latest version (" + VERSION + ")" };
    }
    else if (msg.type === "openurl") {   // Built with: only the blueprints repository opens from here
      const v = String((msg.payload || {}).v || "");
      if (v === BLUEPRINTS_REPO || v.startsWith(BLUEPRINTS_REPO + "/")) await Safari.openInApp(v, false);
      result = true;
    }
    else if (msg.type === "startlog") {   // Settings › Updates › Start-up log (safe-startup recipe)
      let txt = "";
      try { txt = FileManager.local().readString(LOG_PATH).split("\n").slice(-40).join("\n"); } catch (e) {}
      result = txt;
    }
    else if (msg.type === "aiinvite") { aiInviteNote((msg.payload || {}).v); result = true; }   // AI invitation: shown, open, later or never
    else if (msg.type === "copy") { Pasteboard.copy(String(msg.payload.text || "")); result = true; }
    else if (msg.type === "updateLater") { snoozeUpdate(); ctx.update = null; result = true; }
    else if (msg.type === "updateNow") {
      if (!ctx.update) throw new Error("No update is waiting. Close and reopen VisionX to check again.");
      result = await applyUpdate(ctx.update);
      ctx.update = null;
      clearUpdateSnooze();
    }
    else throw new Error("unknown request type " + msg.type);
    reply = { ok: true, result };
  } catch (e) {
    reply = { ok: false, error: String((e && e.message) || e), fatal: !!(e && e.fatal) };
  }
  try {
    await wv.evaluateJavaScript("window.__bridge.reply(" + id + ", " + JSON.stringify(JSON.stringify(reply)) + ")");
  } catch (e) {
    console.warn("Bridge reply failed: " + e);
  }
}

// Runs any shortcut with text as its input and returns its text output (if any).
// Used for trigger shortcuts and for the Apple Intelligence trigger checker.
async function runShortcutText(name, text) {
  const cb = new CallbackURL("shortcuts://x-callback-url/run-shortcut");
  cb.addParameter("name", name);
  cb.addParameter("input", "text");
  cb.addParameter("text", text || "");
  let res;
  try {
    res = await cb.open();
  } catch (e) {
    throw new Error("the shortcut \u201C" + name + "\u201D failed or was cancelled. Check the exact name and that it runs on its own");
  }
  return { text: (res && (res.result || res.output)) || "" };
}

// Runs the user's Shortcut, which takes the photo, copies it to the clipboard,
// asks Apple Intelligence and outputs the answer as text.
async function runAppleShortcut(p) {
  Pasteboard.copy(""); // so an older clipboard image can't pass for the new photo
  const cb = new CallbackURL("shortcuts://x-callback-url/run-shortcut");
  cb.addParameter("name", p.shortcut);
  cb.addParameter("input", "text");
  cb.addParameter("text", p.prompt);
  let res;
  try {
    res = await cb.open();
  } catch (e) {
    const err = new Error("the shortcut \u201C" + p.shortcut + "\u201D failed or was cancelled. Check that it exists with exactly this name and runs on its own in Shortcuts");
    err.fatal = true;
    throw err;
  }
  const text = (res && (res.result || res.output)) || "";
  let photo = null;
  // Reading the clipboard is what makes iOS ask "Allow Paste". With
  // "Show each photo here" off, VisionX never reads it.
  if (p.wantPhoto !== false) {
    const img = Pasteboard.pasteImage();
    if (img) photo = "data:image/jpeg;base64," + Data.fromJPEG(img).toBase64String();
  }
  Pasteboard.copy(""); // the photo doesn't stay on the clipboard (writing never prompts)
  return { text, photo };
}

// What the page boots from, handed over by bootApp() once the data is read (never inlined in buildHTML).
// The page never gets a key: only whether one is saved, and which provider and model are in use.
function clientState() {
  return {
    ai: { hasKey: !!aiKey(), name: PROVIDERS[aiSettings.aiProvider], model: modelFor(aiSettings.aiProvider) },
    defaultShortcut: DEFAULT_SHORTCUT,
    version: VERSION,
    store,
    look: lookState(),
    cfg: Object.fromEntries(CFG_FLAT.map((d) => [d.k, cfg(d.k)])),
    sessions,
  };
}
const safeJSON = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// ---------- run ----------
// A run marks itself as open while its window is on screen. A new run waits at most 1.5 s for an older
// window to close, then opens anyway: quick taps on the widget don't stack up copies.
const lockFm = FileManager.local();
const RUN_LOCK = lockFm.joinPath(lockFm.temporaryDirectory(), APP_ID + '-running');
let lockTimer = null;
const lockAge = () => { try { return lockFm.fileExists(RUN_LOCK) ? Date.now() - Number(lockFm.readString(RUN_LOCK)) : Infinity; } catch (e) { return Infinity; } };
const pause = ms => new Promise(r => Timer.schedule(ms, false, r));
async function waitForOtherWindow() { for (let waited = 0; lockAge() < 2500 && waited < 1500; waited += 300) await pause(300); }
function holdLock() {
  const beat = () => { try { lockFm.writeString(RUN_LOCK, String(Date.now())); } catch (e) {} };
  beat(); lockTimer = Timer.schedule(1000, true, beat);
}
function releaseLock() {
  if (lockTimer) { lockTimer.invalidate(); lockTimer = null; }
  try { if (lockFm.fileExists(RUN_LOCK)) lockFm.remove(RUN_LOCK); } catch (e) {}
}
let wv = null;
const ctx = {};          // the bridge's run state: ctx.update is the update on offer (VisionX's pendingUpdate)
function buildWebView() {
  wv = new WebView();
  attachBridge(wv, ctx);
}
// Talks to the page with a time limit, so a stuck page can't stall the app.
const ev = (js, ms = 20000) => Promise.race([wv.evaluateJavaScript(js, false), pause(ms).then(() => { throw new Error("the page didn't respond in " + ms / 1000 + " s"); })]);

// One offer per launch, and an update wins: call this once the update check has settled.
function inviteIfDue() {
  if (!ctx.update && aiInviteDue()) ev(`window.__aiInvite && window.__aiInvite(${JSON.stringify(AI_INVITE)}); 'ok'`).catch(() => {});
}

async function bootApp(isClosed) {
  const t0 = Date.now();
  startLog(`VisionX ${VERSION}: reading data`);
  await loadData();
  // 1.7.x kept one OpenAI key (or a "use Apple Intelligence only" choice) under other names.
  aiMigrate(["vision_session_openai_key"], null);
  if (Keychain.contains("vision_session_openai_key_skipped")) Keychain.remove("vision_session_openai_key_skipped");
  try { sessions = sessionList(); } catch (e) {}   // the app keeps only the last "Sessions kept"
  startLog(`data read in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${sessions.length} sessions, ${((store && store.presets) || []).length} presets${loadIssues.length ? "; missing: " + loadIssues.join(", ") : ""}`);
  if (isClosed()) return;
  const st = clientState(), list = st.sessions;
  st.sessions = [];
  for (let i = 0; i < list.length; i += 3) await ev(`window.__parts.push(${safeJSON(list.slice(i, i + 3))})`);   // in pieces: one huge message can stall WebKit
  await ev(`window.__boot(${safeJSON(st)}); 'ok'`);
  let seen = "";
  try { seen = await ev(`document.visibilityState + ", " + innerWidth + "x" + innerHeight`, 5000); } catch (e) { seen = String(e.message || e); }
  startLog(`screen ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (page: ${seen})`);
  if (loadIssues.length) ev(`window.__aiToast(${safeJSON("Some of your data is still coming from iCloud. Nothing will be saved until you reopen VisionX.")}); 'ok'`).catch(() => {});
  // Deferred work, once the first screen is drawn (VisionX has no refresh of its own): updates, then the widget's icon.
  Timer.schedule(3500, false, () => {
    if (isClosed()) return;
    checkForUpdate().then((u) => {
      ctx.update = u;
      if (u) return ev("window.__showUpdate && window.__showUpdate(" + JSON.stringify(u) + "); 'ok'");
    }).catch(() => {}).then(inviteIfDue);   // AI invitation: after the update check, never with an offer
  });
  Timer.schedule(6000, false, () => { widgetIcon(); });   // caches the logo tile for the widget
}

async function main() {
  await waitForOtherWindow();
  buildWebView();
  // A page built before its window is on screen can stay blank on some iPhones (the page runs, nothing is drawn),
  // most often when opened from the widget. So: an empty dark window first, then the real page built inside it.
  await wv.loadHTML('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#0E1116"></body></html>');
  const presented = wv.present(true);
  holdLock();
  await pause(300);                          // let the window finish appearing
  startLog("window on screen");
  // An https base URL gives the page a secure origin, which the camera API requires.
  await Promise.race([wv.loadHTML(buildHTML(), "https://localhost/"), pause(15000)]);   // the launch screen, drawn on screen
  let closed = false;
  presented.then(() => { closed = true; releaseLock(); });
  bootApp(() => closed).catch(e => {         // runs beside the window: closing it never waits on this
    startLog("start-up failed: " + (e.message || e));
    let log = "";
    try { log = FileManager.local().readString(LOG_PATH).split("\n").slice(-12).join("\n"); } catch (x) {}
    if (!closed) wv.evaluateJavaScript(`window.__bootNote("VisionX couldn't open", ${safeJSON(log)}); 'ok'`, false).catch(() => {});
  });
  await presented;
  closed = true;
  releaseLock();
  await saveOnClose(wv);                     // writeStore() skips presets that were never read
}

// ───────────────────────────── Page ─────────────────────────────

// The page only: the data comes later through window.__boot (safe-startup recipe). Settings (the look) are loaded.
function buildHTML() {
  const look = lookState();
  return `<!doctype html>
<html lang="en" data-theme="${look.shown}" data-font="${look.font}" style="--ts:${look.textSize}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>VisionX</title>
<style>
:root{
  --ts:1; --serif: ui-serif, "New York", Georgia, serif; --rounded: ui-rounded, -apple-system, system-ui, sans-serif;
  --display: var(--rounded); --pad:12px 14px; --gap:14px;
}
html[data-font=serif]{--display:var(--serif)}
${PALETTE_CSS}
:root{--surface:var(--sheet);--graphite:var(--muted);--done:var(--signal);--field:color-mix(in srgb,var(--ink) 6%,var(--paper))}
body.d-compact{--pad:9px 12px;--gap:10px}
body.d-tiny{--pad:8px 12px;--gap:8px}
*{box-sizing:border-box}
html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%}
button,select,input,label,summary{touch-action:manipulation}
html,body{margin:0;background:var(--paper);color:var(--ink)}
body{
  font:calc(16px * var(--ts))/1.45 -apple-system,system-ui,sans-serif;
  padding:calc(env(safe-area-inset-top,0px) + 14px) 16px calc(env(safe-area-inset-bottom,0px) + 32px);
  max-width:720px;margin:0 auto;
}
.num{font-family:ui-rounded,-apple-system,system-ui,sans-serif;font-variant-numeric:tabular-nums}
h1{font:700 calc(28px * var(--ts))/1.1 var(--display);margin:0;letter-spacing:-.01em}
h2{font-size:calc(17px * var(--ts));margin:0 0 6px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.topR{display:flex;align-items:center;gap:10px}
.top .icon{width:40px;height:40px;border-radius:20px;display:grid;place-items:center;background:var(--sheet);border:1px solid var(--rule);color:var(--ink);padding:0;cursor:pointer;flex:none}
.top .icon svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.status{display:flex;align-items:center;gap:8px;color:var(--graphite);font-size:calc(14px * var(--ts))}
.dot{width:10px;height:10px;border-radius:50%;background:var(--rule)}
.running .dot{background:var(--rec);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.running .dot{animation:none}}

details.settings{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:var(--pad);margin-bottom:var(--gap)}
details.settings>summary{font-weight:600;cursor:pointer}
label{display:block;font-size:calc(13px * var(--ts));color:var(--graphite);margin-top:12px}
textarea,input,select{
  display:block;width:100%;margin-top:4px;padding:10px 12px;font:inherit;color:var(--ink);
  background:var(--field);border:1px solid transparent;border-radius:10px;
}
textarea{resize:vertical;min-height:80px}
textarea:focus,input:focus,select:focus{outline:none;border-color:var(--ink)}
:disabled{opacity:.55}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.hint{font-size:calc(12px * var(--ts));color:var(--graphite);margin-top:4px}
.howto{margin-top:10px;font-size:calc(14px * var(--ts))}
.howto summary{cursor:pointer;color:var(--ink);font-weight:500}
.howto ol{margin:8px 0 0;padding-left:20px}
.howto li{margin:4px 0}
.switch{display:flex;align-items:center;gap:12px;margin-top:16px;font-size:calc(15px * var(--ts));color:var(--ink);cursor:pointer}
.switch input{
  -webkit-appearance:none;appearance:none;display:inline-block;flex:none;width:46px;height:28px;margin:0;padding:0;
  border:0;border-radius:14px;background:var(--rule);position:relative;cursor:pointer;transition:background .2s
}
.switch input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
.switch input:checked{background:var(--done)}
.switch input:checked::after{transform:translateX(18px)}
.switch input:focus-visible{outline:3px solid var(--done);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.switch input,.switch input::after{transition:none}}
.trigCount{font-weight:400;font-size:calc(13px * var(--ts));color:var(--graphite);margin-left:6px}
.trigList{display:grid;gap:8px;margin-top:10px}
.tItem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--field)}
.tItem .switch,.trow .switch{margin:0;flex:none}
.tItem.off .tText,.trow.off .tbody{opacity:.5}
.trow.off .tdot{background:transparent;border:2px solid var(--rule)}
.tItem .tText{flex:1;min-width:0}
.tItem .chip{flex:none}
.tsub{display:block;font-size:calc(12px * var(--ts));color:var(--graphite);overflow-wrap:anywhere}
.trigForm{margin-top:10px;padding-top:4px;border-top:1px solid var(--rule)}
#tPick{margin-bottom:6px}
.trigStatus{display:grid;gap:6px;margin-bottom:14px}
.trow{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--rule);border-radius:10px;background:var(--surface);transition:box-shadow .4s}
.tdot{width:12px;height:12px;border-radius:50%;margin-top:4px;flex:none;background:var(--rule)}
.trow .tbody{flex:1;min-width:0}
.trow.checking .tdot,.trow.firing .tdot{background:var(--graphite);animation:pulse 1s ease-in-out infinite}
.trow.met .tdot{background:var(--done)}
.trow.lit{border-color:var(--done);background:color-mix(in srgb,var(--done) 12%,var(--surface))}
.trow.lit .tdot{background:var(--done)}
.trow.error .tdot{background:var(--rec)}
.trow.flash{box-shadow:0 0 0 3px var(--done)}
.tcount{flex:none;font:700 calc(20px * var(--ts))/1 ui-rounded,-apple-system,system-ui,sans-serif;color:var(--done);font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.trow{transition:none}.trow.checking .tdot,.trow.firing .tdot{animation:none}}
.placeholder{aspect-ratio:4/3;display:grid;place-items:center;color:#9aa3ae;font-size:calc(14px * var(--ts));background:#000}
.presetBar{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.presetBar input{flex:1 1 150px;margin:0;width:auto}
.chip{
  height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--rule);
  background:transparent;color:var(--ink);font:500 calc(14px * var(--ts))/1 -apple-system,system-ui,sans-serif;cursor:pointer
}
.chip.primary{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.chip.danger{color:var(--rec)}
.chip.armed{background:var(--rec);color:#fff;border-color:var(--rec)}
.chip:focus-visible{outline:3px solid var(--done);outline-offset:2px}

.control{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.liveWrap{width:72px;height:72px;border-radius:12px;overflow:hidden;background:#000;flex:none;transition:width .25s,height .25s}
.liveWrap.aiming{width:150px;height:150px}
.live{display:block;width:100%;height:100%;object-fit:cover;transform-origin:center}
.zoomRow{display:flex;align-items:center;gap:10px;margin:-2px 0 12px}
.zoomRow label{margin:0;font-size:calc(13px * var(--ts));color:var(--graphite);flex:none}
.zoomRow input[type=range]{flex:1;width:auto;margin:0;padding:0;background:transparent;border:0;accent-color:var(--done);height:28px}
.zoomRow output{flex:none;min-width:3.2em;text-align:right;font-weight:600}
.zoomRow .chip{height:30px;padding:0 10px;flex:none}
.zoomHint{font-size:calc(12px * var(--ts));color:var(--graphite);margin:-8px 0 12px}
@media (prefers-reduced-motion:reduce){.liveWrap{transition:none}}
.btn{
  flex:1;height:56px;border:0;border-radius:28px;font:600 calc(17px * var(--ts))/1 -apple-system,system-ui,sans-serif;
  color:#fff;background:var(--rec);cursor:pointer;
}
.btn.stop{background:var(--ink);color:var(--paper)}
.btn:focus-visible{outline:3px solid var(--done);outline-offset:3px}
.btn:disabled{opacity:.6}

.strip{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-bottom:14px}
.strip div{padding:10px 4px;text-align:center}
.strip div+div{border-left:1px solid var(--rule)}
.strip b{display:block;font-size:calc(20px * var(--ts))}
.strip span{font-size:calc(12px * var(--ts));color:var(--graphite)}

.error{background:color-mix(in srgb,var(--rec) 12%,var(--surface));border-left:4px solid var(--rec);padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:calc(14px * var(--ts))}
.hidden{display:none!important}

.muted{color:var(--graphite)}
.tracked{margin:10px 0 0;font-size:calc(13px * var(--ts));color:var(--graphite)}
.tracked pre.old{white-space:pre-wrap;word-break:break-word;background:var(--field);padding:10px;border-radius:8px;font-size:calc(12px * var(--ts));margin:6px 0 0;max-height:240px;overflow:auto}

/* Latest frame: the viewfinder */
.finder{position:relative;border-radius:6px;overflow:hidden;background:#000}
.finder img{display:block;width:100%;max-height:52vh;object-fit:contain}
.finder::before,.finder::after,.finder i::before,.finder i::after{
  content:"";position:absolute;width:22px;height:22px;border:3px solid rgba(255,255,255,.9);pointer-events:none
}
.finder::before{top:10px;left:10px;border-right:0;border-bottom:0}
.finder::after{top:10px;right:10px;border-left:0;border-bottom:0}
.finder i::before{bottom:10px;left:10px;border-right:0;border-top:0}
.finder i::after{bottom:10px;right:10px;border-left:0;border-top:0}
.tag{position:absolute;left:14px;bottom:14px;background:rgba(0,0,0,.6);color:#fff;font-size:calc(13px * var(--ts));padding:3px 8px;border-radius:6px}
/* Latest photo and the running summary, side by side */
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:stretch}
@media (min-width:600px){.hero{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}}
.hero .finder img{max-height:60vh}
.hero .finder .placeholder{aspect-ratio:3/4}
.hero .finder::before,.hero .finder::after,.hero .finder i::before,.hero .finder i::after{width:16px;height:16px;border-width:2px}
.hero .finder::before{top:8px;left:8px}.hero .finder::after{top:8px;right:8px}
.hero .finder i::before{bottom:8px;left:8px}.hero .finder i::after{bottom:8px;right:8px}
.hero .tag{left:10px;bottom:10px;font-size:calc(12px * var(--ts));padding:2px 6px}
.heroSummary{position:relative;min-height:180px;background:var(--surface);border:1px solid var(--rule);border-radius:12px;transition:box-shadow .4s}
.heroSummary .scroll{position:absolute;inset:0;overflow:auto;padding:10px 12px;-webkit-overflow-scrolling:touch}
.heroSummary h2{font-size:calc(13px * var(--ts));font-weight:600;color:var(--graphite);margin:0 0 6px}
.heroSummary p{margin:0;font-size:calc(15px * var(--ts));line-height:1.4;white-space:pre-wrap;word-break:break-word}
.heroSummary .meta{margin:8px 0 0}
.heroSummary.fresh{box-shadow:0 0 0 2px var(--done)}
@media (prefers-reduced-motion:reduce){.heroSummary{transition:none}}
.latestNote .text{margin:10px 2px 0;font-size:calc(15px * var(--ts))}
.meta{font-size:calc(12px * var(--ts));color:var(--graphite);margin:8px 2px 0}

.older{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}
.older img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#000}
.older .text{font-size:calc(13px * var(--ts));margin:6px 2px 0;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.text.err{color:var(--rec)}
.text.pending{color:var(--graphite);font-style:italic}

/* End-of-session sheet */
.labelRow{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:12px}
.labelRow label{margin:0}
.labelRow .chips{display:flex;gap:6px;flex:none}
.chip.small{height:30px;padding:0 10px;font-size:calc(13px * var(--ts))}
.editor{
  position:fixed;inset:0;z-index:20;background:var(--paper);display:flex;flex-direction:column;overflow:auto;
  padding:calc(env(safe-area-inset-top,0px) + 10px) 16px calc(env(safe-area-inset-bottom,0px) + 20px)
}
.edHead{display:flex;align-items:center;gap:10px}
.edTitles{flex:1;min-width:0;text-align:center}
.edTitles h2{margin:0;font-size:calc(17px * var(--ts))}
.edTitles .hint{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#edText{flex:0 0 auto;height:32vh;min-height:180px;margin-top:12px;font-size:calc(16px * var(--ts));line-height:1.5;resize:none}
.edMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;min-height:30px}
.edRefine{margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)}
.edRefine h2{font-size:calc(15px * var(--ts));margin:0}
.edGo{width:100%;margin-top:10px}
.edSuggest{margin-top:12px}
.edProposal{white-space:pre-wrap;background:var(--surface);border:1px solid var(--done);border-radius:10px;padding:10px 12px;margin-top:6px;font-size:calc(15px * var(--ts));line-height:1.45}
:root{--jk:#1d4ed8;--js:#0f766e;--jn:#b45309;--jb:#be185d;--jp:#6b7280}
@media (prefers-color-scheme:dark){:root{--jk:#7cb7ff;--js:#5eead4;--jn:#fbbf24;--jb:#f472b6;--jp:#8c96a3}}
.jk{color:var(--jk)}.js{color:var(--js)}.jn{color:var(--jn)}.jb{color:var(--jb);font-weight:600}.jp{color:var(--jp)}.jl{font-weight:700;color:var(--ink)}
.code{font:calc(12px * var(--ts))/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;background:var(--field);color:var(--ink);padding:10px;border-radius:8px;max-height:280px;overflow:auto;margin:4px 0 0}
.code.bad{color:var(--rec)}
#debugBox{margin-top:18px}
.dbgList{display:grid;gap:8px;margin-top:10px}
details.dbg{border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
.dbgHead{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;list-style:none}
.dbgHead::-webkit-details-marker{display:none}
.dbgHead img,.dbgNoImg{width:44px;height:44px;border-radius:6px;object-fit:cover;flex:none;background:#000}
.dbgText{flex:1;min-width:0}
.dbgStatus{flex:none;font-size:calc(12px * var(--ts));font-weight:600;padding:2px 8px;border-radius:10px}
.dbgStatus.good{color:var(--done)}.dbgStatus.bad{color:var(--rec)}.dbgStatus.wait{color:var(--graphite)}
.dbgBody{padding:0 10px 10px}
.dbgBody h3{font-size:calc(12px * var(--ts));font-weight:600;color:var(--graphite);margin:12px 0 0}
.dbgPhoto{display:block;max-width:100%;max-height:40vh;border-radius:6px;margin-top:4px}
details.dbgCheck{margin-top:10px;border-top:1px solid var(--rule);padding-top:6px}
details.dbgCheck>summary{font-size:calc(13px * var(--ts));cursor:pointer}
#aisheet{--ai-paper:var(--paper);--ai-sheet:var(--surface);--ai-rule:var(--rule);--ai-ink:var(--ink);--ai-muted:var(--graphite);--ai-signal:var(--done);--ai-wash:color-mix(in srgb,var(--ai-signal) 14%,transparent);--ai-danger:var(--rec);
  position:fixed;inset:0;z-index:60;background:var(--ai-paper);color:var(--ai-ink);transform:translateY(102%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s;overflow-y:auto;-webkit-overflow-scrolling:touch;font:calc(15px * var(--ts))/1.4 -apple-system,system-ui,sans-serif;text-align:left}
#aisheet.open{transform:none;visibility:visible;transition:transform .28s ease}
#aisheet *{box-sizing:border-box}
#aisheet button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer;-webkit-appearance:none;appearance:none;touch-action:manipulation}
#aisheet .sh-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;background:var(--ai-paper);border-bottom:1px solid var(--ai-rule)}
#aisheet .sh-head h2{margin:0;font-size:calc(22px * var(--ts));font-weight:700}
#aisheet .sh-body{padding:4px 16px calc(28px + env(safe-area-inset-bottom,0px));max-width:680px;margin:0 auto}
#aisheet .link{color:var(--ai-signal);font-weight:600;font-size:calc(17px * var(--ts));padding:8px 0 8px 12px}
#aisheet .hint{font-size:calc(14px * var(--ts));color:var(--ai-muted);margin:12px 0 0}
#aisheet .muted{color:var(--ai-muted)} #aisheet .small{font-size:calc(13px * var(--ts))} #aisheet .pad{padding:4px 0 8px;margin:0}
#aisheet .note{font-size:calc(12.5px * var(--ts));color:var(--ai-muted);margin:6px 0 0}
#aisheet .sec{font-size:calc(13px * var(--ts));font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ai-muted);margin:24px 0 8px}
#aisheet .sm{font-size:calc(14px * var(--ts));font-weight:600;padding:8px 12px;border-radius:9px;border:1px solid var(--ai-rule);background:var(--ai-sheet);color:var(--ai-ink)}
#aisheet .sm.primary{background:var(--ai-signal);border-color:var(--ai-signal);color:#fff}
#aisheet .srow{display:flex;align-items:center;gap:12px;background:var(--ai-sheet);border:1px solid var(--ai-rule);border-radius:14px;padding:12px 14px;margin:8px 0}
#aisheet .grow{flex:1;min-width:0} #aisheet .grow b{display:block;font-weight:600} #aisheet .grow small{display:block;font-size:calc(13px * var(--ts));margin-top:2px}
#aisheet .switch{flex:none;width:51px;height:31px;border-radius:16px;background:var(--ai-rule);position:relative;transition:background .2s}
#aisheet .switch::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
#aisheet .switch.on{background:var(--ai-signal)} #aisheet .switch.on::after{transform:translateX(20px)}
#aisheet .aicard,#aisheet .ucard{background:var(--ai-sheet);border:1px solid var(--ai-rule);border-radius:14px;padding:14px;margin:14px 0}
#aisheet .aicard.active{border-color:var(--ai-signal);box-shadow:0 0 0 1px var(--ai-signal)}
#aisheet .aic-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:calc(17px * var(--ts))}
#aisheet .aic-row{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:calc(14px * var(--ts))}
#aisheet .aic-row.lbl,#aisheet .aic-row .lbl{font-weight:600}
#aisheet code{font:calc(13px * var(--ts)) ui-monospace,Menlo,monospace;background:var(--ai-paper);border:1px solid var(--ai-rule);border-radius:6px;padding:2px 6px}
#aisheet .aic-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
#aisheet .sm[disabled]{opacity:.5}
#aisheet .modelsel{display:block;width:100%;margin-top:6px;font:calc(16px * var(--ts)) -apple-system,system-ui,sans-serif;color:var(--ai-ink);background:var(--ai-paper);border:1px solid var(--ai-rule);border-radius:9px;padding:9px 10px}
#aisheet .danger{color:var(--ai-danger)} #aisheet .danger.armed{background:var(--ai-danger);color:#fff;border-color:var(--ai-danger)}
#aisheet .ustat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 4px}
#aisheet .ustat div{background:var(--ai-paper);border-radius:10px;padding:8px 10px}
#aisheet .ustat b{display:block;font-size:calc(20px * var(--ts));font-weight:700}
#aisheet .ustat small{color:var(--ai-muted);font-size:calc(12px * var(--ts))}
#aisheet .ubars{display:flex;align-items:flex-end;gap:3px;height:56px;margin-top:10px}
#aisheet .ubars span{flex:1;background:var(--ai-signal);border-radius:3px 3px 0 0;min-height:2px}
#aisheet .ubars span.zero{background:var(--ai-rule)}
#aisheet .ubars-l{display:flex;justify-content:space-between;font-size:calc(11.5px * var(--ts));color:var(--ai-muted);margin-top:4px}
#aisheet .utab{width:100%;border-collapse:collapse;margin-top:12px;font-size:calc(13px * var(--ts))}
#aisheet .utab th{text-align:left;font-weight:600;color:var(--ai-muted);padding:4px 4px 4px 0;border-bottom:1px solid var(--ai-rule)}
#aisheet .utab td{padding:6px 4px 6px 0;border-bottom:1px solid var(--ai-rule);word-break:break-word}
#aisheet .utab th:not(:first-child),#aisheet .utab td:not(:first-child){text-align:right;white-space:nowrap}
#aitoast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:70;transform:translate(-50%,20px);opacity:0;visibility:hidden;max-width:90vw;padding:10px 16px;border-radius:18px;background:var(--ink);color:var(--paper);font:calc(14px * var(--ts))/1.35 -apple-system,system-ui,sans-serif;text-align:center;pointer-events:none;transition:transform .25s,opacity .25s,visibility 0s linear .25s}
#aitoast.on{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .25s,opacity .25s}
.badge-ai{display:inline-block;font-size:calc(12px * var(--ts));font-weight:700;color:var(--done);background:color-mix(in srgb,var(--done) 14%,transparent);border-radius:6px;padding:2px 8px}
.badge-ex{display:inline-block;font-size:calc(12px * var(--ts));font-weight:600;color:var(--graphite);border:1px dashed var(--graphite);border-radius:6px;padding:1px 8px}
#summaryBy{margin:2px 0 6px}
#upd{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}
.updp{width:100%;max-width:720px;max-height:92vh;overflow:auto;background:var(--surface);color:var(--ink);border-radius:22px 22px 0 0;padding:20px 18px calc(16px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px}
.updp:focus{outline:none}
.updtag{align-self:flex-start;background:var(--done);color:var(--paper);font-size:calc(12px * var(--ts));font-weight:800;padding:4px 10px;border-radius:999px}
.updt{margin:6px 0 0;font:700 calc(22px * var(--ts))/1.2 ui-rounded,-apple-system,system-ui,sans-serif}
.upds{color:var(--graphite);font-size:calc(14px * var(--ts))}
.updl{display:flex;flex-direction:column;gap:10px;margin:8px 0 6px}
.updi{display:flex;gap:12px;align-items:flex-start;background:var(--field);border-radius:14px;padding:12px}
.updic{font-size:calc(24px * var(--ts));line-height:1.1;flex:none}
.updi b{display:block;font-size:calc(15px * var(--ts))}
.updi span{display:block;color:var(--graphite);font-size:calc(13px * var(--ts));line-height:1.35;margin-top:2px}
.updmsg{font-size:calc(14px * var(--ts))}
.updmsg:empty{display:none}
.updgo{flex:none;width:100%}
.updlater{height:46px;border:0;border-radius:23px;background:var(--field);color:var(--ink);font:600 calc(15px * var(--ts))/1 -apple-system,system-ui,sans-serif;cursor:pointer}
.ver{text-align:center;color:var(--graphite);font-size:calc(12px * var(--ts));margin:24px 0 0}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;z-index:10}
.sheet{
  background:var(--surface);width:100%;max-width:720px;max-height:88vh;overflow:auto;
  border-radius:20px 20px 0 0;padding:20px 18px calc(env(safe-area-inset-bottom,0px) + 20px)
}
.sheet table{width:100%;border-collapse:collapse;margin:12px 0 16px}
.sheet td{padding:7px 0;border-bottom:1px solid var(--rule);font-size:calc(15px * var(--ts))}
.sheet td+td{text-align:right}
.sheet .final{background:var(--field);padding:12px;border-radius:10px;font-size:calc(14px * var(--ts))}
.sheet .btn{width:100%;margin-top:16px;flex:none}

/* Tiny: older photos as one line each (number, time and summary); tap one to see it whole */
body.d-tiny .older{grid-template-columns:1fr;gap:0;margin-top:10px}
body.d-tiny .older article{display:flex;flex-wrap:nowrap;align-items:baseline;gap:8px;padding:8px 0;border-top:1px solid var(--rule);cursor:pointer}
body.d-tiny .older article .meta{order:-1;flex:none;margin:0}
body.d-tiny .older article .text{flex:1;min-width:0;margin:0;display:block;-webkit-line-clamp:unset;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.d-tiny .older article:not(.open) img,body.d-tiny .older article:not(.open) .placeholder{display:none}
body.d-tiny .older article.open{flex-wrap:wrap}
body.d-tiny .older article.open .text{white-space:normal}
body.d-tiny .older article.open img{order:3;width:100%}
/* Settings sheet (scoped: the app already uses .switch, .chip and .sheet) */
/* Tabs: Setup, Live, Sessions */
.tabs{display:flex;gap:4px;background:var(--field);border-radius:12px;padding:4px;margin:0 0 14px}
.tabs button{flex:1;height:38px;border:0;border-radius:9px;background:transparent;color:var(--graphite);font:600 calc(14px * var(--ts,1))/1 -apple-system,system-ui,sans-serif;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.tabs button:focus-visible{outline:3px solid var(--done);outline-offset:1px}
.tabs .recdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--rec);margin-right:6px;vertical-align:1px;animation:pulse 1.4s ease-in-out infinite}
.tabs .recdot.held{background:var(--amber,#B45309);animation:none}
.tabs .cnt{font-weight:500;color:var(--graphite);margin-left:4px}
.startBar .btn{width:100%;margin:4px 0 14px}
/* Live */
.liveIdle{text-align:center;padding:36px 8px;color:var(--graphite)}
.liveIdle .btn{width:100%;margin-top:14px}
.liveGrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.liveGrid figure{margin:0;min-width:0}
.liveGrid figcaption{font-size:12px;color:var(--graphite);margin-top:6px;min-height:1.4em}
.livePane .liveWrap,.livePane .liveWrap.aiming{position:relative;width:100%;height:auto;aspect-ratio:3/4;border-radius:14px}
.liveTag{position:absolute;left:8px;top:8px;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px}
.liveTag::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--rec);animation:pulse 1.4s ease-in-out infinite}
.liveApple{aspect-ratio:3/4;border-radius:14px;background:#000;color:#9aa3ae;display:grid;place-items:center;text-align:center;padding:14px;font-size:13px}
.nowPhoto{position:relative;aspect-ratio:3/4;border-radius:14px;overflow:hidden;background:#000}
.nowPhoto img{display:block;width:100%;height:100%;object-fit:cover}
.nowPhoto .placeholder{aspect-ratio:auto;height:100%;padding:10px;text-align:center}
.nowBadge{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px}
.nowPhoto.busy::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.22) 50%,transparent 65%);background-size:250% 100%;animation:vxshimmer 1.6s linear infinite}
@keyframes vxshimmer{from{background-position:150% 0}to{background-position:-100% 0}}
.countdown{margin:12px 0 10px}
.cdTop{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.cdText{font:700 calc(19px * var(--ts,1))/1.2 ui-rounded,-apple-system,system-ui,sans-serif}
.cdSub{font-size:12px;color:var(--graphite);white-space:nowrap}
.cdBar{height:6px;border-radius:3px;background:var(--field);overflow:hidden;margin-top:8px}
.cdBar span{display:block;height:100%;width:0;background:var(--done);transition:width .5s linear}
.cdBar.busy span{width:100%;background:var(--graphite);opacity:.45;animation:pulse 1.2s ease-in-out infinite}
.endBtn{width:100%;margin:4px 0 14px}
@media (prefers-reduced-motion:reduce){.nowPhoto.busy::after,.tabs .recdot,.liveTag::before,.cdBar.busy span{animation:none}.cdBar span{transition:none}}
/* Sessions */
.sesCard{display:flex;gap:12px;align-items:center;width:100%;text-align:left;padding:10px;margin:0 0 10px;border:1px solid var(--rule);border-radius:14px;background:var(--surface);color:var(--ink);font:inherit;cursor:pointer}
.sesCard img,.sesCard .noimg{width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none;background:#000}
.sesCard .t{flex:1;min-width:0}
.sesCard b{display:block;font-size:15px}
.sesCard .m{display:block;font-size:12px;color:var(--graphite);margin-top:2px}
.sesCard .s{font-size:13px;color:var(--graphite);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sesEmpty{text-align:center;padding:30px 8px;color:var(--graphite)}
.report h1{font:700 calc(24px * var(--ts,1))/1.15 ui-rounded,-apple-system,system-ui,sans-serif;margin:10px 0 2px}
.report h2{font-size:calc(15px * var(--ts,1));margin:20px 0 8px}
.report .card{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:12px 14px}
.report .bigsum{font-size:calc(16px * var(--ts,1));line-height:1.45;white-space:pre-wrap;margin:0}
.report .warn{background:color-mix(in srgb,var(--rec) 12%,var(--surface));border-left:4px solid var(--rec);padding:10px 12px;border-radius:8px;margin-top:10px;font-size:14px}
.rtable{width:100%;border-collapse:collapse}
.rtable td{padding:7px 0;border-bottom:1px solid var(--rule);font-size:calc(15px * var(--ts,1));vertical-align:top}
.rtable td+td{text-align:right;padding-left:10px}
.rtrig{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--rule)}
.rtrig:last-child{border-bottom:0}
.rtrig .tbody{flex:1;min-width:0}
.rphotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.rphotos figure{margin:0}
.rphotos img,.rphotos .placeholder{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:#000}
.rphotos figcaption{font-size:12px;color:var(--graphite);margin-top:4px}
.rphotos .note{font-size:13px;margin-top:2px}
.repTop{display:flex;justify-content:space-between;align-items:center;gap:8px}
/* Sticky header (same pattern as Strava Daily Digest) */
.hdr{position:sticky;top:0;z-index:15;margin:calc(-1 * (env(safe-area-inset-top,0px) + 14px)) -16px 14px;padding:calc(env(safe-area-inset-top,0px) + 8px) 16px 0;background:var(--paper);border-bottom:1px solid var(--rule);transition:box-shadow .2s}
.hdr.stuck{box-shadow:0 8px 18px -12px rgba(0,0,0,.55)}
.brand{display:flex;align-items:center;gap:8px;min-height:44px}
.brand-name{font:800 calc(22px * var(--ts))/1 var(--display);letter-spacing:-.01em;margin-right:auto}
.hbtn{width:40px;height:40px;border-radius:20px;display:grid;place-items:center;background:var(--sheet);border:1px solid var(--rule);color:var(--ink);padding:0;cursor:pointer;flex:none}
.hbtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}
.hbtn.solid svg{fill:currentColor;stroke:none}
.hbtn.go{background:var(--rec);border-color:var(--rec);color:#fff}
.hbtn.resume{background:var(--done);border-color:var(--done);color:var(--paper)}
.hbtn:disabled{opacity:.5}
.hbtn:focus-visible{outline:3px solid var(--done);outline-offset:2px}
.hdr .tabs{margin:6px 0 0;border-radius:999px;padding:3px;gap:2px}
.hdr .tabs button{border-radius:999px;height:34px;font-size:calc(13px * var(--ts,1))}
.hstat{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;padding:4px 2px}
.hstat .status{min-width:0}
.hstat #status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.paused .dot{background:var(--amber,#B45309)!important;animation:none!important}
.hdr .cdBar{height:3px;border-radius:0;margin:0 -16px;background:transparent}
.hdr .cdBar span{border-radius:0 2px 2px 0}
/* AI summary of the photo, right under the live and analyzed photos */
.frameSum{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:10px 12px;margin:10px 0 12px}
.fsHead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}
.fsHead b{font-size:calc(13px * var(--ts,1))}
.fsMeta{color:var(--graphite);font-size:12px;text-align:right}
/* Markdown from the model, in a fixed-width font */
.md{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:calc(13px * var(--ts,1));line-height:1.5;overflow-wrap:anywhere;white-space:normal}
.md p{margin:0 0 .6em}
.md>:last-child{margin-bottom:0}
.md .mdh{font-weight:700;margin:.5em 0 .3em}
.md .mdh:first-child{margin-top:0}
.md .mdh1{font-size:1.25em}.md .mdh2{font-size:1.12em}.md .mdh3{font-size:1.04em}
.md ul,.md ol{margin:.2em 0 .6em;padding-left:1.5em}
.md li{margin:.1em 0}
.md code{background:var(--field);padding:0 .25em;border-radius:4px;font:inherit}
.md pre.mdpre{background:var(--field);padding:8px 10px;border-radius:8px;overflow-x:auto;white-space:pre;margin:.3em 0 .6em;line-height:1.25;font:inherit}
.md pre.mdpre code{background:none;padding:0}
.md .mdtable{overflow-x:auto;margin:.3em 0 .6em}
.md table{border-collapse:collapse;font:inherit}
.md th,.md td{border:1px solid var(--rule);padding:3px 8px;text-align:left;white-space:nowrap}
.md th{background:var(--field);font-weight:700}
.md blockquote{margin:.3em 0 .6em;padding:.1em .8em;border-left:3px solid var(--done);color:var(--graphite)}
.md hr{border:0;border-top:1px solid var(--rule);margin:.6em 0}
.md .mdlink{text-decoration:underline}
.md .mdgauge{width:100%;max-width:240px;height:12px;vertical-align:middle;accent-color:var(--done)}
/* Charts the model asks for (mermaid pie / xychart, stats tiles), drawn in the page's own colours */
.vxChart{--c1:var(--signal);--c2:var(--amber);--c3:#4C8DF6;--c4:#9B6BE0;--c5:var(--rec);--c6:#3FA34D;--c7:#D6609A;--c8:var(--muted);
  margin:.4em 0 .8em;padding:10px 12px;border:1px solid var(--rule);border-radius:12px;background:var(--surface);
  font:calc(13px * var(--ts,1))/1.35 var(--rounded);white-space:normal}
.vxChart figcaption{font-weight:700;font-size:calc(14px * var(--ts,1));margin:0 0 8px;color:var(--ink)}
.vxc1{--k:var(--c1)}.vxc2{--k:var(--c2)}.vxc3{--k:var(--c3)}.vxc4{--k:var(--c4)}.vxc5{--k:var(--c5)}.vxc6{--k:var(--c6)}.vxc7{--k:var(--c7)}.vxc8{--k:var(--c8)}
.vxPieBody{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.vxDonut{width:min(132px,42%);min-width:104px;flex:none;height:auto;display:block}
.vxDonut .vxSeg{fill:none;stroke:var(--k);stroke-width:6.5}
.vxDonut .vxTrackC{fill:none;stroke:var(--field);stroke-width:6.5}
.vxDonut .vxTot{fill:var(--ink);font:700 9px var(--rounded);text-anchor:middle;font-variant-numeric:tabular-nums}
.vxDonut .vxTotL{fill:var(--muted);font:500 3.6px var(--rounded);text-anchor:middle}
.md .vxLegend,.vxLegend{list-style:none;margin:0;padding:0;flex:1 1 150px;min-width:0}
.md .vxLegend li{display:grid;grid-template-columns:10px minmax(0,1fr) auto 3.4em;align-items:center;gap:7px;margin:0;padding:3px 0;border-bottom:1px solid var(--rule)}
.md .vxLegend li:last-child{border-bottom:0}
.vxSw{width:10px;height:10px;border-radius:3px;background:var(--k)}
.vxL{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.vxV{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
.vxP{color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;font-size:.92em}
.vxBars{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px 8px}
.vxBars .vxL{max-width:9em}
.vxTrack{height:12px;border-radius:6px;background:var(--field);overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:1px}
.vxTrack i{display:block;height:100%;min-width:2px;border-radius:6px;background:var(--k)}
.vxTrack.multi{height:auto;background:none;gap:2px}
.vxTrack.multi i{height:6px}
.vxKeys{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 0;color:var(--muted);font-size:.92em}
.vxKeys span{display:inline-flex;align-items:center;gap:5px}
.vxLine{width:100%;height:auto;display:block;margin-top:4px}
.vxLine .vxGrid{stroke:var(--rule);stroke-width:1}
.vxLine .vxPath{fill:none;stroke:var(--k);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.vxLine .vxDot{fill:var(--surface);stroke:var(--k);stroke-width:2}
.vxLine text{fill:var(--muted);font:500 10px var(--rounded);font-variant-numeric:tabular-nums}
.vxStats{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px;margin:.4em 0 .8em;white-space:normal}
.vxTile{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:8px 10px;min-width:0}
.vxTile b{display:block;font:700 calc(22px * var(--ts,1))/1.1 var(--rounded);color:var(--done);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.vxTile span{display:block;font:500 calc(12px * var(--ts,1))/1.3 var(--rounded);color:var(--ink);margin-top:3px}
.vxTile small{display:block;font:calc(11px * var(--ts,1))/1.3 var(--rounded);color:var(--muted);margin-top:2px}
.chip.visual{border-color:var(--done);color:var(--done);font-weight:600}
.chip.visual:disabled{opacity:.5}
.md .muted{color:var(--graphite)}
.md .err{color:var(--rec)}
.heroSummary #summary.md{margin:0}
.report .bigsum.md{font-size:calc(14px * var(--ts,1))}
.panelTitle{display:flex;align-items:baseline;gap:6px;margin:0 0 4px;font-size:calc(17px * var(--ts,1))}
/* Summary right under the photos: small photo, wide summary */
.hero{grid-template-columns:clamp(84px,26%,128px) minmax(0,1fr);gap:10px;align-items:start;margin-top:10px}
.hero .finder img{max-height:none;width:100%;aspect-ratio:3/4;object-fit:cover}
.hero .finder .placeholder{aspect-ratio:3/4;font-size:11px;padding:6px;text-align:center}
.hero .finder::before,.hero .finder::after,.hero .finder i::before,.hero .finder i::after{width:10px;height:10px;border-width:1.5px}
.hero .finder::before{top:5px;left:5px}.hero .finder::after{top:5px;right:5px}
.hero .finder i::before{bottom:5px;left:5px}.hero .finder i::after{bottom:5px;right:5px}
.hero .tag{left:5px;bottom:5px;font-size:10px;padding:1px 5px}
.heroSummary{min-height:0}
.heroSummary .scroll{position:static;overflow:visible;padding:10px 12px}
/* Analysis progress on the photo being analyzed */
.nowPhoto.busy::after{display:none}
.anl{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.anl::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.28)}
.anlScan{position:absolute;left:0;right:0;height:30%;top:-30%;background:linear-gradient(to bottom,transparent,color-mix(in srgb,var(--done) 45%,transparent) 70%,var(--done) 72%,transparent 74%);animation:vxscan 1.6s ease-in-out infinite}
@keyframes vxscan{0%{top:-30%}100%{top:100%}}
.anlBox{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:68px;height:68px;display:grid;place-items:center}
.anlRing{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.anlRing circle{fill:none;stroke-width:4}
.anlRing .trk{stroke:rgba(255,255,255,.28)}
.anlRing .arc{stroke:var(--done);stroke-linecap:round;transition:stroke-dashoffset .15s linear}
.anlPct{position:relative;color:#fff;font-weight:800;font-size:15px;text-shadow:0 1px 3px rgba(0,0,0,.7)}
.anlTxt{position:absolute;left:0;right:0;bottom:0;padding:16px 8px 7px;font-size:11px;font-weight:600;color:#fff;text-align:center;background:linear-gradient(transparent,rgba(0,0,0,.7))}
.anl.done .anlScan{display:none}
.anl.done{animation:vxfade .8s ease forwards .45s}
@keyframes vxfade{to{opacity:0}}
@media (prefers-reduced-motion:reduce){.anlScan{animation:none;display:none}.anl.done{animation:none;opacity:0}}
/* Compact trigger status */
.trigStatus{display:block;margin:12px 0 14px;border:1px solid var(--rule);border-radius:12px;background:var(--surface);overflow:hidden}
.tr2sum{display:flex;flex-wrap:wrap;gap:2px 12px;padding:8px 12px;font-size:12px;color:var(--graphite);border-bottom:1px solid var(--rule)}
.tr2sum b{color:var(--ink)}
.tr2sum .ran b{color:var(--done)}
.tr2{border-bottom:1px solid var(--rule);transition:box-shadow .3s}
.tr2:last-child{border-bottom:0}
.tr2h{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:6px 12px;background:none;border:0;color:var(--ink);font:inherit;font-size:calc(14px * var(--ts,1));text-align:left;cursor:pointer}
.tr2h:focus-visible{outline:2px solid var(--done);outline-offset:-2px}
.tr2 .tdot{width:10px;height:10px;margin:0;flex:none;border-radius:50%;background:var(--rule)}
.tr2n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.tr2b{flex:none;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--field);color:var(--graphite);white-space:nowrap}
.tr2c{flex:none;min-width:1.8em;text-align:right;font-weight:800;color:var(--done)}
.tr2t{flex:none;min-width:4.6em;text-align:right;font-size:11px;color:var(--graphite)}
.tr2.checking .tdot,.tr2.firing .tdot{background:var(--amber);animation:pulse 1s ease-in-out infinite}
.tr2.checking .tr2b,.tr2.firing .tr2b{background:color-mix(in srgb,var(--amber) 22%,var(--surface));color:var(--amber)}
.tr2.fired .tdot,.tr2.met .tdot,.tr2.lit .tdot{background:var(--done)}
.tr2.fired .tr2b{background:var(--done);color:var(--paper)}
.tr2.met .tr2b{background:color-mix(in srgb,var(--done) 18%,var(--surface));color:var(--done)}
.tr2.notmet .tdot{background:var(--graphite)}
.tr2.error .tdot{background:var(--rec)}
.tr2.error .tr2b{background:color-mix(in srgb,var(--rec) 18%,var(--surface));color:var(--rec)}
.tr2.lit{background:color-mix(in srgb,var(--done) 7%,var(--surface))}
.tr2.flash{box-shadow:inset 4px 0 0 var(--done)}
.tr2.off{opacity:.6}
.tr2.off .tdot{background:transparent;border:2px solid var(--rule)}
.tr2m{display:flex;gap:10px;align-items:flex-start;padding:0 12px 10px 30px;font-size:12px;color:var(--graphite)}
.tr2m .txt{flex:1;min-width:0}
.tr2m .txt div+div{margin-top:3px}
.tr2m .switch{margin:0;flex:none}
.tr2off{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--rule);padding:8px 12px;font:inherit;font-size:12px;color:var(--graphite);cursor:pointer}
@media (prefers-reduced-motion:reduce){.tr2.checking .tdot,.tr2.firing .tdot{animation:none}}
/* One row: Live, Analyzing, Analyzed */
.liveGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.liveGrid figcaption{font-size:11px;line-height:1.3;margin-top:4px;min-height:1.3em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.livePane .liveWrap,.livePane .liveWrap.aiming{border-radius:12px}
.liveApple{border-radius:12px;font-size:11px;padding:8px}
.liveTag{left:6px;top:6px;font-size:10px;padding:2px 6px}
.nowPhoto,.lastPhoto{position:relative;aspect-ratio:3/4;border-radius:12px;overflow:hidden;background:#000}
.lastPhoto img{display:block;width:100%;height:100%;object-fit:cover}
.lastPhoto .placeholder{aspect-ratio:auto;height:100%;padding:8px;font-size:11px;text-align:center}
.nowBadge{left:6px;top:6px;font-size:10px;padding:2px 6px}
.lastPhoto:not(.empty){box-shadow:0 0 0 2px var(--done)}
.lastPhoto.fresh{animation:vxpop .9s ease}
@keyframes vxpop{0%,100%{box-shadow:0 0 0 2px var(--done)}40%{box-shadow:0 0 0 6px color-mix(in srgb,var(--done) 70%,transparent)}}
.inSum{position:absolute;left:0;right:0;bottom:0;padding:14px 4px 6px;font-size:10px;font-weight:700;color:#fff;text-align:center;background:linear-gradient(transparent,color-mix(in srgb,var(--done) 85%,#000))}
.inSum.bad{background:linear-gradient(transparent,color-mix(in srgb,var(--rec) 85%,#000))}
.nowWait{display:grid;place-content:center;height:100%;padding:8px;text-align:center;color:#9aa3ae;font-size:11px;line-height:1.3}
.nowWait b{display:block;font:800 22px/1.1 ui-rounded,-apple-system,system-ui,sans-serif;color:#fff;margin-bottom:4px}
.anlBox{width:52px;height:52px}
.anlPct{font-size:12px}
.anlTxt{font-size:10px;padding:12px 4px 5px}
/* zoom buttons on the live preview */
.zoomChips{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:center;gap:3px}
.zoomChips button{min-width:26px;height:24px;padding:0 5px;border:0;border-radius:12px;background:rgba(0,0,0,.55);color:#fff;font:700 11px/1 -apple-system,system-ui,sans-serif;cursor:pointer;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.zoomChips button.on{background:#fff;color:#000}
.zoomChips button:focus-visible{outline:2px solid var(--done);outline-offset:1px}
/* the summary runs full width under the row */
.hero{grid-template-columns:minmax(0,1fr)}
/* Earlier photos: small thumbnails, three to a row */
.olderTitle{font-size:calc(13px * var(--ts,1));font-weight:600;color:var(--graphite);margin:16px 0 6px}
body:not(.d-tiny) .older{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:0}
body:not(.d-tiny) .older img,body:not(.d-tiny) .older .placeholder{aspect-ratio:3/4;border-radius:10px}
body:not(.d-tiny) .older .text{font-size:11px;-webkit-line-clamp:3;margin:4px 1px 0}
body:not(.d-tiny) .older .meta{font-size:10px;margin-top:2px}
body:not(.d-tiny) .older .text.md{max-height:4.6em;overflow:hidden;-webkit-mask-image:linear-gradient(#000 60%,transparent);mask-image:linear-gradient(#000 60%,transparent)}
/* VisionX logo: watching eye (header mark, idle screen, launch screen) */
.brand-name{display:flex;align-items:center;gap:9px}
.brand-name .x{color:#E5383B}
.brand-mark{width:30px;height:30px;border-radius:8px;background:#0E1116;flex:none;box-shadow:inset 0 0 0 1px rgba(246,247,249,.14)}
.idleMark{display:block;width:76px;height:76px;margin:0 auto 14px;border-radius:18px;background:#0E1116}
/* Launch screen (app-blueprints · launch-screen 1.0.0) */
.splash{--sp-bg:#0E1116;--sp-ink:#F6F7F9;--sp-accent:#E5383B;--sp-accent2:#2DD4BF;--sp-muted:#9AA3AE;--sp-font:var(--display);
  position:fixed;inset:0;z-index:90;background:var(--sp-bg);color:var(--sp-ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;cursor:pointer;
  animation:spOut .4s ease 2.4s forwards}
.splash.gone{display:none}
.spIcon{width:148px;height:148px;opacity:0;transform:scale(.86);animation:spIn .5s cubic-bezier(.2,.9,.3,1.2) .05s forwards}
.spIcon svg{width:100%;height:100%;display:block;overflow:visible}
.spFrame{fill:none;stroke:var(--sp-ink);stroke-opacity:.35;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;opacity:0;animation:spFade .4s ease .25s forwards}
.spDraw{fill:none;stroke:var(--sp-ink);stroke-width:13;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:100;stroke-dashoffset:100;animation:spDraw .8s ease-in-out .15s forwards}
.spPop{fill:var(--sp-accent);transform-box:fill-box;transform-origin:center;transform:scale(0);animation:spPop .45s cubic-bezier(.3,1.7,.5,1) .75s forwards}
.spDetail{fill:var(--sp-ink);opacity:0;animation:spFade .3s ease 1.05s forwards}
.spSweep{fill:none;stroke:var(--sp-accent2);stroke-width:7;stroke-linecap:round;opacity:0;transform:translateX(var(--sp-sweep-from,-120px));animation:spSweep 1s ease-in-out .95s forwards}
.spWord{font:800 40px/1 var(--sp-font,ui-rounded,-apple-system,system-ui,sans-serif);letter-spacing:-.02em;opacity:0;transform:translateY(10px);animation:spUp .45s ease 1.05s forwards}
.spWord span{color:var(--sp-accent)}
.spTag{font:600 15px/1.3 -apple-system,system-ui,sans-serif;letter-spacing:.06em;color:var(--sp-muted);opacity:0;transform:translateY(8px);animation:spUp .45s ease 1.4s forwards}
@keyframes spIn{to{opacity:1;transform:scale(1)}}
@keyframes spFade{to{opacity:1}}
@keyframes spDraw{to{stroke-dashoffset:0}}
@keyframes spPop{to{transform:scale(1)}}
@keyframes spSweep{0%{opacity:0}15%{opacity:1}100%{opacity:1;transform:translateX(0)}}
@keyframes spUp{to{opacity:1;transform:none}}
@keyframes spOut{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){
  .splash *{animation:none!important;opacity:1!important;transform:none!important;stroke-dashoffset:0!important}
  .splash{animation:spOut .3s ease 1.6s forwards!important}
}
/* While a session runs: no tabs or status line; the photo row sticks under the header and halves on scroll */
body.sess .hdr .tabs,body.sess .hdr .hstat{display:none}
body.sess .hdr .brand{padding-bottom:8px}
body.sess .hdr.stuck{box-shadow:none}
body.sess #liveOn{min-height:calc(100vh + 200px)}
#liveSentinel{height:0}
.liveGrid{position:sticky;top:var(--hdrH,0px);z-index:14;background:var(--paper);margin:0 -16px;padding:8px 16px 8px;transition:box-shadow .2s}
.liveGrid.sized .livePane .liveWrap,.liveGrid.sized .liveApple,.liveGrid.sized .nowPhoto,.liveGrid.sized .lastPhoto{aspect-ratio:auto;height:var(--tileH);transition:height .25s ease}
.liveGrid.sized.mini .livePane .liveWrap,.liveGrid.sized.mini .liveApple,.liveGrid.sized.mini .nowPhoto,.liveGrid.sized.mini .lastPhoto{height:calc(var(--tileH) * .5)}
.liveGrid.mini{box-shadow:0 8px 18px -12px rgba(0,0,0,.55);border-bottom:1px solid var(--rule)}
.liveGrid.mini figcaption{display:none}
.liveGrid.mini .anlBox{width:38px;height:38px;top:44%}
.liveGrid.mini .anlPct{font-size:10px}
.liveGrid.mini .anlTxt,.liveGrid.mini .inSum{padding:6px 2px 3px;font-size:9px}
.liveGrid.mini .nowWait{font-size:10px;padding:4px}
.liveGrid.mini .nowWait b{font-size:16px;margin-bottom:2px}
.liveGrid.mini .zoomChips{bottom:4px}
.liveGrid.mini .zoomChips button{height:22px;min-width:24px;font-size:10px}
.liveGrid.mini .liveTag,.liveGrid.mini .nowBadge{top:4px;left:4px;font-size:9px;padding:1px 5px}
@media (prefers-reduced-motion:reduce){.liveGrid.sized .livePane .liveWrap,.liveGrid.sized .liveApple,.liveGrid.sized .nowPhoto,.liveGrid.sized .lastPhoto{transition:none}}
/* Layers: modal 10, editor 20, update 30, Settings 50, AI settings 60 (it opens from Settings), toasts 70 */
#cfgsheet{position:fixed;inset:0;z-index:50;background:var(--paper);color:var(--ink);transform:translateY(102%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;text-align:left}
#cfgsheet.open{transform:none;visibility:visible;transition:transform .28s ease}
#cfgsheet button{font:inherit;color:inherit;background:none;border:0;border-radius:0;padding:0;font-weight:inherit;cursor:pointer;text-align:inherit}
#cfgsheet .sh-head{position:sticky;top:0;z-index:2;background:var(--paper);display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top) + 14px) 18px 12px;border-bottom:1px solid var(--rule)}
#cfgsheet .sh-head h2{font:700 calc(24px * var(--ts))/1 var(--display);margin:0}
#cfgsheet .sh-body{padding:16px 18px calc(env(safe-area-inset-bottom) + 40px);max-width:680px;margin:0 auto}
#cfgsheet .link{color:var(--signal);font-weight:600;font-size:16px}
#cfgsheet .link.small{font-size:calc(14px * var(--ts))}
#cfgsheet .hint{font-size:calc(13px * var(--ts));color:var(--muted);margin:8px 2px 0}
#cfgsheet .muted{color:var(--muted)}
#cfgsheet .sec{display:block;font:700 calc(17px * var(--ts))/1.2 var(--display);color:var(--ink);margin:26px 0 6px}
#cfgsheet .srow{display:flex;align-items:center;gap:8px;padding:11px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .grow{flex:1;min-width:0}
#cfgsheet .grow b{display:block;font-weight:600}
#cfgsheet .grow small{display:block;font-size:calc(13px * var(--ts));color:var(--ink-2)}
#cfgsheet .switch{width:46px;height:28px;border-radius:14px;background:var(--rule);position:relative;flex:none;transition:background .2s}
#cfgsheet .switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .2s}
#cfgsheet .switch.on{background:var(--signal)}
#cfgsheet .switch.on::after{transform:translateX(18px)}
#cfgsheet .sm{font-size:calc(13px * var(--ts));padding:6px 11px;border-radius:8px;border:1px solid var(--rule);background:var(--sheet);white-space:nowrap;flex:none}
#cfgsheet .danger{color:var(--danger)}
#cfgsheet .danger.armed{background:var(--danger);color:#fff;border-color:var(--danger)}
#cfgsheet .seg{display:flex;flex:none;gap:0;padding:0;border:1px solid var(--rule);border-radius:9px;overflow:hidden;background:var(--sheet)}
#cfgsheet .seg button{font-size:calc(12.5px * var(--ts));padding:6px 10px;color:var(--ink-2);white-space:nowrap}
#cfgsheet .seg button.on{background:var(--ink);color:var(--paper);font-weight:600}
#cfgsheet .seg.wide button{flex:1;text-align:center;padding:9px 4px;font-size:calc(13.5px * var(--ts))}
#cfgsheet .lk-row{margin:10px 0 14px}
#cfgsheet .lk-l{display:block;font-size:calc(13px * var(--ts));font-weight:600;color:var(--ink-2);margin-bottom:6px}
#cfgsheet .sws{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;padding:3px 3px 2px}
#cfgsheet .sws::-webkit-scrollbar{display:none}
#cfgsheet .sw{display:flex;flex-direction:column;align-items:center;gap:5px;flex:none}
#cfgsheet .sw .prev{position:relative;width:50px;height:50px;border-radius:13px;display:grid;place-items:center;border:1px solid rgba(127,127,127,.35);font:700 18px/1 var(--display)}
#cfgsheet .sw .prev i{position:absolute;right:6px;bottom:6px;width:9px;height:9px;border-radius:5px}
#cfgsheet .sw.on .prev{outline:2.5px solid var(--signal);outline-offset:2px}
#cfgsheet .sw small{font-size:12px;color:var(--ink-2)}
#cfgsheet .sw.on small{color:var(--ink);font-weight:600}
#cfgsheet .cfg{padding:12px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .cfg.ch .cfg-h b::after{content:"";display:inline-block;width:7px;height:7px;border-radius:4px;background:var(--signal);margin-left:7px;vertical-align:2px}
#cfgsheet .cfg-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
#cfgsheet .cfg-h b{font-weight:600}
#cfgsheet .cfg small{display:block;font-size:calc(13px * var(--ts));margin-top:2px}
#cfgsheet .stepper{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
#cfgsheet .stepper button{width:38px;height:36px;border-radius:9px;border:1px solid var(--rule);background:var(--sheet);font-size:20px;font-weight:600;text-align:center}
#cfgsheet .stepper button[disabled]{opacity:.35}
#cfgsheet .stepper input{width:86px;text-align:center;font:600 16px var(--sans);padding:7px 6px;border-radius:9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink)}
#cfgsheet .stepper .unit{font-size:calc(14px * var(--ts));color:var(--ink-2);min-width:2.5em}
#cfgsheet .stepper .range{flex-basis:100%;font-size:calc(12px * var(--ts));color:var(--muted)}
#cfgsheet .cfgin.wide,#cfgsheet .cfgsel{display:block;width:100%;margin-top:8px;font:16px/1.45 var(--sans);padding:9px 11px;border-radius:9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);-webkit-appearance:none;appearance:none}
#cfgsheet textarea.cfgsel{resize:none}
#cfgsheet .cfgin:focus,#cfgsheet .cfgsel:focus{outline:2px solid var(--signal);outline-offset:-1px}
#cfgsheet .cfg-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:18px}
#cfgsheet .note{font-size:12.5px;color:var(--muted)}
#cfgsheet .srow.bp{width:100%;text-align:left}
#cfgsheet .chev{flex:none;color:var(--muted);font-size:calc(20px * var(--ts));line-height:1}
#cfgsheet input{-webkit-user-select:text;user-select:text}
/* AI invitation (app-blueprints · ai-invitation): above Settings and the AI sheet, below the update sheet and the launch screen */
#aiinv{position:fixed;inset:0;z-index:47;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45);animation:aiinvFade .25s ease both}
#aiinv.out{animation:aiinvFadeOut .24s ease both}
.aiinv-card{position:relative;width:100%;max-width:380px;background:var(--sheet);color:var(--ink);border:1px solid var(--rule);border-radius:24px;padding:26px 22px 16px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35);animation:aiinvUp .5s cubic-bezier(.2,.9,.3,1.2) both}
#aiinv.out .aiinv-card{animation:aiinvDown .24s ease both}
.aiinv-spark{width:56px;height:56px;margin:-4px auto 10px;border-radius:18px;display:grid;place-items:center;font-size:calc(30px * var(--ts));color:var(--signal);background:var(--signal-wash);animation:aiinvTwinkle 2.4s ease-in-out .5s infinite}
#aiinv h2{margin:0 0 6px;font-family:var(--display);font-size:calc(23px * var(--ts));line-height:1.2;font-weight:800}
.aiinv-lead{margin:0 0 14px;color:var(--ink-2);font-size:calc(15px * var(--ts))}
.aiinv-perks{list-style:none;margin:0 0 14px;padding:0;text-align:left}
.aiinv-perks li{display:flex;gap:10px;align-items:center;padding:9px 12px;margin-bottom:6px;border-radius:12px;background:var(--signal-wash);font-size:calc(15px * var(--ts));font-weight:600;animation:aiinvPerk .4s ease both;animation-delay:calc(.25s + var(--i) * .09s)}
.aiinv-ico{flex:none;width:22px;text-align:center}
.aiinv-steps{margin:0 0 16px;padding-left:22px;text-align:left;color:var(--muted);font-size:calc(13px * var(--ts));line-height:1.6}
.aiinv-go{display:block;width:100%;border:0;border-radius:14px;padding:14px;font:700 calc(17px * var(--ts)) var(--display);color:var(--sheet);background:var(--signal);animation:aiinvGlow 1.6s ease-in-out .9s 2}
.aiinv-go:focus{outline:none}
.aiinv-go:focus-visible{box-shadow:0 0 0 4px var(--signal-wash)}
.aiinv-row{display:flex;justify-content:space-between;gap:8px;margin-top:6px}
.aiinv-later,.aiinv-never{border:0;background:none;padding:12px 6px;color:var(--muted);font:600 calc(14px * var(--ts)) var(--sans, inherit)}
.aiinv-later{color:var(--ink-2)}
.aiinv-nudge{animation:aiinvGlow 1.2s ease-in-out 2}
@keyframes aiinvFade{from{opacity:0}to{opacity:1}}
@keyframes aiinvFadeOut{from{opacity:1}to{opacity:0}}
@keyframes aiinvUp{from{opacity:0;transform:translateY(40px) scale(.94)}to{opacity:1;transform:none}}
@keyframes aiinvDown{to{opacity:0;transform:translateY(24px) scale(.97)}}
@keyframes aiinvPerk{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
@keyframes aiinvTwinkle{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.12) rotate(12deg)}}
@keyframes aiinvGlow{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 6px var(--signal-wash)}}
@media (prefers-reduced-motion:reduce){
  #aiinv,#aiinv.out,.aiinv-card,#aiinv.out .aiinv-card,.aiinv-perks li,.aiinv-spark,.aiinv-go,.aiinv-nudge{animation:none}
  #aiinv.out{opacity:0;transition:opacity .2s}
}
/* Safe start-up (app-blueprints · safe-startup): the placeholder until Scriptable hands over the data, and the start-up log */
body:not(.booted) .view,body:not(.booted) #verLine{display:none}
.booting{display:flex;align-items:center;justify-content:center;gap:10px;padding:80px 20px;color:var(--muted);font-size:calc(14px * var(--ts))}
.booting.note{flex-direction:column;text-align:center;color:var(--ink-2);padding:60px 24px}
.booting.note b{font-size:calc(18px * var(--ts));color:var(--ink)}
.booting.note pre,.startlog{max-width:100%;overflow:auto;text-align:left;font:12px/1.45 ui-monospace,Menlo,monospace;background:var(--sheet);border:1px solid var(--rule);border-radius:10px;padding:10px;color:var(--ink-2);white-space:pre-wrap;-webkit-user-select:text;user-select:text}
.startlog{margin:8px 0;max-height:260px}
.busy-dot{width:15px;height:15px;flex:none;border-radius:50%;border:2px solid var(--rule);border-top-color:var(--signal);animation:bdspin .8s linear infinite}
@keyframes bdspin{to{transform:rotate(360deg)}}
</style>
</head>
<body class="d-${look.density}">
  <div class="splash" id="splash" role="img" aria-label="VisionX. Sees. Understands. Acts.">
    <div class="spIcon"><svg viewBox="0 0 240 240" aria-hidden="true">
      <path class="spFrame" d="M30 54 V30 H54"></path><path class="spFrame" d="M186 30 H210 V54"></path><path class="spFrame" d="M30 186 V210 H54"></path><path class="spFrame" d="M186 210 H210 V186"></path>
      <path class="spDraw" pathLength="100" d="M34 120 C70 72 170 72 206 120 C170 168 70 168 34 120 Z"></path>
      <circle class="spPop" cx="120" cy="120" r="25"></circle>
      <circle class="spDetail" cx="129" cy="111" r="6"></circle>
      <path class="spSweep" d="M158 60 V180"></path>
    </svg></div>
    <div class="spWord">Vision<span>X</span></div>
    <div class="spTag">Sees. Understands. Acts.</div>
  </div>
  <header class="hdr" id="hdr">
    <div class="brand">
      <span class="brand-name"><svg class="brand-mark" viewBox="0 0 240 240" aria-hidden="true"><path d="M34 120 C70 72 170 72 206 120 C170 168 70 168 34 120 Z" fill="none" stroke="#F6F7F9" stroke-width="13" stroke-linejoin="round"></path><circle cx="120" cy="120" r="25" fill="#E5383B"></circle><circle cx="129" cy="111" r="6" fill="#F6F7F9"></circle><path d="M158 60 V180" stroke="#2DD4BF" stroke-width="7" stroke-linecap="round"></path></svg><span>Vision<span class="x">X</span></span></span>
      <button type="button" class="hbtn solid go" id="hStart" aria-label="Start session"></button>
      <button type="button" class="hbtn solid hidden" id="hPause" aria-label="Pause session"></button>
      <button type="button" class="hbtn solid hidden" id="hStop" aria-label="Stop session"></button>
      <button type="button" class="hbtn" id="cfgOpen" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button>
    </div>
    <nav class="tabs" role="tablist" aria-label="VisionX">
      <button type="button" role="tab" id="tab-setup" aria-controls="view-setup" aria-selected="true">Setup</button>
      <button type="button" role="tab" id="tab-triggers" aria-controls="view-triggers" aria-selected="false" tabindex="-1">Triggers</button>
      <button type="button" role="tab" id="tab-live" aria-controls="view-live" aria-selected="false" tabindex="-1">Live</button>
      <button type="button" role="tab" id="tab-sessions" aria-controls="view-sessions" aria-selected="false" tabindex="-1">Sessions</button>
    </nav>
    <div class="hstat">
      <div class="status" id="statusBox" aria-live="polite"><span class="dot"></span><span id="status">Ready</span></div>
      <span class="cdSub num" id="cdSub"></span>
    </div>
    <div class="cdBar" id="cdBar" aria-hidden="true"><span id="cdFill"></span></div>
  </header>

  <div id="error" class="error hidden"></div>
  <div class="booting" role="status"><span class="busy-dot"></span>Loading your presets…</div>

  <div id="view-setup" class="view" role="tabpanel" aria-labelledby="tab-setup">
  <details class="settings" id="settingsBox" open>
    <summary>What to look for</summary>
    <label for="preset">Preset</label>
    <select id="preset"></select>
    <div class="labelRow">
      <label for="instructions">Instructions for the model</label>
      <div class="chips">
        <button type="button" class="chip small visual" id="iVisual" aria-label="Make the results visual: rewrite the instructions to answer with charts">✨ Make it visual</button>
        <button type="button" class="chip small" id="iRefine">Refine with AI</button>
        <button type="button" class="chip small" id="iExpand" aria-label="Expand the instructions editor">Expand</button>
      </div>
    </div>
    <textarea id="instructions" rows="3"></textarea>
    <div class="presetBar">
      <button type="button" class="chip" id="pUpdate">Update preset</button>
      <button type="button" class="chip" id="pNew">Save as new preset</button>
      <button type="button" class="chip danger" id="pDelete">Delete preset</button>
    </div>
    <div class="presetBar hidden" id="pSaveRow">
      <input id="pName" placeholder="Preset name" autocapitalize="sentences" maxlength="40">
      <button type="button" class="chip primary" id="pSave">Save</button>
      <button type="button" class="chip" id="pCancel">Cancel</button>
    </div>
    <div class="hint" id="pHint" aria-live="polite"></div>
    <label class="switch"><input type="checkbox" id="accumulate" role="switch"><span>Build up over the session</span></label>
    <div class="hint" id="accHint"></div>
    <label for="engine">Analyze with</label>
    <select id="engine">
      <option value="openai" id="engCloud">Claude or OpenAI</option>
      <option value="apple">Apple Intelligence (via Shortcuts)</option>
    </select>
    <div id="appleBox" class="hidden">
      <label for="shortcut">Shortcut name</label>
      <input id="shortcut" list="scNames" autocapitalize="off" autocorrect="off" spellcheck="false">
      <label class="switch"><input type="checkbox" id="applePhotos" role="switch"><span>Show each photo here</span></label>
      <div class="hint">The photo comes back through the clipboard, so iOS asks you to allow pasting. To run hands-free, allow it once in iPhone Settings › Apps › Scriptable › Paste from Other Apps › Allow, or turn this off: the analysis and triggers still work, only the photo isn't shown.</div>
      <div class="hint">Each photo briefly opens Shortcuts, which takes the photo and asks Apple Intelligence, then returns here. Apple doesn't report token counts.</div>
      <details class="howto">
        <summary>Set up the shortcut once</summary>
        <ol>
          <li>In Shortcuts, create a shortcut with the name shown above.</li>
          <li>Add <b>Take Photo</b> and turn off <b>Show Camera Preview</b>.</li>
          <li>Add <b>Resize Image</b> with width 768.</li>
          <li>Add <b>Copy to Clipboard</b> with the resized image (only needed with "Show each photo here" on).</li>
          <li>Add <b>Use Model</b> and pick the cloud model (Private Cloud Compute). In its prompt, insert <b>Shortcut Input</b>, then the <b>Resized Image</b>. If it lets you pick the output type, choose <b>Text</b>.</li>
          <li>Add <b>Stop and Output</b> with the model's <b>Response</b>.</li>
          <li>Run it once from Shortcuts to grant camera access.</li>
        </ol>
      </details>
    </div>
    <div class="grid">
      <div><label for="interval">Photo every (seconds)</label><input id="interval" type="number" min="2" step="1" inputmode="numeric"></div>
      <div class="oa"><label for="facing">Camera</label><select id="facing"><option value="environment">Back</option><option value="user">Front</option></select></div>
      <div class="oa"><label for="detail">Image detail (OpenAI)</label><select id="detail"><option value="low">Low (fewest tokens)</option><option value="auto">Auto</option><option value="high">High</option></select></div>
      <div class="oa"><label for="maxSide">Photo size sent</label><select id="maxSide"><option value="512">512 px</option><option value="768">768 px</option><option value="1024">1024 px</option><option value="1536">1536 px</option></select></div>
    </div>
    <div id="aiStatus" class="hint" aria-live="polite"></div>
  </details>


  <div class="startBar"><button id="toggle" class="btn">Start session</button></div>
  </div>

  <div id="view-triggers" class="view hidden" role="tabpanel" aria-labelledby="tab-triggers">
  <section class="settings" id="triggersBox">
    <h2 class="panelTitle">Triggers <span id="trigCount" class="trigCount"></span></h2>
    <div class="hint" id="trigHint"></div>
    <div id="trigList" class="trigList"></div>
    <div class="presetBar"><button type="button" class="chip" id="tAdd">Add trigger</button></div>
    <div id="trigForm" class="trigForm hidden">
      <label for="tName">Name</label>
      <input id="tName" maxlength="40" placeholder="Crowd alert" autocapitalize="sentences">
      <label for="tCond">Condition</label>
      <textarea id="tCond" rows="2" placeholder="More than 3 different people have been seen"></textarea>
      <div id="tWhenBox">
        <label for="tWhen">When to check</label>
        <select id="tWhen">
          <option value="interval">Every few seconds</option>
          <option value="photo">After each photo is analyzed</option>
        </select>
        <div class="hint" id="tWhenHint"></div>
      </div>
      <div class="grid" id="tGrid">
        <div id="tEveryBox"><label for="tEvery">Check every (seconds)</label><input id="tEvery" type="number" min="5" step="1" inputmode="numeric"></div>
        <div><label for="tMode">Run the shortcut</label><select id="tMode">
          <option value="rise">Each time it becomes true</option>
          <option value="once">Only the first time</option>
          <option value="new">Each new occurrence</option>
          <option value="every">Every check while true</option>
        </select></div>
      </div>
      <div class="hint" id="tModeHint"></div>
      <div class="labelRow">
        <label for="tShortcut">Shortcut to run</label>
        <div class="chips"><button type="button" class="chip small" id="tLoadSc">Load my shortcuts</button></div>
      </div>
      <select id="tPick" class="hidden" aria-label="Choose one of your shortcuts"></select>
      <input id="tShortcut" list="scNames" placeholder="Exact shortcut name" autocapitalize="off" autocorrect="off" spellcheck="false">
      <div id="tScHint" class="hint" aria-live="polite"></div>
      <details class="howto" id="tScHow">
        <summary>Set up the shortcut list once</summary>
        <ol>
          <li>In Shortcuts, create a shortcut named <b>VisionX Shortcut List</b>.</li>
          <li>Add <b>Get My Shortcuts</b>.</li>
          <li>Add <b>Combine Text</b>: combine <b>My Shortcuts</b> with <b>New Lines</b>.</li>
          <li>Add <b>Stop and Output</b> with the <b>Combined Text</b>.</li>
          <li>Back here, tap <b>Load my shortcuts</b>. Shortcuts opens for a moment, then your shortcuts appear in the list above.</li>
        </ol>
      </details>
      <datalist id="scNames"></datalist>
      <label for="tSend">Send to the shortcut</label>
      <select id="tSend">
        <option value="summary">The capture summary</option>
        <option value="frame">The photo’s AI summary</option>
        <option value="raw">The reply as received</option>
        <option value="parsed">The reply as understood (JSON)</option>
        <option value="state">Tracked details (JSON)</option>
        <option value="all">Everything (JSON)</option>
        <option value="custom">A custom message</option>
      </select>
      <div class="hint" id="tSendHint"></div>
      <div id="tMsgBox" class="hidden">
        <label for="tMsg">Message</label>
        <textarea id="tMsg" rows="3" placeholder="Gate opened for {reason} at {time}. Plate read: {frame}"></textarea>
        <div class="hint">Placeholders, filled in when the trigger runs:
          <b>{summary}</b> capture summary, <b>{frame}</b> the photo’s AI summary, <b>{raw}</b> reply as received, <b>{parsed}</b> reply as understood (JSON), <b>{state}</b> tracked details (JSON), <b>{all}</b> everything (JSON),
          <b>{reason}</b> why the condition was met, <b>{condition}</b>, <b>{check}</b> the trigger check’s own reply, <b>{name}</b> trigger name, <b>{shortcut}</b>,
          <b>{photo}</b> photo number, <b>{phototime}</b>, <b>{time}</b>, <b>{date}</b>, <b>{instructions}</b>, <b>{elapsed}</b>, <b>{photos}</b>, <b>{requests}</b>, <b>{tokens}</b>, <b>{engine}</b>.</div>
      </div>
      <div class="hint">Shortcut Input is text, so photos aren’t sent.</div>
      <div class="presetBar">
        <button type="button" class="chip primary" id="tSave">Save trigger</button>
        <button type="button" class="chip" id="tDup">Duplicate</button>
        <button type="button" class="chip danger" id="tDelete">Delete trigger</button>
        <button type="button" class="chip" id="tCancel">Cancel</button>
      </div>
      <div id="tHint" class="hint" aria-live="polite"></div>
    </div>
    <div id="checkBox" class="hidden">
      <label for="checkShortcut">Checker shortcut (Apple Intelligence)</label>
      <input id="checkShortcut" list="scNames" autocapitalize="off" autocorrect="off" spellcheck="false">
      <details class="howto">
        <summary>Set up the checker once</summary>
        <ol>
          <li>In Shortcuts, create a shortcut with the name shown above.</li>
          <li>Add <b>Use Model</b> (the cloud model) with <b>Shortcut Input</b> as its prompt.</li>
          <li>Add <b>Stop and Output</b> with the model's <b>Response</b>.</li>
        </ol>
      </details>
    </div>
  </section>
  </div>

  <div id="view-live" class="view hidden" role="tabpanel" aria-labelledby="tab-live">
  <div id="liveIdle" class="liveIdle">
    <svg class="idleMark" viewBox="0 0 240 240" role="img" aria-label="VisionX logo"><path d="M30 54 V30 H54" fill="none" stroke="#F6F7F9" stroke-opacity="0.35" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M186 30 H210 V54" fill="none" stroke="#F6F7F9" stroke-opacity="0.35" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M30 186 V210 H54" fill="none" stroke="#F6F7F9" stroke-opacity="0.35" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M186 210 H210 V186" fill="none" stroke="#F6F7F9" stroke-opacity="0.35" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M34 120 C70 72 170 72 206 120 C170 168 70 168 34 120 Z" fill="none" stroke="#F6F7F9" stroke-width="13" stroke-linejoin="round"></path><circle cx="120" cy="120" r="25" fill="#E5383B"></circle><circle cx="129" cy="111" r="6" fill="#F6F7F9"></circle><path d="M158 60 V180" stroke="#2DD4BF" stroke-width="7" stroke-linecap="round"></path></svg>
    <p>No session is running.</p>
    <button type="button" class="btn" id="liveStart">Start session</button>
  </div>
  <div id="liveOn" class="hidden">
  <div id="liveSentinel" aria-hidden="true"></div>
  <div class="liveGrid">
    <figure class="livePane">
      <div class="liveWrap" id="liveWrap"><video id="live" class="live" playsinline muted autoplay></video><span class="liveTag">Live</span>
        <div class="zoomChips" role="group" aria-label="Zoom"><button type="button" data-z="1" aria-label="Zoom 1x">1×</button><button type="button" data-z="2" aria-label="Zoom 2x">2×</button><button type="button" data-z="3" aria-label="Zoom 3x">3×</button><button type="button" data-z="4" aria-label="Zoom 4x">4×</button></div>
      </div>
      <div class="liveApple hidden" id="liveApple">Shortcuts takes the photos, so there’s no live preview.</div>
      <figcaption>Live</figcaption>
    </figure>
    <figure class="nowPane">
      <div class="nowPhoto" id="nowPhoto"></div>
      <figcaption id="nowCap">Analyzing</figcaption>
    </figure>
    <figure class="lastPane">
      <div class="lastPhoto empty" id="lastPhoto"></div>
      <figcaption id="lastCap">Analyzed</figcaption>
    </figure>
  </div>
  <section class="hero" aria-label="Latest photo and summary">
    <div class="heroSummary" id="heroSummary">
      <div class="scroll">
        <h2 id="summaryTitle">Summary so far</h2>
        <span id="summaryBy" class="badge-ai hidden"></span>
        <div id="summary" class="md muted" aria-live="polite"></div>
        <div id="summaryMeta" class="meta num"></div>
      </div>
    </div>
  </section>
  <details id="stateBox" class="tracked hidden"><summary>Tracked details</summary><pre id="state" class="code"></pre></details>
  <section id="trigStatus" class="trigStatus hidden" aria-label="Triggers" aria-live="polite"></section>
  <div class="zoomRow" id="zoomRow">
    <label for="zoom">Zoom</label>
    <input id="zoom" type="range" min="1" max="5" step="0.1" value="1" aria-describedby="zoomHint">
    <output id="zoomVal" class="num" for="zoom">1.0×</output>
    <button type="button" class="chip" id="zoomReset">1×</button>
  </div>
  <div class="zoomHint" id="zoomHint">Change it any time, even while capturing. The next photo uses it.</div>

  <div class="strip num">
    <div><b id="sElapsed">0:00</b><span>Elapsed</span></div>
    <div><b id="sPhotos">0</b><span>Photos</span></div>
    <div><b id="sReq">0</b><span>Requests</span></div>
    <div><b id="sTok">0</b><span>Tokens</span></div>
  </div>


  <section id="frames"></section>

  <details class="settings" id="debugBox">
    <summary>Debug <span id="debugCount" class="trigCount"></span></summary>
    <div class="hint">The newest photos, each with exactly what was sent to the model and what came back. Saved with the session when it ends (Sessions tab).</div>
    <div class="presetBar"><button type="button" class="chip" id="debugCopy">Copy as JSON</button></div>
    <div id="debugHint" class="hint" aria-live="polite"></div>
    <div id="debugList" class="dbgList"></div>
  </details>
  </div>
  </div>

  <div id="view-sessions" class="view hidden" role="tabpanel" aria-labelledby="tab-sessions">
    <div id="sesList"></div>
    <div id="sesDetail" class="report hidden"></div>
  </div>

  <p class="ver" id="verLine"></p>

  <div id="editor" class="editor hidden" role="dialog" aria-modal="true" aria-labelledby="edTitle">
    <div class="edHead">
      <button type="button" class="chip" id="edCancel">Cancel</button>
      <div class="edTitles"><h2 id="edTitle">Instructions</h2><div id="edSub" class="hint"></div></div>
      <button type="button" class="chip primary" id="edDone">Done</button>
    </div>
    <textarea id="edText" aria-label="Instructions for the model"></textarea>
    <div class="edMeta">
      <span id="edCount" class="hint"></span>
      <button type="button" class="chip small hidden" id="edUndo">Undo refine</button>
    </div>
    <div id="edSuggest" class="edSuggest hidden" aria-live="polite">
      <div id="edWhy" class="hint"></div>
      <div id="edProposal" class="edProposal"></div>
      <div class="presetBar">
        <button type="button" class="chip primary" id="edUse">Use this</button>
        <button type="button" class="chip" id="edKeep">Keep mine</button>
      </div>
    </div>
    <section class="edRefine" aria-labelledby="edRefineTitle">
      <h2 id="edRefineTitle">Refine with AI</h2>
      <div class="hint">Rewrites your instructions so the model knows exactly what to look for, count and report. You decide whether to use the result.</div>
      <div class="presetBar">
        <button type="button" class="chip visual" id="edVisual">✨ Make it visual</button>
        <button type="button" class="chip" data-ask="Make it clearer and less ambiguous.">Clearer</button>
        <button type="button" class="chip" data-ask="Make it more specific: say exactly what to look for, what to count or track, and what to ignore.">More specific</button>
        <button type="button" class="chip" data-ask="Make it shorter without losing anything important.">Shorter</button>
      </div>
      <label for="edAsk">What should change? (optional)</label>
      <input id="edAsk" placeholder="e.g. also note clothing colours" autocapitalize="sentences">
      <button type="button" class="btn edGo" id="edGo">Refine</button>
      <div id="edStatus" class="hint" aria-live="polite"></div>
    </section>
  </div>

  <div id="modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <div class="sheet">
      <h1 id="mTitle">Session ended</h1>
      <table class="num" id="mTable"></table>
      <h2>Final result</h2>
      <div class="final md" id="mSummary"></div>
      <button class="btn" id="mClose">Done</button>
    </div>
  </div>

  <canvas id="cv" hidden></canvas>
<script>
// The interface doesn't zoom: block pinch gestures (double-tap zoom is off via touch-action).
["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {
  document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
});
document.addEventListener("touchmove", function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
window.addEventListener("error", function (e) {
  var b = document.getElementById("error");
  if (!b) return;
  b.textContent = "Script error: " + e.message + " (line " + e.lineno + ")";
  b.classList.remove("hidden");
});
</script>
<script>${PAGE_JS}</script>
</body>
</html>`;
}

// Everything below runs inside the WebView. It is kept as a plain string because
// Scriptable returns garbled source from Function.prototype.toString().
// String.raw keeps "\n" escapes intact; this block must contain no backticks or ${.
const PAGE_JS = String.raw`
// Launch screen (app-blueprints · launch-screen 1.0.0): first, self-contained
(function () {
  var sp = document.getElementById("splash");
  if (!sp) return;
  function gone() { sp.classList.add("gone"); sp.setAttribute("aria-hidden", "true"); }
  sp.addEventListener("click", gone);   // tap to skip
  setTimeout(gone, 2900);               // out of the page once the CSS fade is done
})();
// The app itself: window.__boot runs it with the data Scriptable hands over.
function clientApp(BOOT) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Tunables from Settings › Capture (they change live when Settings changes them).
  const BCFG = BOOT.cfg || {};
  let REQUEST_TIMEOUT_MS = (BCFG.requestWait || 90) * 1000;
  let KEEP_FRAMES = BCFG.keepFrames || 3;
  let DEBUG_KEEP = BCFG.debugKeep || 10; // photos kept in the debug log (saved with the session)
  let KEEP_SESSIONS = BCFG.keepSessions || 3; // finished sessions kept on this iPhone
  let sessions = Array.isArray(BOOT.sessions) ? BOOT.sessions : [];
  const LS_KEY = "vision-session-store-v2";
  const LS_OLD = "vision-session-settings-v1";
  const PRESET_IDS = ["preset", "pUpdate", "pNew", "pDelete", "pName", "pSave", "pCancel", "iRefine", "iVisual", "iExpand", "applePhotos"];
  // Claude or OpenAI, as chosen in AI settings. Keys never reach this page.
  const cloud = { hasKey: !!(BOOT.ai && BOOT.ai.hasKey), name: (BOOT.ai && BOOT.ai.name) || "Claude", model: (BOOT.ai && BOOT.ai.model) || "" };
  const FIELDS = ["instructions", "interval", "engine", "shortcut", "checkShortcut", "detail", "maxSide", "facing"];
  const TRIG_IDS = ["accumulate", "tAdd", "tName", "tCond", "tWhen", "tEvery", "tMode", "tShortcut", "tLoadSc", "tPick", "tSend", "tMsg", "tSave", "tDup", "tDelete", "tCancel"];
  const DEFAULTS = {
    instructions: "Count the different people you see and summarize them: appearance, what they are doing, and when they first appeared.",
    interval: 10,
    detail: "auto",
    maxSide: 768,
    facing: "environment",
    zoom: 1,
    engine: cloud.hasKey ? "openai" : "apple",   // "openai" = Claude or OpenAI, whichever AI settings has in use
    shortcut: BOOT.defaultShortcut,
    checkShortcut: "Vision Session Check",
    applePhotos: true,
    accumulate: true,
  };

  const STORE = loadStore();
  let presets = Array.isArray(STORE.presets) ? STORE.presets : seedPresets();
  let triggers = Array.isArray(STORE.triggers) ? STORE.triggers : [];
  let cfg = Object.assign({}, DEFAULTS, STORE.settings || {});
  if (!STORE.settings && !Array.isArray(STORE.presets)) cfg.activePreset = presets[0].id;
  let flashTimer = null;
  let editingTrigger = null;
  let shortcutChain = Promise.resolve();
  let queuedUpdate = null;
  let anlPendingIdx = 0, anlDoneIdx = 0, anlDoneAt = 0;
  let trigSig = "", trigOpen = {}, trigOffOpen = false;
  const SEND_KINDS = ["summary", "frame", "raw", "parsed", "state", "all", "custom"];
  const SEND_HINTS = {
    summary: "The running summary of the session (in fresh mode: what the latest photo shows).",
    frame: "What the AI wrote about the latest photo.",
    raw: "The model\u2019s latest reply exactly as it came back (JSON or labelled text).",
    parsed: "The latest reply as VisionX read it: frame, summary, tracked details and trigger answers, as JSON.",
    state: "The tracked details (counts, IDs and so on) as JSON.",
    all: "One JSON with the trigger and its reason, the photo\u2019s summary, the reply as received and as understood, the session summary, tracked details and stats. In Shortcuts, use Get Dictionary from Input to pick fields.",
    custom: "Your own text. Placeholders below are filled in when the trigger runs.",
  };
  const SEND_LABELS = { summary: "the summary", frame: "the photo\u2019s AI summary", raw: "the reply as received", parsed: "the reply as understood", state: "the tracked details", all: "everything as JSON", custom: "a custom message" };
  const BT = String.fromCharCode(96);
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  let refining = false, beforeRefine = null;
  let zoomState = { camera: 1, digital: 1 }; // camera = lens zoom applied by iOS, digital = crop on top
  let zoomTimer = null, aimTimer = null;
  let rowEls = {};
  let shownSummary = "";
  let freshTimer = null;
  let fileSaveTimer = null;
  let savedAt = STORE.savedAt || 0;
  let S = newSession();
  let clock = null;
  let starting = false;

  fillForm();
  renderPresets();
  wirePresets();
  updateEngineUI();
  $("engine").addEventListener("change", () => { cfg.engine = $("engine").value; persist(); updateEngineUI(); });
  $("shortcut").addEventListener("change", () => { cfg.shortcut = $("shortcut").value.trim() || DEFAULTS.shortcut; persist(); });
  persist();
  // Tiny layout: tap an older photo's line to see it whole
  $("frames").addEventListener("click", (e) => { const a = e.target.closest("article"); if (a) a.classList.toggle("open"); });
  wireTriggers();
  wireEditor();
  wireDebug();
  $("applePhotos").addEventListener("change", () => { cfg.applePhotos = $("applePhotos").checked; persist(); });
  wireZoom();
  wireZoomChips();
  $("accumulate").addEventListener("change", () => { cfg.accumulate = $("accumulate").checked; persist(); updateModeUI(); });
  updateModeUI();
  $("checkShortcut").addEventListener("change", () => { cfg.checkShortcut = $("checkShortcut").value.trim() || DEFAULTS.checkShortcut; persist(); });
  renderCloud();
  renderAll();

  function isApple() { return cfg.engine === "apple"; }
  function updateEngineUI() {
    const apple = isApple();
    document.querySelectorAll(".oa").forEach((n) => n.classList.toggle("hidden", apple));
    $("appleBox").classList.toggle("hidden", !apple);
    $("liveWrap").classList.toggle("hidden", apple);
    $("liveApple").classList.toggle("hidden", !apple);
    $("zoomRow").classList.toggle("hidden", apple);
    $("zoomHint").classList.toggle("hidden", apple);
    $("checkBox").classList.toggle("hidden", !apple || isMoment());
  }

  // ── bridge to Scriptable (see attachBridge in the Scriptable part) ──
  const bridge = { seq: 0, calls: {}, down: false };
  window.__bridge = {
    take: function (id) {
      const c = bridge.calls[id];
      if (!c) return null;
      c.taken = true;
      bridge.ok = true;
      const msg = JSON.stringify({ type: c.type, payload: c.payload });
      c.payload = null;
      return msg;
    },
    reply: function (id, json) {
      const c = bridge.calls[id];
      if (!c) return;
      delete bridge.calls[id];
      clearTimeout(c.t1); clearTimeout(c.t2);
      let r;
      try { r = JSON.parse(json); } catch (_) { return c.reject(new Error("unreadable answer from Scriptable")); }
      if (r.ok) return c.resolve(r.result);
      const err = new Error(r.error || "Scriptable reported an error");
      err.fatal = !!r.fatal;
      c.reject(err);
    },
  };
  function nativeCall(type, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (bridge.down) {
        const e = new Error("the connection to Scriptable isn't working");
        e.bridgeDown = true;
        return reject(e);
      }
      const id = ++bridge.seq;
      const c = { type: type, payload: payload, taken: false, resolve: resolve, reject: reject };
      c.t1 = setTimeout(() => {
        if (c.taken || !bridge.calls[id] || bridge.ok) return;
        delete bridge.calls[id];
        bridge.down = true;
        const e = new Error("the connection to Scriptable isn't working");
        e.bridgeDown = true;
        reject(e);
      }, 5000);
      c.t2 = setTimeout(() => {
        if (!bridge.calls[id]) return;
        delete bridge.calls[id];
        reject(new Error("no answer within " + Math.round(timeoutMs / 1000) + " s"));
      }, timeoutMs);
      bridge.calls[id] = c;
      const f = document.createElement("iframe");
      f.style.display = "none";
      f.src = "vsbridge://call?id=" + id;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 2000);
    });
  }
  function cancelCalls() {
    Object.keys(bridge.calls).forEach((id) => {
      const c = bridge.calls[id];
      if (c.type === "save") return;
      delete bridge.calls[id];
      clearTimeout(c.t1); clearTimeout(c.t2);
      const e = new Error("cancelled when the session ended");
      e.cancelled = true;
      c.reject(e);
    });
  }

// ── AI settings sheet (app-blueprints · ai-configuration) ──
  // Opened with window.__aiOpen(); the Scriptable side pushes state with window.__aiState(state).
  var AIS=null, aiIsOpen=false, aiArmed=null, aiLoading={};
  var AI_PN={ anthropic:'Claude', openai:'OpenAI' };
  var AI_FEAT={"analysis": "Photo analysis", "triggers": "Trigger checks", "refine": "Refining instructions", "test": "Connection tests", "other": "Other"};
  var AI_JOBS=[];
  function aiSend(act,data){ nativeCall(act,data,600000).catch(function(e){ window.__aiToast(e.message); }); }
  function aiEsc(t){ var d=document.createElement('div'); d.textContent=String(t==null?'':t); return d.innerHTML; }
  function aiFmtN(n){ return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(n); }
  function aiRel(t){ var s=Math.max(0,Math.round((Date.now()-t)/1000)); if(s<60) return 'just now'; if(s<3600) return Math.round(s/60)+' min ago'; if(s<86400) return Math.round(s/3600)+' h ago'; return Math.round(s/86400)+' d ago'; }
  function aiDayStr(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function aiArm(k){ aiArmed=k; renderAI(); setTimeout(function(){ if(aiArmed===k){ aiArmed=null; renderAI(); } },3500); }
  function aiSheet(){
    var el=document.getElementById('aisheet');
    if(!el){
      el=document.createElement('div'); el.id='aisheet'; el.setAttribute('role','dialog'); el.setAttribute('aria-label','AI settings');
      document.body.appendChild(el);
      el.addEventListener('click',aiClick);
      el.addEventListener('change',function(e){ e.stopPropagation(); if(e.target.classList.contains('modelsel')) aiSend('aimodel',{p:e.target.getAttribute('data-p'),v:e.target.value}); });
    }
    return el;
  }
  window.__aiOpen=function(){ aiIsOpen=true; renderAI(); aiSend('aistate',{}); };
  window.__aiState=function(s){ AIS=s; aiLoading={}; renderAI(); if(typeof window.__aiChanged==='function') window.__aiChanged(s); };
  window.__aiToast=function(t){
    if(!t) return; if(typeof toast==='function') return toast(t);
    var el=document.getElementById('aitoast'); if(!el){ el=document.createElement('div'); el.id='aitoast'; el.setAttribute('aria-live','polite'); document.body.appendChild(el); }
    el.textContent=t; el.classList.add('on'); clearTimeout(el.tm); el.tm=setTimeout(function(){ el.classList.remove('on'); },2600);
  };
  function aiUsageBlock(p,P){
    var days=[], now=new Date(), i;
    for(i=13;i>=0;i--){ var d=new Date(now); d.setDate(d.getDate()-i); days.push(aiDayStr(d)); }
    var tot=function(k){ var x=P.days[k]; return x?x.in+x.out:0; };
    var max=Math.max.apply(null,[1].concat(days.map(tot))), month=AIS.today.slice(0,7);
    var monthTot=Object.keys(P.days).filter(function(k){ return k.indexOf(month)===0; }).reduce(function(n,k){ return n+P.days[k].in+P.days[k].out; },0);
    var rows=function(obj,label){ return Object.keys(obj).sort(function(a,b){ return (obj[b].in+obj[b].out)-(obj[a].in+obj[a].out); }).map(function(k){ var x=obj[k];
      return '<tr><td>'+aiEsc(label(k))+'</td><td>'+x.calls+'</td><td>'+aiFmtN(x.in)+'</td><td>'+aiFmtN(x.out)+'</td></tr>'; }).join(''); };
    return '<div class="ucard"><div class="aic-h"><b>'+AI_PN[p]+'</b><span class="muted small">'+P.calls+' request'+(P.calls===1?'':'s')+'</span></div>'+
      '<div class="ustat"><div><b>'+aiFmtN(P.in+P.out)+'</b><small>total tokens</small></div><div><b>'+aiFmtN(P.in)+'</b><small>input</small></div><div><b>'+aiFmtN(P.out)+'</b><small>output</small></div></div>'+
      '<p class="note">Today '+aiFmtN(tot(AIS.today))+' tokens — this month '+aiFmtN(monthTot)+' tokens</p>'+
      '<div class="ubars" aria-label="Tokens per day, last 14 days">'+days.map(function(k){ var v=tot(k); return '<span style="height:'+Math.max(v?6:2,v/max*100)+'%" class="'+(v?'':'zero')+'" title="'+k+': '+v+' tokens"></span>'; }).join('')+'</div>'+
      '<div class="ubars-l"><span>2 weeks ago</span><span>Today</span></div>'+
      '<table class="utab"><tr><th>Feature</th><th>Requests</th><th>In</th><th>Out</th></tr>'+rows(P.features,function(k){ return AI_FEAT[k]||k; })+'</table>'+
      '<table class="utab"><tr><th>Model</th><th>Requests</th><th>In</th><th>Out</th></tr>'+rows(P.models,function(k){ return k; })+'</table></div>';
  }
  function renderAI(){
    var el=aiSheet(), keep=el.scrollTop;
    el.classList.toggle('open',aiIsOpen);
    if(!aiIsOpen) return;
    if(!AIS){ el.innerHTML='<div class="sh-head"><h2>AI</h2><button class="link" data-aiact="aiclose">Done</button></div><div class="sh-body"><p class="muted pad">Loading…</p></div>'; return; }
    var A=AIS;
    var card=function(p){
      var key=A.keys[p], ml=(A.models[p]||{}).list||[], cur=A.model[p];
      var opts=ml.some(function(m){ return m.id===cur; })?ml:[{id:cur,name:cur}].concat(ml);   // keep the chosen model visible
      return '<div class="aicard '+(A.provider===p?'active':'')+'">'+
        '<div class="aic-h"><b>'+AI_PN[p]+'</b>'+(A.provider===p?'<span class="badge-ai">In use</span>':key?'<button class="sm" data-aiact="aiprov" data-v="'+p+'">Use '+AI_PN[p]+'</button>':'')+'</div>'+
        '<div class="aic-row"><span class="lbl">API key</span>'+(key?'<code>'+aiEsc(key)+'</code>':'<span class="muted">Not set</span>')+'</div>'+
        '<div class="aic-btns"><button class="sm '+(key?'':'primary')+'" data-aiact="aikey" data-v="'+p+'">'+(key?'Change key':'Add key')+'</button>'+
          (key?'<button class="sm" data-aiact="aitest" data-v="'+p+'">Test connection</button><button class="sm danger '+(aiArmed==='rm'+p?'armed':'')+'" data-aiact="airm" data-v="'+p+'">'+(aiArmed==='rm'+p?'Confirm':'Remove')+'</button>':'')+'</div>'+
        '<label class="aic-row lbl" for="ms-'+p+'">Model</label>'+
        '<select id="ms-'+p+'" class="modelsel" data-p="'+p+'">'+opts.map(function(m){ return '<option value="'+aiEsc(m.id)+'" '+(m.id===cur?'selected':'')+'>'+aiEsc(m.name)+(m.name!==m.id?' — '+aiEsc(m.id):'')+'</option>'; }).join('')+'</select>'+
        '<div class="aic-btns"><button class="sm" data-aiact="aimodels" data-v="'+p+'" '+(key&&!aiLoading[p]?'':'disabled')+'>'+(aiLoading[p]?'Loading…':ml.length?'Refresh model list':'Load my models')+'</button>'+
          '<span class="note">'+(ml.length?ml.length+' models, updated '+aiRel(A.models[p].at):key?'Loads the models your key can use':'Add a key to load models')+'</span></div>'+
      '</div>';
    };
    var order=A.provider==='openai'?['openai','anthropic']:['anthropic','openai'];
    var used=Object.keys(A.usage.p).filter(function(p){ return A.usage.p[p].calls; });
    var jobs=AI_JOBS.length?AI_JOBS.map(function(j){
        return '<div class="srow"><div class="grow"><b>'+aiEsc(j.title)+'</b><small class="muted">'+aiEsc(j.text)+'</small></div>'+
          '<button class="switch '+(A.ai?'on':'')+'" data-aiact="aitoggle" aria-label="'+aiEsc(j.title)+'"></button></div>'; }).join('')
      :'<p class="muted pad">Nothing runs in the background: AI only runs during a capture session you start, or when you refine instructions.</p>';
    el.innerHTML='<div class="sh-head"><h2>AI</h2><button class="link" data-aiact="aiclose">Done</button></div><div class="sh-body">'+
      '<p class="hint">Keys stay in this iPhone’s Keychain. Only the provider marked “In use” is called.</p>'+
      order.map(card).join('')+
      '<h3 class="sec">What AI does</h3>'+jobs+
      '<h3 class="sec">Token usage</h3>'+
      (used.length?used.map(function(p){ return aiUsageBlock(p,A.usage.p[p]); }).join(''):'<p class="muted pad">No AI requests yet.</p>')+
      (used.length?'<div class="aic-btns"><span class="note">Counting since '+new Date(A.usage.since).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+'</span>'+
        '<button class="sm danger '+(aiArmed==='reset'?'armed':'')+'" data-aiact="usagereset">'+(aiArmed==='reset'?'Confirm reset':'Reset counters')+'</button></div>':'')+
    '</div>';
    el.scrollTop=keep;   // re-renders must not jump the user back to the top
  }
  function aiClick(e){
    e.stopPropagation();   // the sheet's taps never reach the app's own click handler
    if(e.target.closest('select, option, input, textarea')) return;
    var t=e.target.closest('[data-aiact]'); if(!t||t.disabled) return;
    var act=t.getAttribute('data-aiact'), v=t.getAttribute('data-v');
    if(act==='aiclose'){ aiIsOpen=false; aiArmed=null; renderAI(); return; }
    if(act==='aikey'||act==='aitest'||act==='aiprov'||act==='aitoggle'){ if(act==='aitest') window.__aiToast('Testing '+AI_PN[v]+'…'); aiSend(act,{v:v}); return; }
    if(act==='aimodels'){ aiLoading[v]=1; renderAI(); aiSend('aimodels',{v:v}); return; }
    if(act==='airm'){ if(aiArmed==='rm'+v){ aiArmed=null; aiSend('airm',{v:v}); } else aiArm('rm'+v); return; }
    if(act==='usagereset'){ if(aiArmed==='reset'){ aiArmed=null; aiSend('usagereset',{}); } else aiArm('reset'); return; }
  }

  // Shows the provider in use, and offers "Claude or OpenAI" under Analyze with only when a key is saved.
  function renderCloud() {
    const sel = $("engine");
    const cloudOpt = renderCloud.opt || (renderCloud.opt = $("engCloud"));   // kept while removed from the menu
    if (cloud.hasKey) {
      cloudOpt.textContent = cloud.name + " — " + cloud.model;
      if (!cloudOpt.parentNode) sel.insertBefore(cloudOpt, sel.firstChild);
    } else if (cloudOpt.parentNode) {
      cloudOpt.remove();
      if (cfg.engine === "openai") { cfg.engine = "apple"; persist(); }
    }
    sel.value = cfg.engine;
    updateEngineUI();
    $("aiStatus").textContent = cloud.hasKey
      ? "In use: " + cloud.name + " — " + cloud.model + ". Change it in Settings › AI settings."
      : "Add a Claude or OpenAI key in Settings › AI settings to analyze photos in the cloud. Apple Intelligence works without one.";
    const st = document.getElementById("s-aistatus");   // the AI settings row in Settings
    if (st) st.textContent = cloud.hasKey ? cloud.name + " — " + cloud.model : "Add a Claude or OpenAI key for cloud analysis";
  }
  window.__aiChanged = (s) => {
    cloud.hasKey = s.hasKey;
    cloud.name = AI_PN[s.provider];
    cloud.model = s.model[s.provider];
    renderCloud();
  };

  // ── AI invitation (app-blueprints · ai-invitation) ── ES5, no backticks: this sits inside the page's template string.
  window.__aiInvite = function (c) {
    var tries = 0;
    (function wait() {
      // Never over the launch screen, another sheet, or a task the app says can't be interrupted.
      var busy = document.querySelector("#splash:not(.gone)") || document.getElementById("upd") || document.getElementById("aiinv") ||
        document.querySelector(".sheet.open, #cfgsheet.open, #aisheet.open, #modal:not(.hidden), #editor:not(.hidden)") || (window.canInvite && !window.canInvite());
      if (busy) { if (++tries < 40) setTimeout(wait, 500); return; }   // gives up after 20 s; it comes back another day
      setTimeout(function () { if (!document.getElementById("aiinv")) showInvite(c); }, 600);
    })();
  };
  // Never during a capture session: not while it starts, records, pauses or is being saved.
  window.canInvite = function () { return !S.running && !starting; };
  function escI(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function showInvite(c) {
    var el = document.createElement("div");
    el.id = "aiinv";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "aiinv-t");
    el.innerHTML = '<div class="aiinv-card">' +
      '<div class="aiinv-spark" aria-hidden="true">✦</div>' +
      '<h2 id="aiinv-t">' + escI(c.title) + '</h2>' +
      '<p class="aiinv-lead">Add an AI key and these switch on:</p>' +
      '<ul class="aiinv-perks">' + c.perks.slice(0, 3).map(function (p, i) {
        return '<li style="--i:' + i + '"><span class="aiinv-ico" aria-hidden="true">' + escI(p.icon) + '</span>' + escI(p.text) + '</li>';
      }).join("") + '</ul>' +
      '<ol class="aiinv-steps"><li>Get a key from Claude or OpenAI</li><li>Paste it in AI settings</li><li>That’s it: these turn on at once</li></ol>' +
      '<button class="aiinv-go" data-inv="open">Turn on AI</button>' +
      '<div class="aiinv-row"><button class="aiinv-later" data-inv="later">Later</button>' +
      '<button class="aiinv-never" data-inv="never">Don’t remind me again</button></div></div>';
    el.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-inv]") : null;
      if (!b && e.target !== el) return;      // taps inside the card do nothing
      closeInvite(b ? b.dataset.inv : "later");   // a tap on the dimmed backdrop counts as Later
    });
    document.body.appendChild(el);
    nativeCall("aiinvite", { v: "shown" }, 10000).catch(function () {});
    var go = el.querySelector(".aiinv-go"); if (go && go.focus) go.focus();
  }
  function closeInvite(what) {
    var el = document.getElementById("aiinv"); if (!el || el.classList.contains("out")) return;
    el.classList.add("out");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    nativeCall("aiinvite", { v: what }, 10000).catch(function () {});
    if (what === "open") setTimeout(function () {
      // VisionX's AI sheet asks Scriptable for its state as it opens and redraws when it arrives: nudge after that redraw.
      var was = window.__aiChanged;
      window.__aiChanged = function (s) {
        window.__aiChanged = was; if (was) was(s);
        var add = document.querySelector('#aisheet [data-aiact="aikey"]');   // the provider in use comes first
        if (add) { add.classList.add("aiinv-nudge"); if (add.scrollIntoView) add.scrollIntoView({ block: "center" }); setTimeout(function () { add.classList.remove("aiinv-nudge"); }, 2600); }
      };
      window.__aiOpen();   // the same thing the Settings row's "ai-open" action does
    }, 280);
  }

  // ── Settings (app-blueprints · settings): every change applies at once and is saved; Done closes ──
  const LOOK = Object.assign({ theme: "auto", density: "comfortable", font: "sans", textSize: 1 }, BOOT.look || {});
  let SET = null, cfgIsOpen = false, cfgArmed = false;
  const darkMQ = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false };
  function applyLook() {
    const root = document.documentElement;
    root.dataset.theme = LOOK.theme === "auto" ? (darkMQ.matches ? "night" : "ink") : LOOK.theme;
    root.dataset.font = LOOK.font;
    root.style.setProperty("--ts", LOOK.textSize);
    document.body.classList.remove("d-comfortable", "d-compact", "d-tiny");
    document.body.classList.add("d-" + LOOK.density);
  }
  const onDark = () => { if (LOOK.theme === "auto") applyLook(); };
  if (darkMQ.addEventListener) darkMQ.addEventListener("change", onDark); else if (darkMQ.addListener) darkMQ.addListener(onDark);
  const hx = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cfgSheet = () => {
    let el = document.getElementById("cfgsheet");
    if (!el) {
      el = document.createElement("div"); el.id = "cfgsheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Settings");
      document.body.appendChild(el);
      el.addEventListener("click", cfgClick);
      el.addEventListener("change", cfgChange);
    }
    return el;
  };
  const cfgItem = (k) => { for (const sec of SET.cfgSchema) for (const d of sec.items) if (d.k === k) return d; return null; };
  const cfgChanged = (k) => { const d = cfgItem(k); return !!d && JSON.stringify(SET.cfg[k]) !== JSON.stringify(d.def); };
  const fmtCfg = (d, v) => (d.step && d.step < 1 ? Number(v).toFixed(String(d.step).split(".")[1].length) : String(v));
  const segRow = (k, opts, cur) => '<div class="seg wide">' + opts.map((o) => '<button class="' + (String(cur) === String(o[0]) ? "on" : "") + '" data-act="look" data-k="' + k + '" data-v="' + o[0] + '">' + hx(o[1]) + "</button>").join("") + "</div>";
  function lookHTML() {
    const P = SET.palettes, themes = [["auto", "Auto"]].concat(Object.keys(P).map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)]));
    const sws = themes.map((t) => {
      const k = t[0], l = t[1];
      const st = k === "auto" ? "background:linear-gradient(135deg," + P.ink.paper + " 50%," + P.night.sheet + " 50%);color:" + P.night.signal : "background:" + P[k].paper + ";color:" + P[k].ink;
      return '<button class="sw ' + (LOOK.theme === k ? "on" : "") + '" data-act="look" data-k="theme" data-v="' + k + '" aria-label="' + l + ' colours"><span class="prev" style="' + st + '">Aa<i style="background:' + (P[k] || P.night).signal + '"></i></span><small>' + l + "</small></button>";
    }).join("");
    return '<div class="lk-row"><span class="lk-l">Colours</span><div class="sws">' + sws + "</div></div>" +
      '<div class="lk-row"><span class="lk-l">Layout</span>' + segRow("density", [["comfortable", "Comfortable"], ["compact", "Compact"], ["tiny", "Tiny"]], LOOK.density) + "</div>" +
      '<div class="lk-row"><span class="lk-l">Text size</span>' + segRow("textSize", [[0.92, "Small"], [1, "Default"], [1.12, "Large"], [1.25, "Larger"]], LOOK.textSize) + "</div>" +
      '<div class="lk-row"><span class="lk-l">Headline font</span>' + segRow("font", [["sans", "Sans serif"], ["serif", "Serif"]], LOOK.font) + "</div>";
  }
  function fieldHTML(d) {
    const v = SET.cfg[d.k], ch = cfgChanged(d.k);
    const reset = ch ? '<button class="link small" data-act="cfgreset" data-k="' + d.k + '">Reset</button>' : "";
    return '<div class="cfg ' + (ch ? "ch" : "") + '"><div class="cfg-h"><b>' + hx(d.label) + "</b>" + reset + "</div>" + (d.help ? '<small class="muted">' + hx(d.help) + "</small>" : "") +
      '<div class="stepper"><button data-act="cfgstep" data-k="' + d.k + '" data-v="-1" aria-label="Decrease" ' + (v <= d.min ? "disabled" : "") + ">\u2212</button>" +
      '<input class="cfgin" data-k="' + d.k + '" value="' + fmtCfg(d, v) + '" inputmode="decimal" aria-label="' + hx(d.label) + '">' +
      '<button data-act="cfgstep" data-k="' + d.k + '" data-v="1" aria-label="Increase" ' + (v >= d.max ? "disabled" : "") + ">+</button>" +
      '<span class="unit">' + hx(d.unit || "") + '</span><span class="range">' + fmtCfg(d, d.min) + "\u2013" + fmtCfg(d, d.max) + (ch ? " \u2014 original " + fmtCfg(d, d.def) : "") + "</span></div></div>";
  }
  const bpLink = (b) => SET.blueprintsRepo + "/blob/" + b.id + "-v" + b.version + "/blueprints/" + b.id + ".md";
  function builtWithHTML() {
    return '<h3 class="sec">Built with</h3><p class="hint">' + hx(SET.appName) + " is built from shared blueprints that the other apps use too. Tap one to read how that part works.</p>" +
      SET.blueprints.map((b) => '<button class="srow bp" data-act="openurl" data-v="' + hx(bpLink(b)) + '"><div class="grow"><b>' + hx(b.name) + '</b><small class="muted">Blueprint ' + hx(b.version) + " \u00B7 since " + hx(SET.appName) + " " + hx(b.since) + '</small></div><span class="chev" aria-hidden="true">\u203A</span></button>').join("") +
      '<button class="srow bp" data-act="openurl" data-v="' + hx(SET.blueprintsRepo) + '"><div class="grow"><b>All blueprints</b><small class="muted">' + hx(SET.blueprintsRepo.replace("https://", "")) + '</small></div><span class="chev" aria-hidden="true">\u203A</span></button>';
  }
  function renderCfg() {
    const el = cfgSheet(), keep = el.scrollTop;
    el.classList.toggle("open", cfgIsOpen);
    document.body.style.overflow = cfgIsOpen ? "hidden" : "";
    if (!cfgIsOpen || !SET) return;
    const s = SET.settings, changed = Object.keys(SET.cfg).filter(cfgChanged).length;
    el.innerHTML = '<div class="sh-head"><h2>Settings</h2><button class="link" data-act="cfgclose">Done</button></div><div class="sh-body">' +
      '<p class="hint">Changes apply right away and are kept on this iPhone.</p>' +
      '<h3 class="sec">Appearance</h3>' + lookHTML() +
      '<h3 class="sec">AI</h3>' +
      '<div class="srow"><div class="grow"><b>Keys, models and token usage</b><small id="s-aistatus">' + hx(cloud.hasKey ? cloud.name + " \u2014 " + cloud.model : "Add a Claude or OpenAI key for cloud analysis") + "</small>" +
        (S.running ? '<small class="muted">Available when the session ends</small>' : "") + '</div><button class="sm" data-act="ai-open"' + (S.running ? " disabled" : "") + ">AI settings</button></div>" +
      '<h3 class="sec">Updates</h3>' +
      '<div class="srow"><div class="grow"><b>Offer new versions</b><small>You have VisionX ' + hx(SET.version) + ". \u201CLater\u201D waits two days.</small></div>" +
        '<button class="switch ' + (s.checkUpdates ? "on" : "") + '" data-act="toggle" data-v="checkUpdates" aria-label="Offer new versions"></button></div>' +
      '<div class="srow"><div class="grow"><b>Check for updates now</b><small id="updmsg" class="muted" aria-live="polite"></small></div><button class="sm" data-act="updcheck">Check</button></div>' +
      '<div class="srow"><div class="grow"><b>Start-up log</b><small class="muted">What happened the last times VisionX opened</small></div><button class="sm" data-act="startlog">Show</button></div>' +
      '<pre id="startlog" class="startlog" hidden></pre>' +
      SET.cfgSchema.map((sec) => '<h3 class="sec">' + hx(sec.title) + "</h3>" + sec.items.map(fieldHTML).join("")).join("") +
      '<div class="cfg-foot"><span class="note">' + (changed ? changed + " setting" + (changed === 1 ? "" : "s") + " changed" : "All settings are at their original values") + "</span>" +
        (changed ? '<button class="sm danger ' + (cfgArmed ? "armed" : "") + '" data-act="cfgall">' + (cfgArmed ? "Confirm reset" : "Reset all") + "</button>" : "") + "</div>" +
      builtWithHTML() + "</div>";
    el.scrollTop = keep;   // re-renders must not jump back to the top
  }
  function useCfg(c) {   // the Capture tunables take effect at once
    REQUEST_TIMEOUT_MS = c.requestWait * 1000; KEEP_FRAMES = c.keepFrames; DEBUG_KEEP = c.debugKeep;
    if (c.keepSessions) KEEP_SESSIONS = c.keepSessions;
  }
  const sendCfg = (type, payload) => nativeCall(type, payload || {}, 30000).then((st) => { if (st && st.cfgSchema) { SET = st; useCfg(st.cfg); } renderCfg(); }, (e) => { (window.__aiToast || alert)(e.message); renderCfg(); });
  function openSettings() {
    if (cfgIsOpen) return;
    nativeCall("settings-get", {}, 30000).then((st) => { SET = st; cfgIsOpen = true; renderCfg(); cfgSheet().scrollTop = 0; }, (e) => (window.__aiToast || alert)(e.message));
  }
  function closeSettings() { cfgIsOpen = false; cfgArmed = false; renderCfg(); }
  function cfgClick(e) {
    e.stopPropagation();   // the sheet's taps never reach the page underneath
    if (e.target.closest("select, option, input, textarea")) return;
    const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
    const act = t.dataset.act, v = t.dataset.v, k = t.dataset.k;
    if (act === "cfgclose") return closeSettings();
    if (act === "look") { const val = k === "textSize" ? +v : v; LOOK[k] = val; applyLook(); renderCfg(); return sendCfg("set", { k: k, v: val }); }
    if (act === "toggle") { SET.settings[v] = !SET.settings[v]; renderCfg(); return sendCfg("set", { k: v, v: SET.settings[v] }); }
    if (act === "cfgreset") return sendCfg("cfg", { k: k, reset: 1 });
    if (act === "cfgstep") { const d = cfgItem(k), step = d.step || 1; SET.cfg[k] = Number(Math.min(d.max, Math.max(d.min, Number(SET.cfg[k]) + step * +v)).toFixed(2)); renderCfg(); return sendCfg("cfg", { k: k, v: SET.cfg[k] }); }
    if (act === "cfgall") {
      if (cfgArmed) { cfgArmed = false; return sendCfg("cfg", { k: "*" }); }
      cfgArmed = true; renderCfg(); setTimeout(() => { if (cfgArmed) { cfgArmed = false; renderCfg(); } }, 3500); return;
    }
    if (act === "ai-open") return window.__aiOpen();
    if (act === "openurl") return nativeCall("openurl", { v: v }, 30000).catch(() => {});
    if (act === "startlog") {   // Settings › Updates › Start-up log (safe-startup recipe)
      const pre = document.getElementById("startlog");
      if (!pre.hidden) { pre.hidden = true; t.textContent = "Show"; return; }
      return nativeCall("startlog", {}, 30000).then((txt) => { pre.textContent = txt || "Nothing logged yet."; pre.hidden = false; t.textContent = "Hide"; }, (er) => (window.__aiToast || alert)(er.message));
    }
    if (act === "updcheck") {
      const um = document.getElementById("updmsg"); t.disabled = true; if (um) um.textContent = "Checking\u2026";
      return nativeCall("update-check", {}, 30000).then((r) => {
        t.disabled = false; if (um) um.textContent = r.msg;
        if (r.available) { closeSettings(); if (window.__showUpdate) window.__showUpdate(r.info); }
      }, (er) => { t.disabled = false; if (um) um.textContent = er.message; });
    }
  }
  function cfgChange(e) {
    e.stopPropagation();
    if (e.target.classList.contains("cfgin")) sendCfg("cfg", { k: e.target.dataset.k, v: e.target.value });
  }
  $("cfgOpen").addEventListener("click", openSettings);
  applyLook();
  $("toggle").addEventListener("click", () => (S.running ? endSession() : startSession()));
  wireTabs();
  wireControls();
  $("mClose").addEventListener("click", () => { $("modal").classList.add("hidden"); showQueuedUpdate(); });
  $("verLine").textContent = "VisionX v" + BOOT.version;

  // ── settings ──
  // The store file read by Scriptable wins; localStorage is a fallback copy.
  function loadStore() {
    const file = BOOT.store && typeof BOOT.store === "object" ? BOOT.store : null;
    let local = null, old = null;
    try {
      const v2 = localStorage.getItem(LS_KEY);
      if (v2) local = JSON.parse(v2);
      const v1 = localStorage.getItem(LS_OLD);
      if (v1) old = { settings: JSON.parse(v1) };
    } catch (_) {}
    if (file && local) return (local.savedAt || 0) > (file.savedAt || 0) ? local : file;
    return file || local || old || {};
  }
  function seedPresets() {
    return [
      { id: "p-people", name: "Count people", text: DEFAULTS.instructions },
      { id: "p-objects", name: "Count objects by category", text: "Count number of objects and categorize them" },
    ];
  }
  function storeData() { return { savedAt: savedAt, settings: cfg, presets: presets, triggers: triggers }; }
  function persist() {
    savedAt = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(storeData())); } catch (_) {}
    clearTimeout(fileSaveTimer);
    fileSaveTimer = setTimeout(() => { nativeCall("save", storeData(), 10000).catch(() => {}); }, 800);
  }
  // Scriptable reads this once the screen is closed and writes it to the store file.
  window.exportStore = function () { return JSON.stringify(storeData()); };
  function saveCfg() { persist(); }

  // ── presets ──
  function activePreset() {
    return presets.find((p) => p.id === cfg.activePreset) || null;
  }
  function renderPresets() {
    const sel = $("preset");
    sel.textContent = "";
    const custom = el("option", null, "Custom (not saved)");
    custom.value = "";
    sel.appendChild(custom);
    presets.forEach((p) => {
      const o = el("option", null, p.name);
      o.value = p.id;
      sel.appendChild(o);
    });
    const a = activePreset();
    sel.value = a ? a.id : "";
    updatePresetUI();
  }
  function updatePresetUI(flash) {
    const a = activePreset();
    const text = $("instructions").value.trim();
    const edited = !!a && a.text !== text;
    $("pUpdate").classList.toggle("hidden", !a);
    $("pDelete").classList.toggle("hidden", !a);
    if (a) $("pUpdate").textContent = "Update “" + a.name + "”";
    if (!S.running) $("pUpdate").disabled = !edited;
    clearTimeout(flashTimer);
    if (flash) {
      $("pHint").textContent = flash;
      flashTimer = setTimeout(() => updatePresetUI(), 2500);
      return;
    }
    $("pHint").textContent = edited
      ? "Edited. Update the preset to keep these changes."
      : !a && text ? "These instructions aren’t saved as a preset." : "";
  }
  function disarmDelete() {
    const b = $("pDelete");
    b.classList.remove("armed");
    b.textContent = "Delete preset";
    delete b.dataset.armed;
  }
  function wirePresets() {
    let typingTimer = null;
    $("preset").addEventListener("change", () => {
      const id = $("preset").value;
      const p = presets.find((x) => x.id === id);
      cfg.activePreset = p ? p.id : null;
      if (p) { $("instructions").value = p.text; cfg.instructions = p.text; }
      disarmDelete();
      persist();
      updatePresetUI();
    });
    $("instructions").addEventListener("input", () => {
      updatePresetUI();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        cfg.instructions = $("instructions").value.trim() || DEFAULTS.instructions;
        persist();
      }, 600);
    });
    $("pUpdate").addEventListener("click", () => {
      const a = activePreset();
      const text = $("instructions").value.trim();
      if (!a || !text) return;
      a.text = text;
      a.updated = Date.now();
      cfg.instructions = text;
      persist();
      updatePresetUI("Updated “" + a.name + "”.");
    });
    $("pNew").addEventListener("click", () => {
      $("pSaveRow").classList.remove("hidden");
      $("pName").value = "";
      $("pName").focus();
    });
    $("pCancel").addEventListener("click", () => $("pSaveRow").classList.add("hidden"));
    $("pName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pSave").click(); });
    $("pSave").addEventListener("click", () => {
      const name = $("pName").value.trim();
      const text = $("instructions").value.trim();
      if (!text) return updatePresetUI("Write some instructions first.");
      if (!name) { $("pName").focus(); return updatePresetUI("Give the preset a name."); }
      let p = presets.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const existed = !!p;
      if (p) { p.text = text; p.updated = Date.now(); }
      else {
        p = { id: "p-" + Date.now().toString(36), name: name, text: text, updated: Date.now() };
        presets.push(p);
      }
      cfg.activePreset = p.id;
      cfg.instructions = text;
      persist();
      $("pSaveRow").classList.add("hidden");
      renderPresets();
      updatePresetUI((existed ? "Updated “" : "Saved “") + p.name + "”.");
    });
    $("pDelete").addEventListener("click", () => {
      const b = $("pDelete");
      const a = activePreset();
      if (!a) return;
      if (!b.dataset.armed) {
        b.dataset.armed = "1";
        b.classList.add("armed");
        b.textContent = "Tap again to delete";
        setTimeout(disarmDelete, 3000);
        return;
      }
      presets = presets.filter((x) => x.id !== a.id);
      cfg.activePreset = null;
      disarmDelete();
      persist();
      renderPresets();
      updatePresetUI("Deleted “" + a.name + "”. The instructions stay in the box.");
    });
  }
  function fillForm() {
    FIELDS.forEach((k) => { $(k).value = String(cfg[k]); });
    $("accumulate").checked = cfg.accumulate !== false;
    $("applePhotos").checked = cfg.applePhotos !== false;
  }
  function isMoment() { return cfg.accumulate === false; }
  function updateModeUI() {
    const moment = isMoment();
    $("accHint").textContent = moment
      ? "Off: each photo is judged on its own and nothing carries over. The summary shows only the latest moment, and triggers are checked against every photo as it's analyzed."
      : "On: each photo adds to one running summary for the whole session. Triggers check that summary on their own schedule.";
    $("summaryTitle").textContent = moment ? "Right now" : "Summary so far";
    $("checkBox").classList.toggle("hidden", !isApple() || moment);
    updateTrigFormUI();
    $("trigHint").textContent = moment
      ? "With every photo, the model also answers each trigger's condition for that moment. When it's met, the trigger runs your shortcut and sends it the photo's summary or your own message."
      : "Every N seconds a trigger asks the model whether its condition is met by the summary so far. When it is, the trigger runs your shortcut and sends it the summary or your own message.";
    renderTriggerList();
    renderSummary();
  }
  function readForm() {
    cfg = Object.assign({}, cfg, {
      instructions: $("instructions").value.trim() || DEFAULTS.instructions,
      interval: Math.max(2, parseInt($("interval").value, 10) || DEFAULTS.interval),
      detail: $("detail").value,
      maxSide: parseInt($("maxSide").value, 10) || DEFAULTS.maxSide,
      facing: $("facing").value,
      engine: $("engine").value,
      shortcut: $("shortcut").value.trim() || DEFAULTS.shortcut,
      checkShortcut: $("checkShortcut").value.trim() || DEFAULTS.checkShortcut,
      accumulate: $("accumulate").checked,
    });
    saveCfg();
    fillForm();
  }
  function setFormDisabled(d) {
    FIELDS.concat(PRESET_IDS, TRIG_IDS).forEach((k) => { $(k).disabled = d; });
    if (d) $("trigForm").classList.add("hidden");
    renderTriggerList();
    if (!d) updatePresetUI();
  }

  // ── session ──
  function newSession() {
    return {
      running: false, stream: null, ctrl: null, frames: [], state: {}, summary: "",
      seq: 0, busyIdx: 0, nextAt: 0, fatal: null, wake: null, sleepTimer: null,
      trig: {}, trigOrder: [], debug: [],
      stats: { photos: 0, requests: 0, ok: 0, failed: 0, cancelled: 0, checks: 0, fired: 0,
               prompt: 0, completion: 0, total: 0, latency: 0, start: 0, end: 0 },
    };
  }

  // The live session for the Home Screen widget (app-blueprints · widgets); never blocks or fails the session.
  function sendWidget(sess) {
    const a = activePreset();
    nativeCall("widget", sess && sess.running ? { running: true, preset: a ? a.name : "", interval: cfg.interval, photos: sess.stats.photos, startedAt: sess.stats.start } : { running: false }, 10000).catch(() => {});
  }

  async function startSession() {
    if (starting) return;
    starting = true;
    $("toggle").disabled = true;
    readForm();
    hideError();
    S = newSession();
    S.by = isApple() ? "Apple Intelligence" : cloud.name;   // labels everything this session's AI writes
    renderAll();
    if (!isApple() && !cloud.hasKey) {
      showError("Claude or OpenAI needs an API key. Open Settings › AI settings to add one, or switch to Apple Intelligence.");
      starting = false;
      $("toggle").disabled = false;
      return;
    }
    if (!isApple()) setStatus("Opening camera…");
    if (!isApple()) try {
      await openCamera(S);
    } catch (e) {
      stopCamera();
      setStatus("Ready");
      showError("Camera didn't start: " + (e.message || e.name) + ". Allow camera access when iOS asks, then try again.");
      starting = false;
      $("toggle").disabled = false;
      return;
    }
    S.running = true;
    S.stats.start = Date.now();
    sendWidget(S);
    initTriggerState(S);
    renderTriggerStatus();
    starting = false;
    $("toggle").disabled = false;
    $("settingsBox").open = false;
    setFormDisabled(true);
    updateToggle();
    showView("live");
    renderNow();
    renderCountdown();
    clock = setInterval(tickClock, 500);
    loop(S);
  }

  async function endSession() {
    const sess = S;
    if (!sess.running) return;
    sess.running = false;
    sess.stats.end = Date.now();
    sendWidget(null);
    if (sess.paused) { sess.stats.paused = (sess.stats.paused || 0) + (sess.stats.end - sess.pausedAt); sess.paused = false; }
    if (sess.resumeWake) { const r = sess.resumeWake; sess.resumeWake = null; r(); }
    if (sess.ctrl) sess.ctrl.abort();
    cancelCalls();
    wake(sess);
    stopCamera();
    clearInterval(clock);
    setFormDisabled(false);
    updateToggle();
    setStatus("Session ended");
    renderTriggerStatus();
    // Let an aborted in-flight request settle so the stats include it.
    await new Promise((r) => setTimeout(r, 150));
    renderAll();
    await finishSession(sess);
  }

  async function loop(sess) {
    while (sess.running) {
      if (sess.paused) { await new Promise((r) => { sess.resumeWake = r; }); if (!sess.running) break; }
      const t0 = Date.now();
      await shoot(sess);
      if (sess.fatal) { showError(sess.fatal); await endSession(); break; }
      if (!sess.running) break;
      await pause(sess, cfg.interval * 1000 - (Date.now() - t0));
    }
  }

  async function shoot(sess) {
    if (isApple()) return shootApple(sess);
    let img;
    try {
      await ensureCamera(sess);
      if (!sess.running) return;
      img = captureFrame();
    } catch (e) { showError("Camera: " + e.message); return; }

    sess.stats.photos++;
    sendWidget(sess);
    const frame = { idx: ++sess.seq, img, time: new Date().toLocaleTimeString(), pending: true, t0: Date.now() };
    sess.frames.unshift(frame);
    if (sess.frames.length > KEEP_FRAMES) sess.frames.length = KEEP_FRAMES; // older photos dropped from memory
    sess.busyIdx = frame.idx;
    renderAll(); tickClock();

    sess.stats.requests++;
    let afterTask = null;
    const dbg = addDebug(sess, frame, cloud.name);
    const t0 = Date.now();
    try {
      const { result, usage } = await analyze(sess, frame, dbg);
      dbg.parsed = result;
      dbg.usage = { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 };
      frame.ms = Date.now() - t0;
      frame.tokens = usage.total_tokens || 0;
      frame.text = result.frame;
      sess.stats.ok++;
      sess.stats.latency += frame.ms;
      sess.stats.prompt += usage.prompt_tokens || 0;
      sess.stats.completion += usage.completion_tokens || 0;
      sess.stats.total += usage.total_tokens || 0;
      if (result.state) sess.state = result.state;
      if (isMoment()) { sess.state = result.state || {}; sess.summary = result.summary || result.frame; sess.summaryAt = { idx: frame.idx, time: frame.time }; }
      else if (result.summary || result.frame) { sess.summary = result.summary || result.frame; sess.summaryAt = { idx: frame.idx, time: frame.time }; }
      afterTask = () => afterPhoto(sess, frame, result.triggers);
      if (sess === S) hideError();
    } catch (e) {
      frame.error = e.message;
      if (e.cancelled) sess.stats.cancelled++;
      else sess.stats.failed++;
      dbg.error = e.message;
      if (e.attempts) { dbg.attempts = e.attempts; dbg.dropped = e.dropped || []; }
      if (e.fatal) sess.fatal = cloud.name + " request stopped the session: " + e.message;
      else if (!e.cancelled && sess === S) showError("Photo #" + frame.idx + " wasn't analyzed: " + e.message + ". The session keeps going.");
    } finally {
      dbg.ms = Date.now() - t0;
      frame.pending = false;
      sess.busyIdx = 0;
      if (sess === S) renderAll();
    }
    if (afterTask) await afterTask();
  }

  async function shootApple(sess) {
    const frame = { idx: ++sess.seq, img: null, time: new Date().toLocaleTimeString(), pending: true, t0: Date.now() };
    sess.frames.unshift(frame);
    if (sess.frames.length > KEEP_FRAMES) sess.frames.length = KEEP_FRAMES;
    sess.busyIdx = frame.idx;
    renderAll(); tickClock();
    sess.stats.requests++;
    let afterTask = null;
    const dbg = addDebug(sess, frame, "Apple Intelligence");
    const t0 = Date.now();
    try {
      const prompt = systemPrompt(true) + "\n\n" + frameContext(sess, frame) + "\n\nThe photo for this frame is attached.";
      dbg.request = { prompt: prompt };
      const wantPhoto = cfg.applePhotos !== false;
      frame.noPhoto = !wantPhoto;
      const r = await withShortcutLock(() => nativeCall("apple", { shortcut: cfg.shortcut, prompt: prompt, wantPhoto: wantPhoto }, 180000));
      if (r.photo) frame.img = r.photo;
      if (r.photo || (!wantPhoto && r.text)) { sess.stats.photos++; sendWidget(sess); }
      dbg.raw = r.text || "";
      if (!r.text) throw new Error("the shortcut returned no text. End it with Stop and Output set to the model's Response");
      const result = parseResult(r.text);
      dbg.parsed = result;
      frame.ms = Date.now() - t0;
      frame.text = result.frame;
      sess.stats.ok++;
      sess.stats.latency += frame.ms;
      if (result.state) sess.state = result.state;
      if (isMoment()) { sess.state = result.state || {}; sess.summary = result.summary || result.frame; sess.summaryAt = { idx: frame.idx, time: frame.time }; }
      else if (result.summary || result.frame) { sess.summary = result.summary || result.frame; sess.summaryAt = { idx: frame.idx, time: frame.time }; }
      afterTask = () => afterPhoto(sess, frame, result.triggers);
      if (sess === S) hideError();
    } catch (e) {
      frame.error = e.message;
      if (e.cancelled) sess.stats.cancelled++;
      else sess.stats.failed++;
      dbg.error = e.message;
      if (e.fatal || e.bridgeDown) sess.fatal = "Apple Intelligence stopped the session: " + e.message;
      else if (!e.cancelled && sess === S) showError("Photo #" + frame.idx + " wasn't analyzed: " + e.message + ". The session keeps going.");
    } finally {
      dbg.ms = Date.now() - t0;
      frame.pending = false;
      sess.busyIdx = 0;
      if (sess === S) renderAll();
    }
    if (afterTask) await afterTask();
  }

  // ── camera ──
  async function openCamera(sess) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This WebView doesn't expose the camera API.");
    }
    sess.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: cfg.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const v = $("live");
    v.srcObject = sess.stream;
    await v.play().catch(() => {});
    await waitForVideo(v);
    await applyZoom(sess);
  }

  // ── zoom ──
  // Uses the camera's own zoom when iOS offers it (sharper), and crops the
  // frame for anything beyond that (digital zoom).
  async function applyZoom(sess) {
    const want = Math.max(1, Number(cfg.zoom) || 1);
    let camera = 1;
    const track = sess.stream && sess.stream.getVideoTracks ? sess.stream.getVideoTracks()[0] : null;
    if (track && track.getCapabilities) {
      let caps = null;
      try { caps = track.getCapabilities(); } catch (_) {}
      if (caps && caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max > 1) {
        const target = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, want));
        try {
          await track.applyConstraints({ advanced: [{ zoom: target }] });
          camera = target;
        } catch (_) {}
      }
    }
    zoomState = { camera: camera, digital: Math.max(1, want / camera) };
    updateZoomUI();
  }

  function updateZoomUI() {
    const z = Math.max(1, Number(cfg.zoom) || 1);
    $("zoom").value = String(z);
    $("zoomVal").textContent = z.toFixed(1) + "\u00D7";
    syncZoomChips();
    const v = $("live");
    const mirror = cfg.facing === "user" ? "scaleX(-1) " : "";
    v.style.transform = mirror + "scale(" + zoomState.digital + ")";
    let kind = "";
    if (S.stream && z > 1) {
      kind = zoomState.camera > 1 && zoomState.digital > 1.01 ? " Camera zoom plus digital zoom."
        : zoomState.camera > 1 ? " Camera zoom."
        : " Digital zoom: the photo is cropped, so detail drops as you zoom in.";
    }
    $("zoomHint").textContent = "Change it any time, even while capturing. The next photo uses it." + kind;
  }

  function wireZoom() {
    const setZoom = (z) => {
      cfg.zoom = Math.round(Math.min(5, Math.max(1, z)) * 10) / 10;
      // Preview straight away; settle the camera zoom once the slider stops.
      zoomState.digital = Math.max(1, cfg.zoom / zoomState.camera);
      updateZoomUI();
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => { if (S.stream) applyZoom(S); persist(); }, 200);
      // Enlarge the live preview briefly so you can aim.
      if (S.stream) {
        $("liveWrap").classList.add("aiming");
        clearTimeout(aimTimer);
        aimTimer = setTimeout(() => $("liveWrap").classList.remove("aiming"), 1500);
      }
    };
    $("zoom").addEventListener("input", () => setZoom(parseFloat($("zoom").value)));
    $("zoomReset").addEventListener("click", () => setZoom(1));
    updateZoomUI();
  }
  // Running a trigger shortcut switches apps, which can stop the camera. Reopen it if so.
  async function ensureCamera(sess) {
    const v = $("live");
    const tracks = sess.stream && sess.stream.getVideoTracks ? sess.stream.getVideoTracks() : [];
    const track = tracks[0];
    if (track && track.readyState === "live" && !track.muted && v.videoWidth > 0) {
      if (v.paused) await v.play().catch(() => {});
      return;
    }
    if (sess.stream) sess.stream.getTracks().forEach((t) => t.stop());
    await openCamera(sess);
  }
  function waitForVideo(v) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        if (v.videoWidth > 0) return setTimeout(resolve, 500); // short warm-up for exposure
        if (Date.now() - t0 > 6000) return reject(new Error("no video frames arrived"));
        setTimeout(check, 100);
      })();
    });
  }
  function captureFrame() {
    const v = $("live");
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) throw new Error("The camera isn't delivering frames. Keep the app in the foreground.");
    const d = Math.max(1, zoomState.digital || 1);
    const sw = w / d, sh = h / d, sx = (w - sw) / 2, sy = (h - sh) / 2;
    const scale = Math.min(1, cfg.maxSide / Math.max(sw, sh));
    const cv = $("cv");
    cv.width = Math.round(sw * scale);
    cv.height = Math.round(sh * scale);
    cv.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.85);
  }
  function stopCamera() {
    zoomState = { camera: 1, digital: Math.max(1, Number(cfg.zoom) || 1) };
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    if (!S.stream && !$("live").srcObject) return;
    S.stream = null;
    $("live").srcObject = null;
  }

  // ── OpenAI ──
  // labelled = the simpler FRAME/SUMMARY/STATE format, used for Apple Intelligence.
  function systemPrompt(labelled) {
    if (isMoment()) return momentPrompt(labelled);
    return [
      "You analyze a live camera feed one frame at a time during a capture session.",
      "",
      "USER TASK:",
      cfg.instructions,
      "",
      "With every new frame you receive the accumulated state from earlier frames. Merge what you see in the new frame into that state so the result covers the whole session:",
      "- Track distinct entities (people, objects, events). Give each a short id and a distinguishing visual description so you recognize them when they reappear; never double-count the same entity.",
      "- Keep counts and totals consistent with everything seen so far, not only this frame.",
      "- Keep the state compact (well under 2000 characters); merge or drop low-value detail when needed.",
      "- If the frame is dark, blurry or empty, say so and keep the state unchanged.",
      "- " + mdHint(labelled),
      "",
    ].concat(labelled ? [
      "Respond in exactly this format and nothing else:",
      "FRAME: 1-2 sentences on what THIS frame shows that matters for the task",
      "SUMMARY: concise cumulative answer to the task for the whole session so far",
      "STATE: the full updated cumulative state as valid JSON with double-quoted keys",
    ] : [
      "Respond with JSON only, using exactly these keys:",
      '{"frame": "1-2 sentences on what THIS frame shows that matters for the task",',
      ' "state": { the full updated cumulative state },',
      ' "summary": "concise cumulative answer to the task for the whole session so far"}',
    ]).join("\n");
  }

  // Fresh mode: every photo stands alone, and trigger conditions are judged on it directly.
  function momentPrompt(labelled) {
    const active = S.trigOrder.filter((id) => !S.trig[id].off).map((id) => S.trig[id].t);
    const lines = [
      "You analyze single photos from a live camera. Each photo stands alone: judge only what is visible in THIS photo. Nothing carries over from earlier photos.",
      "",
      "USER TASK:",
      cfg.instructions,
      "",
      "If the photo is dark, blurry or empty, say so.",
      mdHint(labelled),
    ];
    if (active.length) {
      lines.push("", "CONDITIONS. For each one, decide from this photo alone whether it is met right now:");
      active.forEach((t) => lines.push('- "' + t.id + '": ' + t.condition));
    }
    if (labelled) {
      lines.push(
        "",
        "Respond in exactly this format and nothing else:",
        "FRAME: 1-2 sentences on what this photo shows that matters for the task",
        "SUMMARY: concise answer to the task for this photo only",
        "STATE: the details you counted or noticed in this photo, as compact JSON on a single line"
      );
      if (active.length) lines.push('TRIGGERS: {"<condition id>": {"met": true or false, "reason": "one short sentence"}} as JSON on a single line');
      return lines.join("\n");
    }
    lines.push(
      "",
      "Respond with JSON only, using exactly these keys:",
      '{"frame": "1-2 sentences on what this photo shows that matters for the task",',
      ' "state": { the details you counted or noticed in this photo },',
      ' "summary": "concise answer to the task for this photo only"' + (active.length ? "," : "}")
    );
    if (active.length) lines.push(' "triggers": { "<condition id>": {"met": true or false, "reason": "one short sentence"} }}');
    return lines.join("\n");
  }

  function frameContext(sess, frame) {
    if (isMoment()) return "Photo #" + frame.idx + " taken at " + frame.time + ".";
    return "Frame #" + frame.idx + " taken at " + frame.time + ".\n\n" +
      "Accumulated state so far (JSON):\n" + JSON.stringify(sess.state) + "\n\n" +
      "Cumulative summary so far:\n" + (sess.summary || "(nothing yet, this is the first analyzed frame)");
  }

  // What the Scriptable side sends through aiCall: the provider and model come from AI settings.
  function buildBody(sess, frame) {
    return { feature: "analysis", system: systemPrompt(), text: frameContext(sess, frame), image: frame.img, detail: cfg.detail, maxTokens: 4000 };
  }

  // ── debug log: the last 10 photos with what was sent and what came back ──
  // Kept in memory only (never written to disk) and cleared when a session starts.

  function addDebug(sess, frame, engine) {
    const entry = {
      id: "d-" + frame.idx, idx: frame.idx, time: frame.time, frame: frame,
      engine: engine, model: engine === "Apple Intelligence" ? cfg.shortcut : cloud.model,
      mode: isMoment() ? "fresh each photo" : "built up over the session",
      request: null, raw: "", parsed: null, usage: null, ms: 0, attempts: 0, dropped: [], error: "", checks: [],
    };
    sess.debug.unshift(entry);
    if (sess.debug.length > DEBUG_KEEP) sess.debug.length = DEBUG_KEEP;
    return entry;
  }

  function imageInfo(dataUrl) {
    if (!dataUrl) return null;
    const kb = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75 / 1024);
    return "JPEG, " + kb + " KB";
  }

  function escHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // Colours JSON tokens: keys, strings, numbers, true/false/null, brackets.
  function highlightJSON(text) {
    const src = String(text);
    const re = /("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([{}\[\],])/g;
    let out = "", last = 0, m;
    while ((m = re.exec(src))) {
      out += escHTML(src.slice(last, m.index));
      if (m[1]) out += m[2] ? '<span class="jk">' + escHTML(m[1]) + "</span>" + escHTML(m[2]) : '<span class="js">' + escHTML(m[1]) + "</span>";
      else if (m[3]) out += '<span class="jb">' + m[3] + "</span>";
      else if (m[4]) out += '<span class="jn">' + m[4] + "</span>";
      else out += '<span class="jp">' + escHTML(m[5]) + "</span>";
      last = re.lastIndex;
    }
    return out + escHTML(src.slice(last));
  }

  // Plain text with any embedded JSON blocks highlighted, and LABELS: in bold.
  function highlightMixed(text) {
    const src = String(text || "");
    let out = "", i = 0;
    const plain = (t) => escHTML(t).replace(/^([ \t]*)([A-Z][A-Z0-9 ()\-]{2,}:)/gm, '$1<span class="jl">$2</span>');
    while (i < src.length) {
      const next = src.slice(i).search(/[{\[]/);
      if (next === -1) { out += plain(src.slice(i)); break; }
      const at = i + next;
      const end = balancedEnd(src, at);
      if (end !== -1 && parseLooseJSON(src.slice(at, end))) {
        out += plain(src.slice(i, at)) + highlightJSON(src.slice(at, end));
        i = end;
      } else {
        out += plain(src.slice(i, at + 1));
        i = at + 1;
      }
    }
    return out;
  }

  function codeBlock(html, extra) {
    const pre = el("pre", "code" + (extra ? " " + extra : ""));
    pre.innerHTML = html;
    return pre;
  }

  function renderDebug() {
    const list = S.debug || [];
    $("debugCount").textContent = list.length ? list.length + " of " + DEBUG_KEEP : "";
    $("debugCopy").disabled = !list.length;
    renderDebugList($("debugList"), list, "Start a session to see exactly what is sent to the model and what comes back for each photo.");
  }

  function renderDebugList(box, list, emptyText) {
    const open = new Set(Array.from(box.querySelectorAll("details.dbg[open]")).map((d) => d.dataset.id));
    box.textContent = "";
    if (!list.length) {
      box.appendChild(el("div", "hint", emptyText));
      return;
    }
    list.forEach((e) => {
      const d = el("details", "dbg");
      d.dataset.id = e.id;
      const head = el("summary", "dbgHead");
      if (e.frame.img) {
        const t = new Image();
        t.src = e.frame.img;
        t.alt = "";
        head.appendChild(t);
      } else head.appendChild(el("span", "dbgNoImg"));
      const status = e.frame.pending ? "waiting for the reply" : e.error ? "error" : "ok";
      const bits = [e.engine, e.ms ? (e.ms / 1000).toFixed(1) + " s" : "", e.usage && e.usage.total_tokens ? fmtNum(e.usage.total_tokens) + " tokens" : "", e.checks.length ? e.checks.length + " trigger check" + (e.checks.length === 1 ? "" : "s") : ""].filter(Boolean);
      const txt = el("div", "dbgText");
      txt.append(el("b", null, "#" + e.idx + " at " + e.time), el("span", "tsub", bits.join(", ")));
      head.append(txt, el("span", "dbgStatus " + (e.error ? "bad" : e.frame.pending ? "wait" : "good"), status));
      d.appendChild(head);
      const body = el("div", "dbgBody");
      d.appendChild(body);
      d.addEventListener("toggle", () => { if (d.open && !body.childNodes.length) fillDebug(body, e); });
      box.appendChild(d);
      if (open.has(e.id)) d.open = true;
    });
  }

  function fillDebug(body, e) {
    const section = (title, node) => { body.appendChild(el("h3", null, title)); body.appendChild(node); };
    const meta = {
      engine: e.engine, model: e.model, summary_mode: e.mode, time: e.time,
      seconds: e.ms ? +(e.ms / 1000).toFixed(2) : null,
      attempts: e.attempts || null, dropped_settings: e.dropped.length ? e.dropped : undefined,
      usage: e.usage || undefined, photo: imageInfo(e.frame.img) || (e.frame.noPhoto ? "not shown (clipboard reading is off)" : null),
    };
    section("Overview", codeBlock(highlightJSON(JSON.stringify(meta, null, 2))));
    if (e.frame.img) {
      const img = new Image();
      img.src = e.frame.img;
      img.alt = "Photo #" + e.idx;
      img.className = "dbgPhoto";
      section("Photo", img);
    }
    if (e.request && e.request.instructions) section("Sent: instructions", codeBlock(highlightMixed(e.request.instructions)));
    if (e.request && e.request.text) section("Sent: with the photo", codeBlock(highlightMixed(e.request.text)));
    if (e.request && e.request.settings) section("Sent: request settings", codeBlock(highlightJSON(JSON.stringify(e.request.settings, null, 2))));
    if (e.request && e.request.prompt) section("Sent: prompt", codeBlock(highlightMixed(e.request.prompt)));
    if (e.raw) section("Reply as received", codeBlock(highlightMixed(e.raw)));
    if (e.parsed) section("Reply as understood", codeBlock(highlightJSON(JSON.stringify(e.parsed, null, 2))));
    if (e.error) section("Error", codeBlock(escHTML(e.error), "bad"));
    e.checks.forEach((c) => {
      const d = el("details", "dbgCheck");
      const ran = /ran at/.test(c.decision || "");
      d.appendChild(el("summary", null, "Trigger check: " + c.trigger + " at " + c.time + (c.error ? " (error)" : c.verdict ? (c.verdict.met ? (ran ? " (met, shortcut ran)" : " (met, shortcut not run)") : " (not met)") : "")));
      const inner = el("div");
      const add = (title, node) => { inner.appendChild(el("h3", null, title)); inner.appendChild(node); };
      add("Sent", codeBlock(highlightMixed(c.prompt)));
      if (c.raw) add("Reply as received", codeBlock(highlightMixed(c.raw)));
      if (c.verdict) add("Reply as understood", codeBlock(highlightJSON(JSON.stringify(c.verdict, null, 2))));
      if (c.sent) add("Sent to the shortcut", codeBlock(highlightMixed(c.sent)));
      if (c.decision) add("What VisionX did", codeBlock(escHTML(c.decision), /didn't run|failed/.test(c.decision) ? "bad" : ""));
      if (c.error) add("Error", codeBlock(escHTML(c.error), "bad"));
      d.appendChild(inner);
      body.appendChild(d);
    });
  }

  function debugExport(entries) {
    return JSON.stringify((entries || S.debug || []).map((e) => ({
      photo: "#" + e.idx, time: e.time, engine: e.engine, model: e.model, summary_mode: e.mode,
      image: imageInfo(e.frame && e.frame.img), seconds: e.ms ? +(e.ms / 1000).toFixed(2) : null,
      attempts: e.attempts, dropped_settings: e.dropped, usage: e.usage,
      request: e.request, reply_raw: e.raw, reply_parsed: e.parsed, error: e.error || undefined, trigger_checks: e.checks,
    })), null, 2);
  }

  function wireDebug() {
    $("debugCopy").addEventListener("click", async () => {
      const text = debugExport();
      const done = (msg) => { $("debugHint").textContent = msg; };
      try {
        await nativeCall("copy", { text: text }, 10000);
        done("Copied " + (S.debug || []).length + " entries as JSON (without the photos).");
      } catch (_) {
        try { await navigator.clipboard.writeText(text); done("Copied as JSON (without the photos)."); }
        catch (e2) { done("Couldn't copy: " + e2.message); }
      }
    });
    renderDebug();
  }

  // ── Markdown for AI text (frame and summary) ──
  // Safe by design: everything is escaped; the only HTML kept is <meter>/<progress> with numeric attributes.
  function mdInline(src) {
    const keep = [];
    const stash = (html) => { keep.push(html); return "\u0000" + (keep.length - 1) + "\u0000"; };
    let t = String(src == null ? "" : src).replace(/\u0000/g, "");
    t = t.replace(/<(meter|progress)\b([^>]*)>(?:\s*<\/(?:meter|progress)>)?/gi, (m, tag, attrs) => {
      tag = tag.toLowerCase();
      const allowed = tag === "meter" ? ["value", "min", "max", "low", "high", "optimum"] : ["value", "max"];
      let out = "<" + tag + ' class="mdgauge"', ok = false;
      attrs.replace(/(\w+)\s*=\s*["']?(-?\d*\.?\d+)["']?/g, (a, k, v) => {
        k = k.toLowerCase();
        if (allowed.indexOf(k) !== -1 && isFinite(parseFloat(v))) { out += " " + k + '="' + parseFloat(v) + '"'; if (k === "value") ok = true; }
        return a;
      });
      return ok ? stash(out + "></" + tag + ">") : m;
    });
    t = t.replace(new RegExp(BT + "([^" + BT + "]+)" + BT, "g"), (m, c) => stash("<code>" + escHTML(c) + "</code>"));
    t = escHTML(t);
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '<span class="mdlink">$1</span>');
    t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => "<strong>" + (a || b) + "</strong>");
    t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![\w*])/g, "$1<em>$2</em>");
    t = t.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
    t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return t.replace(/\u0000(\d+)\u0000/g, (m, n) => keep[+n] || "");
  }
  // ── Charts in AI text ──
  // Mermaid pie and xychart-beta blocks, and stats tiles, are drawn here as SVG/HTML in the
  // page's colours: offline, instant on every photo, and nothing from the model runs as code.
  // Anything that doesn't parse stays a plain code block.
  const VX_SLOTS = 8;
  const vxNum = (s) => { const v = parseFloat(String(s).replace(/[\s,]/g, "")); return isFinite(v) ? v : NaN; };
  const vxFmt = (v) => String(Math.round(v * 100) / 100);
  const vxPct = (p) => (Math.round(p * 10) / 10) + "%";
  const vxUnq = (s) => String(s || "").trim().replace(/^["']|["']$/g, "").trim();
  function vxList(s) {
    const out = [];
    String(s).replace(/"([^"]*)"|'([^']*)'|([^,]+)/g, (m, a, b, c) => { const t = (a != null ? a : b != null ? b : c).trim(); if (t) out.push(t); return m; });
    return out;
  }
  function chartBlock(lang, body) {
    const src = body.join("\n").replace(/^\s*%%.*$/gm, "").trim();
    const first = (src.split("\n")[0] || "").trim().toLowerCase();
    try {
      if (lang === "stats" || lang === "kpi") return renderStatTiles(src);
      if (lang && ["mermaid", "pie", "xychart", "xychart-beta", "chart"].indexOf(lang) === -1) return null;
      if (/^pie\b/.test(first)) return renderPie(src);
      if (lang === "pie") return renderPie("pie\n" + src);
      if (/^xychart(-beta)?\b/.test(first)) return renderXY(src);
    } catch (_) {}
    return null;
  }
  function vxFigure(cls, title, inner, aria) {
    return '<figure class="vxChart ' + cls + '" role="img" aria-label="' + escHTML(aria) + '">' +
      (title ? "<figcaption>" + mdInline(title) + "</figcaption>" : "") + inner + "</figure>";
  }
  function renderPie(src) {
    const lines = src.split("\n");
    let title = "";
    const head = /^\s*pie\b(?:\s+showData)?(?:\s+title\s+(.+?))?\s*$/i.exec(lines[0]);
    if (head && head[1]) title = vxUnq(head[1]);
    let items = [];
    lines.slice(1).forEach((l) => {
      let m;
      if ((m = /^\s*title\s+(.+?)\s*$/i.exec(l))) { title = vxUnq(m[1]); return; }
      if (!(m = /^\s*(?:"([^"]*)"|'([^']*)'|([^:"']+?))\s*:\s*(-?[\d.,]+)\s*%?\s*$/.exec(l))) return;
      const v = vxNum(m[4]);
      let label = (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]).trim();
      // "Dogs \u2014 1 (14.3%)": the legend already shows the number and share, so drop the repeat.
      const tail = /\s*(?:[\u2014\u2013:-])?\s*(-?[\d.,]+)\s*(?:\(\s*[\d.,]+\s*%\s*\))?\s*$/.exec(label);
      if (tail && tail.index > 0 && Math.abs(vxNum(tail[1]) - v) < 1e-9) label = label.slice(0, tail.index).trim();
      label = label.replace(/\s*\(\s*[\d.,]+\s*%\s*\)\s*$/, "").trim();
      if (isFinite(v) && v > 0 && label) items.push({ label: label, v: v });
    });
    if (!items.length) return null;
    items = items.map((it, k) => ({ label: it.label, v: it.v, k: k })).sort((a, b) => b.v - a.v || a.k - b.k);
    if (items.length > VX_SLOTS) {
      const rest = items.slice(VX_SLOTS - 1);
      items = items.slice(0, VX_SLOTS - 1).concat([{ label: "Other (" + rest.length + ")", v: rest.reduce((a, b) => a + b.v, 0) }]);
    }
    const total = items.reduce((a, b) => a + b.v, 0);
    const R = 15.9155; // circumference 100, so dash lengths are percentages
    let off = 25, segs = "";
    items.forEach((it, k) => {
      const p = it.v / total * 100, gap = items.length > 1 && p > 2 ? 0.9 : 0;
      segs += '<circle class="vxSeg vxc' + (k + 1) + '" cx="21" cy="21" r="' + R + '" stroke-dasharray="' + (p - gap).toFixed(3) + " " + (100 - p + gap).toFixed(3) + '" stroke-dashoffset="' + off.toFixed(3) + '"/>';
      off -= p;
    });
    const svg = '<svg class="vxDonut" viewBox="0 0 42 42" aria-hidden="true"><circle class="vxTrackC" cx="21" cy="21" r="' + R + '"/>' + segs +
      '<text class="vxTot" x="21" y="23.2">' + escHTML(vxFmt(total)) + '</text><text class="vxTotL" x="21" y="28">total</text></svg>';
    const legend = '<ul class="vxLegend">' + items.map((it, k) =>
      '<li class="vxc' + (k + 1) + '"><i class="vxSw"></i><span class="vxL">' + mdInline(it.label) + '</span><span class="vxV">' + escHTML(vxFmt(it.v)) + '</span><span class="vxP">' + vxPct(it.v / total * 100) + "</span></li>").join("") + "</ul>";
    const aria = (title ? title + ". " : "") + items.map((it) => it.label + " " + vxFmt(it.v) + " (" + vxPct(it.v / total * 100) + ")").join(", ");
    return vxFigure("vxPie", title, '<div class="vxPieBody">' + svg + legend + "</div>", aria);
  }
  function renderXY(src) {
    let title = "", cats = null, yMin = NaN, yMax = NaN;
    const bars = [], lns = [];
    src.split("\n").slice(1).forEach((l) => {
      let m;
      if ((m = /^\s*title\s+(.+?)\s*$/i.exec(l))) { title = vxUnq(m[1]); return; }
      if ((m = /^\s*x-axis\b.*?\[(.*)\]\s*$/i.exec(l))) { cats = vxList(m[1]); return; }
      if ((m = /^\s*y-axis\b.*?(-?[\d.]+)\s*-->\s*(-?[\d.]+)\s*$/i.exec(l))) { yMin = vxNum(m[1]); yMax = vxNum(m[2]); return; }
      if ((m = /^\s*(bar|line)\b\s*(?:"([^"]*)"|'([^']*)')?\s*\[(.*)\]\s*$/i.exec(l))) {
        const vals = vxList(m[4]).map(vxNum);
        if (!vals.length || vals.some((v) => !isFinite(v))) return;
        (m[1].toLowerCase() === "bar" ? bars : lns).push({ name: m[2] || m[3] || "", vals: vals });
      }
    });
    if (!bars.length && !lns.length) return null;
    const n = Math.max.apply(null, bars.concat(lns).map((s) => s.vals.length));
    if (!cats || cats.length < n) cats = Array.from({ length: n }, (_, k) => (cats && cats[k]) || String(k + 1));
    const series = bars.concat(lns);
    const keys = series.length > 1 ? '<div class="vxKeys">' + series.map((s, k) =>
      '<span class="vxc' + (k % VX_SLOTS + 1) + '"><i class="vxSw"></i>' + escHTML(s.name || (k < bars.length ? "Bars" + (bars.length > 1 ? " " + (k + 1) : "") : "Line" + (lns.length > 1 ? " " + (k - bars.length + 1) : ""))) + "</span>").join("") + "</div>" : "";
    let inner = "";
    if (bars.length) {
      const top = Math.max(isFinite(yMax) ? yMax : 0, Math.max.apply(null, bars.map((s) => Math.max.apply(null, s.vals)))) || 1;
      inner += '<div class="vxBars">';
      for (let k = 0; k < n; k++) {
        const vals = bars.map((s) => s.vals[k]);
        const tr = bars.map((s, j) => '<i class="vxc' + (j + 1) + '" style="width:' + Math.max(0, Math.min(100, (s.vals[k] || 0) / top * 100)).toFixed(1) + '%"></i>').join("");
        inner += '<span class="vxL">' + mdInline(cats[k]) + '</span><span class="vxTrack' + (bars.length > 1 ? " multi" : "") + '">' + tr + '</span><span class="vxV">' +
          vals.map((v) => (isFinite(v) ? escHTML(vxFmt(v)) : "\u2013")).join(" / ") + "</span>";
      }
      inner += "</div>";
    }
    if (lns.length) {
      const all = [].concat.apply([], lns.map((s) => s.vals));
      let lo = isFinite(yMin) ? yMin : Math.min(0, Math.min.apply(null, all)), hi = isFinite(yMax) ? yMax : Math.max.apply(null, all);
      if (hi <= lo) hi = lo + 1;
      const W = 260, H = 120, L = 30, Rt = 8, T = 10, B = 22, pw = W - L - Rt, ph = H - T - B;
      const X = (k) => L + (n > 1 ? k * pw / (n - 1) : pw / 2), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
      let g = '<line class="vxGrid" x1="' + L + '" y1="' + T + '" x2="' + (W - Rt) + '" y2="' + T + '"/><line class="vxGrid" x1="' + L + '" y1="' + (T + ph) + '" x2="' + (W - Rt) + '" y2="' + (T + ph) + '"/>' +
        '<text x="' + (L - 4) + '" y="' + (T + 4) + '" text-anchor="end">' + escHTML(vxFmt(hi)) + '</text><text x="' + (L - 4) + '" y="' + (T + ph + 3) + '" text-anchor="end">' + escHTML(vxFmt(lo)) + "</text>";
      const step = Math.max(1, Math.ceil(n / 5));
      for (let k = 0; k < n; k += step) g += '<text x="' + X(k).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + escHTML(String(cats[k]).slice(0, 8)) + "</text>";
      lns.forEach((s, j) => {
        const cls = "vxc" + ((bars.length + j) % VX_SLOTS + 1);
        const pts = s.vals.map((v, k) => X(k).toFixed(1) + "," + Y(v).toFixed(1));
        g += '<g class="' + cls + '"><polyline class="vxPath" points="' + pts.join(" ") + '"/>' +
          (n <= 24 ? pts.map((p) => '<circle class="vxDot" r="2.8" cx="' + p.split(",")[0] + '" cy="' + p.split(",")[1] + '"/>').join("") : "") + "</g>";
      });
      inner += '<svg class="vxLine" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' + g + "</svg>";
    }
    const aria = (title ? title + ". " : "") + series.map((s) => (s.name ? s.name + ": " : "") + cats.slice(0, n).map((c, k) => c + " " + (isFinite(s.vals[k]) ? vxFmt(s.vals[k]) : "none")).join(", ")).join("; ");
    return vxFigure("vxXY", title, inner + keys, aria);
  }
  // Headline-number tiles from a "stats" code block. Its own name: the session stats strip below is renderStats().
  function renderStatTiles(src) {
    const tiles = [];
    src.split("\n").forEach((l) => {
      const t = l.replace(/^\s*[-*+]\s+/, "").trim();
      const c = t.indexOf(":");
      if (c <= 0) return;
      const rest = t.slice(c + 1).split("|");
      const value = rest[0].trim();
      if (value) tiles.push({ label: t.slice(0, c).trim(), value: value, note: (rest[1] || "").trim() });
    });
    if (!tiles.length) return null;
    return '<div class="vxStats">' + tiles.slice(0, 8).map((x) =>
      '<div class="vxTile"><b>' + mdInline(x.value) + "</b><span>" + mdInline(x.label) + "</span>" + (x.note ? "<small>" + mdInline(x.note) + "</small>" : "") + "</div>").join("") + "</div>";
  }

  // The visuals the page can draw, told to the model (with every photo, and when refining).
  function visualGuide() {
    const F = BT + BT + BT;
    return [
      "- Shares of a whole: a donut chart. Write a code block opened with " + F + "mermaid and closed with " + F + ", containing: pie title <short title>, then one line per slice: \"<label>\" : <number>. Labels without the number or percentage; the app adds them.",
      "- Counts per category (bars) or change over time (line): a " + F + "mermaid code block containing: xychart-beta, then title \"<short title>\", x-axis [a, b, c], then bar [1, 2, 3] and/or line [1, 2, 3].",
      "- 2 to 4 headline numbers as tiles: a " + F + "stats code block, one tile per line: <label>: <value> | <optional short note>.",
      "- A level or progress: <meter value=\"0.7\"></meter> or <progress value=\"3\" max=\"5\"></progress>.",
      "- Tables for per-item details; an emoji before a label as an icon.",
    ].join("\n");
  }
  function md(src) {
    const lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    const fenceRe = new RegExp("^\\s*(" + BT + "{3,}|~{3,})");
    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const isSep = (l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.indexOf('|') !== -1;
    const cells = (l) => { let c = l.trim(); if (c.charAt(0) === "|") c = c.slice(1); if (c.slice(-1) === "|") c = c.slice(0, -1); return c.split("|").map((x) => x.trim()); };
    let html = "", i = 0, para = [];
    const flush = () => { if (para.length) { html += "<p>" + para.map(mdInline).join("<br>") + "</p>"; para = []; } };
    while (i < lines.length) {
      const line = lines[i];
      let m = fenceRe.exec(line);
      if (m) {
        flush();
        const fence = m[1].charAt(0).repeat(3), body = [];
        const lang = (line.trim().slice(m[1].length).trim().split(/\s+/)[0] || "").toLowerCase();
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) { body.push(lines[i]); i++; }
        i++;
        html += chartBlock(lang, body) || ('<pre class="mdpre"><code>' + escHTML(body.join("\n")) + "</code></pre>");
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); html += '<div class="mdh mdh' + m[1].length + '">' + mdInline(m[2]) + "</div>"; i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html += "<hr>"; i++; continue; }
      if (line.indexOf("|") !== -1 && i + 1 < lines.length && isSep(lines[i + 1])) {
        flush();
        const head = cells(line);
        const al = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
        const td = (tag, c, k) => "<" + tag + (al[k] ? ' style="text-align:' + al[k] + '"' : "") + ">" + mdInline(c) + "</" + tag + ">";
        let t = '<div class="mdtable"><table><thead><tr>' + head.map((c, k) => td("th", c, k)).join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) {
          const r = cells(lines[i]);
          t += "<tr>" + head.map((x, k) => td("td", r[k] || "", k)).join("") + "</tr>";
          i++;
        }
        html += t + "</tbody></table></div>";
        continue;
      }
      if (/^\s*>/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        html += "<blockquote>" + md(q.join("\n")) + "</blockquote>";
        continue;
      }
      if (listRe.test(line)) {
        flush();
        const stack = [];
        let out = "";
        while (i < lines.length) {
          const lm = listRe.exec(lines[i]);
          if (!lm) {
            if (stack.length && /^\s{2,}\S/.test(lines[i])) { out += "<br>" + mdInline(lines[i].trim()); i++; continue; }
            break;
          }
          const indent = lm[1].replace(/\t/g, "    ").length, type = /\d/.test(lm[2]) ? "ol" : "ul";
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) out += "</li></" + stack.pop().type + ">";
          const top = stack[stack.length - 1];
          if (!top || indent > top.indent) { out += "<" + type + ">"; stack.push({ type: type, indent: indent }); }
          else out += "</li>";
          let item = lm[3];
          const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
          if (task) item = (task[1] === " " ? "\u2610 " : "\u2611 ") + task[2];
          out += "<li>" + mdInline(item);
          i++;
        }
        while (stack.length) out += "</li></" + stack.pop().type + ">";
        html += out;
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return html;
  }


  // ── session controls in the header: Start, Pause/Resume, Stop ──
  function updateControls() {
    const run = S.running, paused = run && S.paused;
    $("hStart").classList.toggle("hidden", run);
    $("hPause").classList.toggle("hidden", !run);
    $("hStop").classList.toggle("hidden", !run);
    $("hStart").disabled = starting;
    $("hPause").innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
    $("hPause").setAttribute("aria-label", paused ? "Resume session" : "Pause session");
    $("hPause").classList.toggle("resume", !!paused);
    $("statusBox").classList.toggle("paused", !!paused);
    sessChrome();
  }
  function pauseSession() {
    const sess = S;
    if (!sess.running || sess.paused) return;
    sess.paused = true;
    sess.pausedAt = Date.now();
    wake(sess);                       // cut the wait; the loop then waits for Resume
    updateControls();
    setStatus("Paused");
    renderCountdown();
    renderTabs();
  }
  function resumeSession() {
    const sess = S;
    if (!sess.running || !sess.paused) return;
    const d = Date.now() - sess.pausedAt;
    sess.stats.paused = (sess.stats.paused || 0) + d;
    sess.paused = false;
    sess.trigOrder.forEach((id) => { const st = sess.trig[id]; if (st.nextAt) st.nextAt += d; });  // trigger timers paused too
    if (sess.resumeWake) { const r = sess.resumeWake; sess.resumeWake = null; r(); }
    updateControls();
    renderTabs();
    tickClock();
  }
  function pausedMs(sess) {
    return (sess.stats.paused || 0) + (sess.paused && sess.pausedAt ? Date.now() - sess.pausedAt : 0);
  }
  // ── while a session runs: tabs and status line hidden; the photo row sticks and halves on scroll ──
  function sessChrome() {
    document.body.classList.toggle("sess", !!S.running);
    requestAnimationFrame(sizeLiveRow);
  }
  function sizeLiveRow() {
    const hdr = $("hdr"), g = document.querySelector(".liveGrid");
    if (!hdr || !g) return;
    document.documentElement.style.setProperty("--hdrH", Math.max(0, Math.round(hdr.getBoundingClientRect().height) - 1) + "px");
    const cs = getComputedStyle(g);
    const w = g.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (w > 0) {
      const gap = parseFloat(cs.columnGap) || 8;
      g.style.setProperty("--tileH", Math.round(((w - 2 * gap) / 3) * 4 / 3) + "px");
      g.classList.add("sized");
    }
    miniCheck();
  }
  // Halves once the row has stuck and the page moved on 40 px; grows back near where it stuck.
  function miniCheck() {
    const g = document.querySelector(".liveGrid"), sen = $("liveSentinel");
    if (!g || !sen) return;
    if (!S.running || $("liveOn").classList.contains("hidden")) { g.classList.remove("mini"); return; }
    const hdrH = $("hdr").getBoundingClientRect().height;
    const top = sen.getBoundingClientRect().top;
    if (!g.classList.contains("mini") && top < hdrH - 40) g.classList.add("mini");
    else if (g.classList.contains("mini") && top > hdrH - 4) g.classList.remove("mini");
  }
  function wireControls() {
    $("hStart").innerHTML = ICON_PLAY;
    $("hStop").innerHTML = ICON_STOP;
    $("hStart").addEventListener("click", () => { if (!S.running) startSession(); });
    $("hPause").addEventListener("click", () => (S.paused ? resumeSession() : pauseSession()));
    $("hStop").addEventListener("click", () => endSession());
    const hdr = $("hdr");
    const stuck = () => hdr.classList.toggle("stuck", window.scrollY > 4);
    window.addEventListener("scroll", stuck, { passive: true });
    window.addEventListener("scroll", miniCheck, { passive: true });
    window.addEventListener("resize", () => requestAnimationFrame(sizeLiveRow));
    stuck();
    updateControls();
  }

  // Told to the model with every photo: Markdown only when the task asks for it.
  function mdHint(labelled) {
    return "Formatting: write plain sentences unless the user task asks for formatting or visuals. If it does, " +
      (labelled ? "FRAME and SUMMARY" : "\"frame\" and \"summary\"") +
      " may use Markdown (headings, **bold**, lists, tables) and these visuals, which the app draws as graphics:\n" + visualGuide() +
      "\nNo other HTML or diagram types. Put visuals in " + (labelled ? "SUMMARY" : "\"summary\"") + "; keep " + (labelled ? "FRAME" : "\"frame\"") + " to a sentence or two." +
      (labelled ? " Inside FRAME and SUMMARY, never start a line with FRAME:, SUMMARY:, STATE: or TRIGGERS:." : " Inside JSON strings, write line breaks as \\n and quotes as \\\".");
  }

  // ── analysis progress on the photo being analyzed ──
  // Estimated from how long the recent photos took (the AI doesn't report progress).
  function expectedAnalysisMs() {
    const hist = (S.debug || []).filter((e) => e.ms && !e.error && !(e.frame && e.frame.pending)).slice(0, 5).map((e) => e.ms).sort((a, b) => a - b);
    if (hist.length) return Math.max(1500, hist[Math.floor(hist.length / 2)]);
    return isApple() ? 12000 : 6000;
  }
  function analysisProgress(f) {
    const t = Date.now() - (f.t0 || Date.now()), exp = expectedAnalysisMs();
    const p = t < exp ? 0.9 * t / exp : 0.9 + 0.09 * (1 - Math.exp(-(t - exp) / exp));
    const left = Math.ceil((exp - t) / 1000);
    return { p: p, label: t < exp ? (left <= 1 ? "almost done" : "\u2248 " + left + " s left") : "taking longer than usual\u2026" };
  }
  function anlOverlay(done) {
    const o = el("div", "anl" + (done ? " done" : ""));
    o.innerHTML = '<div class="anlScan"></div><div class="anlBox"><svg class="anlRing" viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle class="trk" cx="22" cy="22" r="19"></circle><circle class="arc" cx="22" cy="22" r="19" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (done ? 0 : 100) + '"></circle></svg>' +
      '<span class="anlPct num">' + (done ? "\u2713" : "0%") + '</span></div><div class="anlTxt num">' + (done ? "Analyzed" : "Analyzing\u2026") + "</div>";
    return o;
  }
  function updateAnalysis() {
    const f = S.frames[0];
    const o = document.querySelector("#nowPhoto .anl:not(.done)");
    if (!o || !f || !f.pending) return;
    const pr = analysisProgress(f);
    o.querySelector(".arc").setAttribute("stroke-dashoffset", String(Math.round(100 - pr.p * 100)));
    o.querySelector(".anlPct").textContent = Math.round(pr.p * 100) + "%";
    o.querySelector(".anlTxt").textContent = isApple() && !f.img ? "Taking the photo\u2026" : pr.label;
  }
  setInterval(() => { if (S.running) updateAnalysis(); }, 150);

  // ── compact trigger status (Live) ──
  function trigBadge(st) {
    if (st.off) return "off";
    return { checking: "checking\u2026", firing: "running\u2026", fired: "ran", met: "met, held", notmet: "not met", error: "problem", waiting: "waiting" }[st.status] || "waiting";
  }
  function trigLine(sess, st) {
    const next = Math.max(0, Math.ceil((st.nextAt - Date.now()) / 1000));
    let line;
    switch (st.status) {
      case "idle": line = !sess.running ? "Not checked." : isMoment() ? "Checked with every photo." : st.t.when === "photo" ? "Checked after each photo." : "First check in " + next + " s."; break;
      case "waiting": line = "Waiting for the first summary."; break;
      case "checking": line = "Checking the condition\u2026"; break;
      case "firing": line = "Condition met. Running \u201C" + st.t.shortcut + "\u201D\u2026"; break;
      case "notmet": line = "Not met: " + st.reason; break;
      case "met": line = "Met (" + st.reason.replace(/[.!]+$/, "") + "), not run again: " + (st.t.mode === "once" ? "it runs only the first time." : "it already ran and waits for the condition to turn false." + (isMoment() ? "" : " Choose \u201CEach new occurrence\u201D for repeated events.")); break;
      case "fired": line = "Ran \u201C" + st.t.shortcut + "\u201D at " + st.firedAt + ": " + st.reason; break;
      case "error": line = "Problem: " + st.error; break;
      default: line = "";
    }
    line = String(line).trim();
    if (line && !/[.!?\u2026]$/.test(line)) line += ".";
    if (st.done) line += " Done for this session.";
    else if (sess.running && !st.off && !isMoment() && st.t.when !== "photo" && !st.busy && st.status !== "idle" && st.status !== "waiting") line += " Next check in " + next + " s.";
    return line;
  }
  function shortTime(t) { return t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""; }
  function renderTriggerStatus() {
    const box = $("trigStatus");
    const sess = S;
    box.classList.toggle("hidden", !sess.trigOrder.length);
    if (!sess.trigOrder.length) return;
    const on = sess.trigOrder.filter((id) => !sess.trig[id].off), off = sess.trigOrder.filter((id) => sess.trig[id].off);
    const sig = on.join(",") + "|" + off.join(",") + "|" + trigOffOpen;
    if (sig !== trigSig) {
      trigSig = sig;
      box.textContent = "";
      box.appendChild(el("div", "tr2sum"));
      const row = (id) => {
        const st = sess.trig[id];
        const r = el("div", "tr2");
        r.dataset.id = id;
        const h = el("button", "tr2h");
        h.type = "button";
        h.append(el("span", "tdot"), el("span", "tr2n", st.t.name), el("span", "tr2b"), el("span", "tr2c num"), el("span", "tr2t num"));
        const m = el("div", "tr2m" + (trigOpen[id] ? "" : " hidden"));
        const txt = el("div", "txt");
        txt.append(el("div", "ln"), el("div", null, "If: " + st.t.condition), el("div", null, "Runs \u201C" + st.t.shortcut + "\u201D, sending " + (SEND_LABELS[st.t.send] || SEND_LABELS.summary) + "."));
        const sw = makeSwitch(!st.off, "Trigger " + st.t.name + " on", (v) => setTriggerEnabled(id, v));
        m.append(txt, sw.wrap);
        h.setAttribute("aria-expanded", trigOpen[id] ? "true" : "false");
        h.addEventListener("click", () => {
          trigOpen[id] = !trigOpen[id];
          m.classList.toggle("hidden", !trigOpen[id]);
          h.setAttribute("aria-expanded", trigOpen[id] ? "true" : "false");
        });
        r.append(h, m);
        return r;
      };
      on.forEach((id) => box.appendChild(row(id)));
      if (off.length) {
        const b = el("button", "tr2off", (trigOffOpen ? "\u25BE " : "\u25B8 ") + "Off: " + off.map((id) => sess.trig[id].t.name).join(", "));
        b.type = "button";
        b.setAttribute("aria-expanded", trigOffOpen ? "true" : "false");
        b.addEventListener("click", () => { trigOffOpen = !trigOffOpen; renderTriggerStatus(); });
        box.appendChild(b);
        if (trigOffOpen) off.forEach((id) => box.appendChild(row(id)));
      }
    }
    // tally
    let ran = 0, runs = 0, held = 0, notmet = 0, checking = 0, problems = 0;
    on.forEach((id) => {
      const st = sess.trig[id];
      if (st.fired) { ran++; runs += st.fired; }
      if (st.status === "met") held++;
      if (st.status === "notmet") notmet++;
      if (st.status === "checking" || st.status === "firing") checking++;
      if (st.status === "error") problems++;
    });
    const parts = [];
    parts.push('<span class="ran"><b>' + ran + "</b> ran" + (runs > ran ? " (" + runs + " runs)" : "") + "</span>");
    if (checking) parts.push("<span><b>" + checking + "</b> checking</span>");
    if (held) parts.push("<span><b>" + held + "</b> met, held</span>");
    parts.push("<span><b>" + notmet + "</b> not met</span>");
    if (problems) parts.push("<span><b>" + problems + "</b> with a problem</span>");
    if (off.length) parts.push("<span><b>" + off.length + "</b> off</span>");
    box.querySelector(".tr2sum").innerHTML = parts.join("");
    // rows
    const now = Date.now();
    box.querySelectorAll(".tr2").forEach((r) => {
      const st = sess.trig[r.dataset.id];
      if (!st) return;
      const cls = ["tr2", st.off ? "off" : st.status];
      if (st.fired) cls.push("lit");
      if (st.flashUntil > now) cls.push("flash");
      r.className = cls.join(" ");
      r.querySelector(".tr2b").textContent = trigBadge(st);
      r.querySelector(".tr2c").textContent = st.fired ? st.fired + "\u00D7" : "";
      r.querySelector(".tr2t").textContent = shortTime(st.status === "fired" ? st.firedTs : st.lastAt);
      r.querySelector(".ln").textContent = st.off ? "Off." + (st.fired ? " Ran " + st.fired + (st.fired === 1 ? " time" : " times") + " before." : "") : trigLine(sess, st);
      const input = r.querySelector(".switch input");
      if (input && input.checked === st.off) input.checked = !st.off;
    });
  }

  // ── the photo row: Live, Analyzing, Analyzed ──
  function renderNow() {
    const f = S.frames[0];
    const box = $("nowPhoto");
    box.textContent = "";
    const pending = f && f.pending ? f : null;
    box.classList.toggle("busy", !!pending);
    if (pending) {
      box.appendChild(photoView(pending));
      box.appendChild(el("span", "nowBadge num", "#" + pending.idx));
      box.appendChild(anlOverlay(false));
      anlPendingIdx = pending.idx;
      updateAnalysis();
      $("nowCap").textContent = "Analyzing #" + pending.idx + "\u2026";
    } else {
      const w = el("div", "nowWait");
      w.id = "nowWait";
      box.appendChild(w);
      updateNowWait();
      $("nowCap").textContent = "Analyzing";
    }
    renderLast();
  }
  function updateNowWait() {
    const w = $("nowWait");
    if (!w) return;
    let big = "", small;
    if (!S.running) small = "Starts with the session";
    else if (S.paused) { big = "\u23F8"; small = "Paused"; }
    else if (S.triggerWaitIdx) { big = "\u2026"; small = "Running triggers"; }
    else if (S.nextAt) { big = Math.max(0, Math.ceil((S.nextAt - Date.now()) / 1000)) + " s"; small = "to the next photo"; }
    else { big = "\u2026"; small = "Taking a photo"; }
    w.innerHTML = (big ? "<b>" + escHTML(big) + "</b>" : "") + escHTML(small);
  }
  // The newest analyzed photo: its result is already in the summary below.
  function renderLast() {
    const f = S.frames.find((x) => !x.pending) || null;
    const box = $("lastPhoto");
    box.textContent = "";
    box.classList.toggle("empty", !f);
    if (!f) {
      box.appendChild(el("div", "nowWait", "No photo analyzed yet"));
      $("lastCap").textContent = "Analyzed";
      return;
    }
    box.appendChild(photoView(f));
    box.appendChild(el("span", "nowBadge num", "#" + f.idx));
    const ok = !f.error;
    const inSummary = ok && S.summaryAt && S.summaryAt.idx === f.idx;
    box.appendChild(el("div", "inSum" + (ok ? "" : " bad"), ok ? (inSummary ? "\u2713 In the summary" : "\u2713 Analyzed") : "\u2715 Not analyzed"));
    if (anlPendingIdx === f.idx || (anlDoneIdx === f.idx && Date.now() - anlDoneAt < 1300)) {
      if (anlPendingIdx === f.idx) {
        anlDoneIdx = f.idx; anlDoneAt = Date.now(); anlPendingIdx = 0;
        box.classList.remove("fresh"); void box.offsetWidth; box.classList.add("fresh");
      }
      box.appendChild(anlOverlay(true));
    }
    $("lastCap").textContent = "Analyzed #" + f.idx + ", " + f.time;
  }
  function wireZoomChips() {
    document.querySelectorAll(".zoomChips button").forEach((b) => {
      b.addEventListener("click", () => {
        const r = $("zoom");
        r.value = b.dataset.z;
        r.dispatchEvent(new Event("input"));
      });
    });
    syncZoomChips();
  }
  function syncZoomChips() {
    const z = Number(cfg.zoom) || 1;
    document.querySelectorAll(".zoomChips button").forEach((b) => {
      const on = Math.abs(Number(b.dataset.z) - z) < 0.05;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // ── tabs: Setup, Triggers, Live, Sessions ──
  let currentView = "setup";
  function showView(name) {
    currentView = name;
    ["setup", "triggers", "live", "sessions"].forEach((v) => {
      $("view-" + v).classList.toggle("hidden", v !== name);
      const tab = $("tab-" + v);
      tab.setAttribute("aria-selected", v === name ? "true" : "false");
      tab.tabIndex = v === name ? 0 : -1;
    });
    window.scrollTo(0, 0);
    if (name === "live") requestAnimationFrame(sizeLiveRow);
  }
  function renderTabs() {
    $("tab-live").innerHTML = (S.running ? '<span class="recdot' + (S.paused ? " held" : "") + '" aria-hidden="true"></span>' : "") + "Live";
    $("tab-live").setAttribute("aria-label", S.running ? (S.paused ? "Live, paused" : "Live, recording") : "Live");
    $("tab-sessions").innerHTML = "Sessions" + (sessions.length ? '<span class="cnt">' + sessions.length + "</span>" : "");
    $("liveIdle").classList.toggle("hidden", S.running);
    $("liveOn").classList.toggle("hidden", !S.running);
  }
  function wireTabs() {
    $("tab-setup").addEventListener("click", () => showView("setup"));
    $("tab-triggers").addEventListener("click", () => showView("triggers"));
    $("tab-live").addEventListener("click", () => showView("live"));
    $("tab-sessions").addEventListener("click", () => {
      showView("sessions");
      showSessionList();
      refreshSessions().then(() => { if (currentView === "sessions" && $("sesDetail").classList.contains("hidden")) showSessionList(); });
    });
    $("liveStart").addEventListener("click", () => startSession());
    renderTabs();
  }

  // ── Live view: the photo being analyzed, and the countdown to the next one ──
  function renderCountdown() {
    const sub = $("cdSub"), bar = $("cdBar"), fill = $("cdFill");
    let busy = false, width = 0, note = "";
    if (!S.running) { sub.textContent = ""; fill.style.width = "0"; bar.classList.remove("busy"); return; }
    if (S.busyIdx) { busy = true; note = S.paused ? "pauses after this photo" : ""; }
    else if (S.triggerWaitIdx) { busy = true; }
    else if (S.paused) { note = "tap \u25B6 to resume"; }
    else if (S.nextAt) {
      const ms = Math.max(0, S.nextAt - Date.now());
      width = Math.max(0, Math.min(100, 100 * (1 - ms / (cfg.interval * 1000))));
      note = "every " + cfg.interval + " s";
    } else busy = true;
    const prev = parseFloat(fill.style.width) || 0;
    fill.style.transition = busy || width < prev ? "none" : "";
    fill.style.width = (busy ? 100 : width) + "%";
    bar.classList.toggle("busy", busy);
    sub.textContent = note;
  }

  // ── saving a finished session ──
  function makeThumb(src) {
    return new Promise((resolve) => {
      if (!src) return resolve("");
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => resolve(""), 1000);
      const img = new Image();
      img.onload = () => {
        try {
          const k = 160 / Math.max(img.width, img.height);
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          done(c.toDataURL("image/jpeg", 0.7));
        } catch (e) { done(""); }
      };
      img.onerror = () => done("");
      img.src = src;
    });
  }

  async function buildSessionRecord(sess) {
    const images = {};
    const frames = sess.frames.map((f) => {
      if (f.img) images[f.idx] = f.img;
      const o = Object.assign({}, f);
      delete o.img; delete o.pending;
      return o;
    });
    const debug = (sess.debug || []).map((e) => {
      if (e.frame && e.frame.img) images[e.idx] = e.frame.img;
      const o = Object.assign({}, e);
      o.noPhoto = !!(e.frame && e.frame.noPhoto);
      o.pending = !!(e.frame && e.frame.pending);
      delete o.frame;
      return o;
    });
    const trigs = sess.trigOrder.map((id) => {
      const st = sess.trig[id];
      return { name: st.t.name, condition: st.t.condition, shortcut: st.t.shortcut, mode: st.t.mode || "rise", when: st.t.when || "interval",
        off: !!st.off, fired: st.fired, checks: st.checks, reason: st.reason || "", decision: st.decision || "", error: st.error || "", firedAt: st.firedAt || "" };
    });
    const latest = sess.frames.find((f) => f.img);
    const thumb = await makeThumb(latest && latest.img);
    const a = activePreset();
    const engine = isApple() ? "Apple Intelligence" : (sess.by || cloud.name) + " \u2014 " + cloud.model;
    const id = "s-" + sess.stats.start;
    const meta = {
      id: id, startedAt: sess.stats.start, endedAt: sess.stats.end, photos: sess.stats.photos, fired: sess.stats.fired,
      engine: engine, mode: isMoment() ? "fresh" : "build", preset: a ? a.name : "", thumb: thumb,
      summary: String(sess.summary || "").slice(0, 200),
      ran: trigs.filter((t) => t.fired).slice(0, 3).map((t) => ({ name: String(t.name || t.shortcut || "Trigger").slice(0, 40), fired: t.fired })),
    };
    return {
      id: id, version: BOOT.version, startedAt: sess.stats.start, endedAt: sess.stats.end,
      instructions: cfg.instructions, preset: a ? a.name : "", engine: engine, mode: meta.mode, interval: cfg.interval,
      summary: sess.summary || "", summaryAt: sess.summaryAt || null, state: sess.state || {},
      rows: statsRows(sess), triggers: trigs, frames: frames, debug: debug, images: images, meta: meta,
    };
  }

  function collapseAll() {
    document.querySelectorAll("details[open]").forEach((d) => { d.open = false; });
    $("trigForm").classList.add("hidden");
    if (!$("editor").classList.contains("hidden")) closeEditor(false);
  }

  async function finishSession(sess) {
    collapseAll();
    setStatus("Saving the session\u2026");
    let rec = null;
    try { rec = await buildSessionRecord(sess); } catch (e) { showError("Couldn\u2019t prepare the session for saving: " + e.message); }
    if (rec) {
      try { sessions = (await nativeCall("sessionSave", rec, 60000)) || sessions; rec.saved = true; }
      catch (e) { rec.saved = false; rec.saveError = e.message; }
    }
    setStatus("Session ended");
    renderTabs();
    showView("sessions");
    if (rec) showSessionDetail(rec); else showSessionList();
    setTimeout(showQueuedUpdate, 1500);
  }

  // ── Sessions view ──
  async function refreshSessions() {
    try { const list = await nativeCall("sessionList", {}, 20000); if (Array.isArray(list)) sessions = list; } catch (_) {}
    renderTabs();
  }
  function fmtDay(t) { return new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
  function fmtClock(t) { return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }

  function showSessionList() {
    $("sesDetail").classList.add("hidden");
    const box = $("sesList");
    box.classList.remove("hidden");
    box.textContent = "";
    box.appendChild(el("div", "hint", "Finished sessions are saved on this iPhone with their photos, summary and debug log. VisionX keeps the last " + KEEP_SESSIONS + " (Settings \u203A Capture)."));
    if (!sessions.length) { box.appendChild(el("div", "sesEmpty", "No saved sessions yet. They appear here when you end a session.")); return; }
    const wrap = el("div");
    wrap.style.marginTop = "12px";
    sessions.forEach((m) => {
      const b = el("button", "sesCard");
      b.type = "button";
      if (m.thumb) { const i = new Image(); i.src = m.thumb; i.alt = ""; b.appendChild(i); } else b.appendChild(el("span", "noimg"));
      const t = el("span", "t");
      t.append(
        el("b", null, fmtDay(m.startedAt) + ", " + fmtClock(m.startedAt)),
        el("span", "m", [fmtDur(m.endedAt - m.startedAt), m.photos + (m.photos === 1 ? " photo" : " photos"), m.fired ? m.fired + " trigger run" + (m.fired === 1 ? "" : "s") : "", m.preset].filter(Boolean).join(", ")),
        el("span", "s", m.summary || "No photo was analyzed."));
      b.appendChild(t);
      b.addEventListener("click", () => openSession(m.id));
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  }

  async function openSession(id) {
    try { const rec = await nativeCall("sessionGet", { id: id }, 30000); rec.saved = true; showSessionDetail(rec); }
    catch (e) { showError("Couldn\u2019t open the session: " + e.message); }
  }

  function showSessionDetail(rec) {
    $("sesList").classList.add("hidden");
    const box = $("sesDetail");
    box.classList.remove("hidden");
    box.textContent = "";
    const imgs = rec.images || {};
    const top = el("div", "repTop");
    const back = el("button", "chip", "\u2039 All sessions");
    back.type = "button";
    back.addEventListener("click", showSessionList);
    top.appendChild(back);
    box.appendChild(top);
    box.appendChild(el("h1", null, "Session, " + fmtDay(rec.startedAt)));
    box.appendChild(el("div", "hint", fmtClock(rec.startedAt) + " to " + fmtClock(rec.endedAt) + " (" + fmtDur(rec.endedAt - rec.startedAt) + ")" + (rec.preset ? ", preset \u201C" + rec.preset + "\u201D" : "")));
    if (rec.saved === false) box.appendChild(el("div", "warn", "This session couldn\u2019t be saved, so it won\u2019t be here after you close VisionX: " + (rec.saveError || "unknown error") + "."));

    box.appendChild(el("h2", null, rec.mode === "fresh" ? "Last moment" : "What happened"));
    const sc = el("div", "card");
    const bs = el("div", "bigsum md");
    bs.innerHTML = rec.summary ? md(rec.summary) : "<p>No photo was analyzed in this session.</p>";
    sc.appendChild(bs);
    if (rec.summaryAt) sc.appendChild(el("div", "meta num", (rec.mode === "fresh" ? "From photo #" : "Summary after photo #") + rec.summaryAt.idx + " at " + rec.summaryAt.time + ", " + (rec.mode === "fresh" ? "fresh for each photo" : "built up over the session") + "."));
    box.appendChild(sc);

    box.appendChild(el("h2", null, "Session stats"));
    const tc = el("div", "card");
    const tb = el("table", "rtable num");
    (rec.rows || []).forEach(([k, v]) => { const tr = el("tr"); tr.append(el("td", null, k), el("td", null, String(v))); tb.appendChild(tr); });
    tc.appendChild(tb);
    box.appendChild(tc);

    if ((rec.triggers || []).length) {
      box.appendChild(el("h2", null, "Triggers"));
      const c = el("div", "card");
      rec.triggers.forEach((t) => {
        const row = el("div", "rtrig");
        const body = el("div", "tbody");
        const last = t.error ? "Problem: " + t.error : t.decision || (t.reason ? "Last check: " + t.reason : "Not checked.");
        body.append(el("b", null, t.name), el("span", "tsub", t.condition), el("span", "tsub", (t.off ? "Off at the end. " : "") + "Ran \u201C" + t.shortcut + "\u201D " + t.fired + (t.fired === 1 ? " time" : " times") + " in " + t.checks + (t.checks === 1 ? " check. " : " checks. ") + last));
        row.append(body, el("span", "tcount", t.fired ? t.fired + "\u00D7" : ""));
        c.appendChild(row);
      });
      box.appendChild(c);
    }

    const frames = rec.frames || [];
    box.appendChild(el("h2", null, "Last " + (frames.length === 1 ? "photo" : frames.length + " photos")));
    if (!frames.length) box.appendChild(el("div", "hint", "No photos were taken."));
    else {
      const grid = el("div", "rphotos");
      frames.forEach((f) => {
        const fig = el("figure");
        fig.appendChild(photoView(Object.assign({}, f, { img: imgs[f.idx], pending: false })));
        fig.appendChild(el("figcaption", "num", "#" + f.idx + " at " + f.time));
        if (f.error) fig.appendChild(el("div", "note err", "Not analyzed: " + f.error));
        else { const nt = el("div", "note md"); nt.innerHTML = md(f.text || ""); fig.appendChild(nt); }
        grid.appendChild(fig);
      });
      box.appendChild(grid);
    }

    if (rec.state && Object.keys(rec.state).length) {
      const d = el("details", "tracked");
      d.appendChild(el("summary", null, "Tracked details"));
      d.appendChild(codeBlock(highlightJSON(JSON.stringify(rec.state, null, 2))));
      box.appendChild(d);
    }
    const ins = el("details", "tracked");
    ins.appendChild(el("summary", null, "Instructions used"));
    ins.appendChild(codeBlock(escHTML(rec.instructions || "")));
    ins.appendChild(el("div", "hint", "Analyzed with " + rec.engine + ", a photo every " + rec.interval + " s."));
    box.appendChild(ins);

    const entries = (rec.debug || []).map((e) => Object.assign({}, e, { frame: { img: imgs[e.idx], pending: !!e.pending, noPhoto: !!e.noPhoto } }));
    box.appendChild(el("h2", null, "Debug (" + entries.length + (entries.length === 1 ? " photo)" : " photos)")));
    const dbgBar = el("div", "presetBar");
    const copy = el("button", "chip", "Copy as JSON");
    copy.type = "button";
    const copyHint = el("div", "hint");
    copy.addEventListener("click", async () => {
      try { await nativeCall("copy", { text: debugExport(entries) }, 10000); copyHint.textContent = "Copied " + entries.length + " entries as JSON (without the photos)."; }
      catch (e) { copyHint.textContent = "Couldn\u2019t copy: " + e.message; }
    });
    dbgBar.appendChild(copy);
    box.append(dbgBar, copyHint);
    const list = el("div", "dbgList");
    box.appendChild(list);
    renderDebugList(list, entries, "No debug entries were kept.");

    if (rec.saved) {
      const del = el("button", "chip danger", "Delete this session");
      del.type = "button";
      del.style.marginTop = "22px";
      del.addEventListener("click", async () => {
        if (!del.dataset.armed) {
          del.dataset.armed = "1"; del.classList.add("armed"); del.textContent = "Tap again to delete";
          setTimeout(() => { delete del.dataset.armed; del.classList.remove("armed"); del.textContent = "Delete this session"; }, 3000);
          return;
        }
        try { sessions = (await nativeCall("sessionDelete", { id: rec.id }, 20000)) || []; renderTabs(); showSessionList(); }
        catch (e) { showError("Couldn\u2019t delete the session: " + e.message); }
      });
      box.appendChild(del);
    }
    window.scrollTo(0, 0);
  }

  // ── in-app update sheet ──
  // Scriptable checks GitHub and calls window.__showUpdate(info); the user's choice goes
  // back through the bridge ("updateNow" / "updateLater"). Release text comes from the
  // internet, so it is always inserted as escaped text, never as raw HTML.
  window.__showUpdate = function (u) {
    if (!u || $("upd")) return;
    if (S.running) { queuedUpdate = u; return; } // don't interrupt a capture; offer it after
    showUpdateSheet(u);
  };
  function showQueuedUpdate() {
    if (!queuedUpdate || S.running) return;
    const u = queuedUpdate;
    queuedUpdate = null;
    showUpdateSheet(u);
  }
  function showUpdateSheet(u) {
    const ov = document.createElement("div");
    ov.id = "upd";
    const cards = (u.highlights || []).map(function (h) {
      return '<div class="updi"><span class="updic">' + escHTML(h.icon || "\u2728") + "</span><div><b>" +
        escHTML(h.title) + "</b><span>" + escHTML(h.text || "") + "</span></div></div>";
    }).join("");
    const more = u.skipped > 1 ? " (and " + (u.skipped - 1) + " more update" + (u.skipped > 2 ? "s" : "") + ")" : "";
    ov.innerHTML = '<div class="updp" role="dialog" aria-modal="true" aria-label="Update available" tabindex="-1">' +
      '<div class="updtag">New version ' + escHTML(u.latest) + "</div>" +
      '<h2 class="updt">' + escHTML(u.title || "An update is ready") + "</h2>" +
      '<div class="upds">You have ' + escHTML(u.current) + more + ". Here\u2019s what you get:</div>" +
      '<div class="updl">' + cards + "</div>" +
      '<div class="updmsg" aria-live="polite"></div>' +
      '<button type="button" class="btn updgo">Update now</button>' +
      '<button type="button" class="updlater">Later, remind me in 2 days</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) updLater(); }); // outside = Later
    ov.querySelector(".updlater").addEventListener("click", updLater);
    ov.querySelector(".updgo").addEventListener("click", function (e) { updNow(e.currentTarget); });
    ov.querySelector(".updp").focus();
  }
  function updLater() {
    const ov = $("upd");
    if (!ov) return;
    ov.remove();
    nativeCall("updateLater", null, 10000).catch(function () {});
  }
  function updNow(btn) {
    const ov = $("upd");
    if (btn.dataset.act === "close") { ov.remove(); return; }
    const msg = ov.querySelector(".updmsg"), later = ov.querySelector(".updlater");
    btn.disabled = true;
    btn.textContent = "Updating\u2026";
    later.hidden = true;
    msg.textContent = "";
    nativeCall("updateNow", null, 90000).then(function (version) {
      ov.querySelector(".updtag").textContent = "Updated to " + version;
      msg.innerHTML = "<b>\u2713 Done.</b> Close VisionX and open it again to start using the new version.";
      btn.disabled = false;
      btn.textContent = "Got it";
      btn.dataset.act = "close";
    }).catch(function (e) {
      msg.textContent = (e && e.message) || "Update failed";
      btn.disabled = false;
      btn.textContent = "Try again";
      later.hidden = false;
    });
  }

  // ── instructions editor and AI refine ──
  function openEditor(focusRefine) {
    $("edText").value = $("instructions").value;
    const a = activePreset();
    $("edSub").textContent = a ? "Preset: " + a.name : "";
    $("edSuggest").classList.add("hidden");
    $("edStatus").textContent = "";
    $("edUndo").classList.add("hidden");
    beforeRefine = null;
    updateEditorCount();
    $("editor").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    (focusRefine ? $("edAsk") : $("edText")).focus();
  }
  function closeEditor(apply) {
    if (apply) {
      $("instructions").value = $("edText").value.trim();
      $("instructions").dispatchEvent(new Event("input"));
    }
    $("editor").classList.add("hidden");
    document.body.style.overflow = "";
  }
  function updateEditorCount() {
    const t = $("edText").value.trim();
    const words = t ? t.split(/\s+/).length : 0;
    $("edCount").textContent = words + (words === 1 ? " word" : " words") + ", " + t.length + " characters";
  }

  function refinePrompt(current, ask, visual) {
    return [
      "You improve instructions for a vision model. The model looks at photos from a live phone camera, one photo every few seconds, and answers by following these instructions.",
      isMoment()
        ? "Each photo is judged on its own, so the instructions should say what to report about a single moment."
        : "Each photo is merged into one running summary for the whole session, so the instructions should say what to track and count over time.",
      "",
      "Rewrite the instructions so they are clear, specific and unambiguous: what to look for, what to count or track, what to ignore, and how to phrase the answer (concise).",
      "Keep the user's intent, any names, numbers or plates they gave, and the language they wrote in. Don't invent requirements the user didn't imply.",
      visual
        ? "Don't add JSON or reply-format rules; the app adds those. Do add a short final paragraph on how to present the answer, naming the exact visual(s) for this task and what goes in each. Use only these visuals, which the app draws as graphics:\n" + visualGuide()
        : "Don't add output-format or JSON rules; the app adds those.",
      ask ? "\nREQUESTED CHANGE:\n" + ask : "",
      "",
      "CURRENT INSTRUCTIONS:",
      current,
      "",
      'Respond with JSON only: {"instructions": "the improved instructions", "changes": "one short sentence on what you changed"}',
    ].join("\n");
  }

  function parseRefine(text) {
    let src = String(text || "").trim();
    const a = src.indexOf("{"), b = src.lastIndexOf("}");
    if (a !== -1 && b > a) {
      try {
        const j = JSON.parse(src.slice(a, b + 1));
        if (typeof j.instructions === "string" && j.instructions.trim()) {
          return { text: j.instructions.trim(), why: String(j.changes || "") };
        }
      } catch (_) {}
    }
    return { text: src, why: "" };
  }

  const VISUAL_ASK = "Make the results visually compelling. The summary should open with one short headline sentence, then show the numbers as visuals that fit the data: a donut for shares of a whole, bars for counts per category, a line for change over time, stat tiles for the 2 to 4 numbers that matter most, a gauge for a level or progress, and a table only for per-item details. Keep labels short; an emoji per category is welcome.";
  async function refineInstructions(ask, visual) {
    const current = $("edText").value.trim();
    if (!current) { $("edStatus").textContent = "Write some instructions first."; $("edText").focus(); return; }
    if (refining) return;
    refining = true;
    const buttons = document.querySelectorAll("#editor .edRefine button, #edUse, #edKeep, #iVisual");
    buttons.forEach((b) => { b.disabled = true; });
    $("edSuggest").classList.add("hidden");
    $("edStatus").textContent = visual ? "Adding charts and visuals…" : "Refining…";
    try {
      const prompt = refinePrompt(current, ask, visual);
      let reply, via;
      if (cloud.hasKey) {
        const r = await aiRequest(() => ({ feature: "refine", system: "You improve instructions for a photo-analysis app. Follow the requested reply format exactly.", text: prompt, maxTokens: 2000 }));
        reply = r.text;
        via = "✦ AI by " + r.by + ", " + r.model + (r.usage.total_tokens ? ", " + fmtNum(r.usage.total_tokens) + " tokens" : "");
      } else if (isApple()) {
        reply = await withShortcutLock(() => nativeCall("appleText", { shortcut: cfg.checkShortcut, text: prompt }, 180000));
        via = "✦ AI by Apple Intelligence";
      } else {
        throw new Error("add a Claude or OpenAI key in Settings › AI settings, or switch to Apple Intelligence");
      }
      const out = parseRefine(reply);
      if (!out.text) throw new Error("the model returned nothing");
      if (out.text === current) {
        $("edStatus").textContent = "No changes suggested. Your instructions already look good.";
        return;
      }
      $("edStatus").textContent = "";
      $("edWhy").textContent = (out.why ? out.why + " " : "") + "(" + via + ")";
      $("edProposal").textContent = out.text;
      $("edSuggest").classList.remove("hidden");
      $("edSuggest").scrollIntoView({ block: "nearest" });
    } catch (e) {
      $("edStatus").textContent = "Couldn't refine: " + e.message +
        (!cloud.hasKey && isApple() ? ". Refining with Apple Intelligence uses the checker shortcut (see Triggers)." : ".");
    } finally {
      refining = false;
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  function wireEditor() {
    $("iExpand").addEventListener("click", () => openEditor(false));
    $("iRefine").addEventListener("click", () => openEditor(true));
    const visualRefine = () => { const extra = $("edAsk").value.trim(); refineInstructions(VISUAL_ASK + (extra ? " Also: " + extra : ""), true); };
    $("iVisual").addEventListener("click", () => { openEditor(true); visualRefine(); });
    $("edVisual").addEventListener("click", visualRefine);
    $("edCancel").addEventListener("click", () => closeEditor(false));
    $("edDone").addEventListener("click", () => closeEditor(true));
    $("edText").addEventListener("input", updateEditorCount);
    $("edGo").addEventListener("click", () => refineInstructions($("edAsk").value.trim()));
    $("edAsk").addEventListener("keydown", (e) => { if (e.key === "Enter") $("edGo").click(); });
    document.querySelectorAll("#editor [data-ask]").forEach((b) => {
      b.addEventListener("click", () => {
        const extra = $("edAsk").value.trim();
        refineInstructions(b.dataset.ask + (extra ? " Also: " + extra : ""));
      });
    });
    $("edUse").addEventListener("click", () => {
      beforeRefine = $("edText").value;
      $("edText").value = $("edProposal").textContent;
      $("edSuggest").classList.add("hidden");
      $("edUndo").classList.remove("hidden");
      $("edStatus").textContent = "Applied. Tap Done to keep it.";
      updateEditorCount();
    });
    $("edKeep").addEventListener("click", () => { $("edSuggest").classList.add("hidden"); $("edStatus").textContent = ""; });
    $("edUndo").addEventListener("click", () => {
      if (beforeRefine == null) return;
      $("edText").value = beforeRefine;
      beforeRefine = null;
      $("edUndo").classList.add("hidden");
      $("edStatus").textContent = "Restored your previous text.";
      updateEditorCount();
    });
  }

  // ── triggers ──
  // Shortcuts can't run two at a time; every shortcut run waits its turn here.
  function withShortcutLock(fn) {
    const run = shortcutChain.then(fn, fn);
    shortcutChain = run.catch(() => {});
    return run;
  }

  function triggerPrompt(sess, st) {
    const t = st.t;
    const started = new Date(sess.stats.start);
    const since = (t.mode === "new" && st.lastRun) ? [
      "",
      "THIS TRIGGER ALREADY RAN at " + st.lastRun.time + " (after photo #" + st.lastRun.idx + "), because: " + st.lastRun.reason,
      "The summary at that time was:",
      st.lastRun.summary,
      "",
      "Answer met = true only if the condition has happened AGAIN since then: the summary must show a new occurrence beyond what had already happened at that time. If nothing new happened, met = false.",
    ] : [];
    return [
      "You decide whether a condition is met, based on the running summary of a live camera session.",
      "",
      "CONDITION:",
      t.condition,
      "",
      "What the camera session is observing: " + cfg.instructions,
      "Session started at " + started.toLocaleTimeString() + "; it is now " + new Date().toLocaleTimeString() +
        " (" + fmtDur(Date.now() - sess.stats.start) + " elapsed).",
      "",
      "SUMMARY SO FAR:",
      sess.summary,
      "",
      "TRACKED DETAILS (JSON):",
      JSON.stringify(sess.state),
    ].concat(since, [
      "",
      "Judge only from this information. If it isn't enough to tell, the condition is not met.",
      'Respond with JSON only: {"met": true or false, "reason": "one short sentence"}',
    ]).join("\n");
  }

  function parseVerdict(text) {
    let src = String(text || "").trim();
    const a = src.indexOf("{"), b = src.lastIndexOf("}");
    if (a !== -1 && b > a) src = src.slice(a, b + 1);
    try {
      const j = JSON.parse(src);
      const met = j.met === true || String(j.met).toLowerCase() === "true";
      return { met: met, reason: String(j.reason || "") };
    } catch (_) {
      return { met: /^\s*(yes|true)\b/i.test(String(text || "")), reason: String(text || "").slice(0, 160) };
    }
  }

  function initTriggerState(sess) {
    sess.trig = {};
    sess.trigOrder = [];
    triggers.forEach((t) => {
      const copy = Object.assign({}, t);
      sess.trig[t.id] = {
        t: copy, off: t.enabled === false, busy: false, armed: true, done: false, fired: 0, checks: 0,
        nextAt: Date.now() + copy.every * 1000, status: "idle", reason: "", error: "", firedAt: "", flashUntil: 0,
      };
      sess.trigOrder.push(t.id);
    });
    trigSig = "";
  }

  // Turn a trigger on or off. Works any time, including during a session.
  function setTriggerEnabled(id, on) {
    const t = triggers.find((x) => x.id === id);
    if (t) t.enabled = on;
    const st = S.trig[id];
    if (st) {
      st.off = !on;
      if (on && S.running) {
        st.armed = true;
        st.status = "idle";
        st.nextAt = Date.now() + st.t.every * 1000;
      }
    }
    persist();
    renderTriggerList();
    renderTriggerStatus();
  }

  function makeSwitch(checked, label, onChange) {
    const wrap = el("label", "switch");
    const input = el("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = checked;
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => onChange(input.checked));
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function runDueTriggers(sess) {
    if (!sess.running || isMoment()) return;
    const now = Date.now();
    sess.trigOrder.forEach((id) => {
      const st = sess.trig[id];
      if (st.off || st.busy || st.done || st.t.when === "photo" || now < st.nextAt) return;
      if (!sess.summary) {
        st.status = "waiting";
        st.nextAt = now + Math.min(st.t.every, 5) * 1000;
        return;
      }
      runCheck(sess, st);
    });
  }

  async function runCheck(sess, st) {
    st.busy = true;
    st.status = "checking";
    renderTriggerStatus();
    const prompt = triggerPrompt(sess, st);
    const log = { trigger: st.t.name, time: new Date().toLocaleTimeString(), prompt: prompt, raw: "", verdict: null, error: "" };
    const host = sess.debug[0];
    if (host) { host.checks.push(log); if (host.checks.length > 10) host.checks.shift(); }
    try {
      let verdict;
      if (isApple()) {
        const text = await withShortcutLock(() => nativeCall("appleText", { shortcut: cfg.checkShortcut, text: prompt }, 180000));
        log.raw = text || "";
        verdict = parseVerdict(text);
      } else {
        const r = await aiRequest(() => ({ feature: "triggers", system: "You check conditions for a live camera session. Follow the requested reply format exactly.", text: prompt, maxTokens: 1500 }));
        sess.stats.prompt += r.usage.prompt_tokens || 0;
        sess.stats.completion += r.usage.completion_tokens || 0;
        sess.stats.total += r.usage.total_tokens || 0;
        log.raw = r.text;
        verdict = parseVerdict(r.text);
      }
      log.verdict = verdict;
      st.checkRaw = log.raw;
      if (!sess.running) { log.decision = "The session ended before the shortcut could run."; return; }
      log.decision = await applyVerdict(sess, st, verdict);
      if (/ ran at /.test(log.decision || "")) log.sent = st.lastSent;
    } catch (e) {
      log.error = e.message;
      if (e.decision) log.decision = e.decision;
      if (e.cancelled) return;
      st.status = "error";
      st.error = e.message;
    } finally {
      st.busy = false;
      st.nextAt = Date.now() + st.t.every * 1000;
      if (sess === S) { renderTriggerStatus(); renderDebug(); }
    }
  }

  // Decide whether this verdict should run the shortcut, and run it.
  // Decides whether this verdict runs the shortcut, runs it, and returns why or why not.
  async function applyVerdict(sess, st, verdict) {
    sess.stats.checks++;
    st.checks++;
    st.lastAt = Date.now();
    st.reason = verdict.reason;
    st.error = "";
    let mode = st.t.mode || "rise";
    if (mode === "new" && isMoment()) mode = "rise"; // each photo stands alone, so a new occurrence = becoming true
    let fire = false, decision;
    if (!verdict.met) { st.armed = true; decision = "Not met, so the shortcut didn't run."; }
    else if (mode === "every" || mode === "new") { fire = true; }
    else if (mode === "once") {
      fire = !st.fired;
      if (!fire) decision = "Met, but the shortcut didn't run: it is set to run only the first time, and it already ran.";
    } else {
      fire = st.armed;
      if (!fire) decision = "Met, but the shortcut didn't run: it is set to run each time the condition becomes true, it already ran, and the condition hasn't been false since." +
        (isMoment() ? "" : " With a summary that builds up, choose \u201CEach new occurrence\u201D for repeated events.");
    }
    st.decision = decision || "";
    if (!fire) {
      st.status = verdict.met ? "met" : "notmet";
      return decision;
    }
    st.status = "firing";
    renderTriggerStatus();
    const text = shortcutInput(sess, st);
    st.lastSent = text;
    try {
      await withShortcutLock(() => nativeCall("runShortcut", { shortcut: st.t.shortcut, text: text }, 600000));
    } catch (e) {
      e.decision = "Met, and the shortcut was started, but it failed: " + e.message;
      throw e;
    }
    st.fired++;
    sess.stats.fired++;
    st.armed = false;
    st.firedAt = new Date().toLocaleTimeString();
    st.firedTs = Date.now();
    st.lastRun = { time: st.firedAt, idx: (sess.summaryAt && sess.summaryAt.idx) || sess.seq, reason: verdict.reason, summary: sess.summary };
    st.flashUntil = Date.now() + 2500;
    st.status = "fired";
    if (mode === "once") st.done = true;
    st.decision = "Met, so \u201C" + st.t.shortcut + "\u201D ran at " + st.firedAt + ".";
    return st.decision;
  }

  // What the trigger's shortcut receives as Shortcut Input (text; photos aren't sent).
  function triggerContext(sess, st) {
    const e = (sess.debug || []).find((x) => !(x.frame && x.frame.pending) && (x.raw || x.parsed)) || null;
    const f = sess.frames.find((x) => !x.pending && (x.text || x.error)) || null;
    const s = sess.stats, now = new Date();
    return {
      summary: sess.summary || "",
      frame: f ? (f.text || "") : "",
      raw: e ? (e.raw || "") : "",
      parsed: e && e.parsed ? JSON.stringify(e.parsed, null, 2) : "",
      state: JSON.stringify(sess.state || {}, null, 2),
      reason: st.reason || "",
      condition: st.t.condition,
      check: st.checkRaw || "",
      name: st.t.name,
      shortcut: st.t.shortcut,
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      photo: f ? String(f.idx) : "",
      phototime: f ? f.time : "",
      instructions: cfg.instructions,
      photos: String(s.photos),
      requests: String(s.requests),
      tokens: String(s.total),
      elapsed: fmtDur(Date.now() - s.start - pausedMs(sess)),
      engine: isApple() ? "Apple Intelligence" : (sess.by || cloud.name) + " " + cloud.model,
      _parsed: e && e.parsed ? e.parsed : null,
      _photo: f,
    };
  }

  function everything(c) {
    return {
      trigger: { name: c.name, condition: c.condition, shortcut: c.shortcut, reason: c.reason, check_reply: c.check || undefined, date: c.date, time: c.time },
      photo: { number: c._photo ? c._photo.idx : null, time: c.phototime || null, summary: c.frame },
      reply: { as_received: c.raw, as_understood: c._parsed },
      session: {
        summary: c.summary, tracked_details: JSON.parse(c.state), instructions: c.instructions,
        summary_mode: isMoment() ? "fresh each photo" : "built up over the session", analyzed_with: c.engine,
        elapsed: c.elapsed, photos: +c.photos, requests: +c.requests, tokens: +c.tokens,
      },
    };
  }

  function shortcutInput(sess, st) {
    const c = triggerContext(sess, st);
    const kind = SEND_KINDS.indexOf(st.t.send) !== -1 ? st.t.send : "summary";
    if (kind === "frame") return c.frame || c.summary;
    if (kind === "raw") return c.raw;
    if (kind === "parsed") return c.parsed;
    if (kind === "state") return c.state;
    if (kind === "all") return JSON.stringify(everything(c), null, 2);
    if (kind === "custom") {
      return String(st.t.message || "").replace(/\{([a-z]+)\}/gi, (m, k) => {
        k = k.toLowerCase();
        if (k === "all") return JSON.stringify(everything(c), null, 2);
        return Object.prototype.hasOwnProperty.call(c, k) && k.charAt(0) !== "_" ? c[k] : m;
      });
    }
    return c.summary;
  }


  // Fresh mode: the photo's own answer says which conditions are met right now.
  function handleMomentVerdicts(sess, verdicts) {
    const jobs = [];
    sess.trigOrder.forEach((id) => {
      const st = sess.trig[id];
      if (st.off || st.busy || st.done) return;
      const v = verdicts && verdicts[id];
      if (!v) {
        // A trigger switched on after this photo was sent simply waits for the next one.
        if (st.status !== "idle") { st.status = "error"; st.error = "the model didn't answer this condition for the last photo"; }
        return;
      }
      st.busy = true;
      st.checkRaw = "";   // in fresh mode the photo's own reply answered the condition
      const log = { trigger: st.t.name, time: new Date().toLocaleTimeString(), prompt: "(judged inside this photo's request)", raw: "", verdict: v, error: "", decision: "" };
      const host = sess.debug[0];
      if (host) { host.checks.push(log); if (host.checks.length > 10) host.checks.shift(); }
      jobs.push(applyVerdict(sess, st, v)
        .then((d) => { log.decision = d || ""; if (/ ran at /.test(log.decision)) log.sent = st.lastSent; })
        .catch((e) => { log.error = e.message; log.decision = e.decision || ""; if (!e.cancelled) { st.status = "error"; st.error = e.message; } })
        .finally(() => { st.busy = false; if (sess === S) { renderTriggerStatus(); renderDebug(); } }));
    });
    if (sess === S) renderTriggerStatus();
    return Promise.all(jobs);
  }

  // Build-up mode: triggers set to "after each photo" are checked now, against the new summary.
  function runPhotoTriggers(sess) {
    const jobs = [];
    sess.trigOrder.forEach((id) => {
      const st = sess.trig[id];
      if (st.off || st.busy || st.done || st.t.when !== "photo" || !sess.summary) return;
      jobs.push(runCheck(sess, st));
    });
    return Promise.all(jobs);
  }

  // Runs after a photo is analyzed; the capture loop waits for it before the next photo.
  async function afterPhoto(sess, frame, verdicts) {
    if (!sess.running) return;
    const work = isMoment() ? handleMomentVerdicts(sess, verdicts) : runPhotoTriggers(sess);
    const waiting = sess.trigOrder.some((id) => sess.trig[id].busy && (isMoment() || sess.trig[id].t.when === "photo"));
    if (!waiting) return work;
    sess.triggerWaitIdx = frame.idx;
    tickClock();
    try { await work; } finally { sess.triggerWaitIdx = 0; }
  }

  function normalizeVerdicts(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    const put = (id, v) => {
      if (!id || v == null) return;
      const met = typeof v === "object" ? (v.met === true || String(v.met).toLowerCase() === "true") : (v === true || String(v).toLowerCase() === "true");
      out[id] = { met: met, reason: typeof v === "object" ? String(v.reason || "") : "" };
    };
    if (Array.isArray(raw)) raw.forEach((v) => put(v && v.id, v));
    else Object.keys(raw).forEach((k) => put(k, raw[k]));
    return out;
  }


  function renderTriggerList() {
    const box = $("trigList");
    box.textContent = "";
    if (!triggers.length) box.appendChild(el("div", "hint", "No triggers yet. Example: \u201CSomeone is holding a phone\u201D runs a shortcut that sends you a notification."));
    triggers.forEach((t) => {
      const row = el("div", "tItem" + (t.enabled === false ? " off" : ""));
      const sw = makeSwitch(t.enabled !== false, "Trigger " + t.name + " on", (on) => setTriggerEnabled(t.id, on));
      const txt = el("div", "tText");
      const modeText = { rise: "each time it becomes true", once: "only the first time", every: "every check while true", new: "for each new occurrence" }[t.mode || "rise"];
      txt.append(el("b", null, t.name), el("span", "tsub", t.condition), el("span", "tsub", triggerWhenText(t) + "; runs \u201C" + t.shortcut + "\u201D " + modeText + ", sending " + (SEND_LABELS[t.send] || SEND_LABELS.summary) + "."));
      const edit = el("button", "chip", "Edit");
      edit.type = "button";
      edit.disabled = S.running;
      edit.addEventListener("click", () => openTriggerForm(t.id));
      row.append(sw.wrap, txt, edit);
      box.appendChild(row);
    });
    const on = triggers.filter((t) => t.enabled !== false).length;
    $("trigCount").textContent = triggers.length ? on + " of " + triggers.length + " on" : "";
  }

  // Interval only applies to "every few seconds" checks in build-up mode.
  function updateTrigFormUI() {
    const moment = isMoment();
    const perPhoto = moment || $("tWhen").value === "photo";
    $("tWhenBox").classList.toggle("hidden", moment);
    $("tEveryBox").classList.toggle("hidden", perPhoto);
    $("tGrid").style.gridTemplateColumns = perPhoto ? "1fr" : "";
    const modeHint = {
      rise: "Runs once, then waits until the condition is false again. With a summary that builds up, a condition like \u201Ca thumbs-up was seen\u201D stays true, so it runs only once.",
      new: "Runs again whenever the condition happens anew, for example a second thumbs-up. The model is told what had already happened the last time the shortcut ran.",
      once: "Runs at most once per session.",
      every: "Runs on every check where the condition is met.",
    }[$("tMode").value] || "";
    $("tModeHint").textContent = modeHint;
    $("tWhenHint").textContent = $("tWhen").value === "photo"
      ? "Checked right after every photo, against the updated summary. The next photo waits until this check and its shortcut have finished."
      : "Checked on its own timer, independent of photos.";
  }

  function triggerWhenText(t) {
    if (isMoment()) return "Checked with every photo (the next photo waits)";
    if (t.when === "photo") return "Checked after each photo (the next photo waits)";
    return "Checks every " + t.every + " s";
  }

  // ── the user's shortcuts, read once through a helper shortcut ──
  // Scriptable can't list shortcuts itself, so VisionX runs one that outputs every name, one per line.
  const LIST_SHORTCUT = "VisionX Shortcut List";
  function shortcutNames() { return Array.isArray(cfg.shortcutNames) ? cfg.shortcutNames : []; }
  function fillShortcutPickers() {
    const names = shortcutNames();
    const dl = $("scNames");
    dl.textContent = "";
    names.forEach((n) => { const o = el("option"); o.value = n; dl.appendChild(o); });
    const sel = $("tPick"), cur = $("tShortcut").value.trim();
    sel.textContent = "";
    const head = el("option", null, names.indexOf(cur) !== -1 ? "Change shortcut\u2026" : "Choose from your " + names.length + " shortcuts\u2026");
    head.value = "";
    sel.appendChild(head);
    names.forEach((n) => { const o = el("option", null, n); o.value = n; sel.appendChild(o); });
    sel.value = names.indexOf(cur) !== -1 ? cur : "";
    sel.classList.toggle("hidden", !names.length);
    $("tLoadSc").textContent = names.length ? "Reload" : "Load my shortcuts";
  }
  function parseShortcutNames(text) {
    const seen = {};
    return String(text || "").split(/\r?\n/).map((n) => n.trim())
      .filter((n) => n && n !== LIST_SHORTCUT && !seen[n] && (seen[n] = true))
      .sort((a, b) => a.localeCompare(b));
  }
  async function loadShortcutNames() {
    const btn = $("tLoadSc");
    btn.disabled = true;
    $("tScHint").textContent = "Opening Shortcuts to read your list\u2026";
    try {
      const r = await withShortcutLock(() => nativeCall("runShortcut", { shortcut: LIST_SHORTCUT, text: "" }, 120000));
      const names = parseShortcutNames(r && r.text);
      if (!names.length) throw new Error("the list came back empty. Check that \u201C" + LIST_SHORTCUT + "\u201D ends with Stop and Output");
      cfg.shortcutNames = names;
      persist();
      fillShortcutPickers();
      $("tScHow").open = false;
      $("tScHint").textContent = names.length + " shortcuts loaded. Choose one above, or start typing to see matches.";
    } catch (e) {
      $("tScHow").open = true;
      $("tScHint").textContent = "Couldn\u2019t load your shortcuts: " + e.message + ". Set up the list shortcut once (steps below), then try again.";
    } finally {
      btn.disabled = !!S.running;
    }
  }

  // A copy of the trigger as it is on screen, saved right after the original, then opened for editing.
  function copyName(name) {
    const base = String(name || "Trigger").replace(/ copy( \d+)?$/, "");
    for (let k = 1; ; k++) {
      const suffix = k === 1 ? " copy" : " copy " + k;
      const n = base.slice(0, 40 - suffix.length) + suffix;
      if (!triggers.some((t) => t.name === n)) return n;
    }
  }
  function duplicateTrigger() {
    const src = triggers.find((x) => x.id === editingTrigger);
    if (!src) return;
    const pick = (id, fallback) => $(id).value.trim() || fallback;
    const copy = Object.assign({}, src, {
      id: "t-" + Date.now().toString(36),
      condition: pick("tCond", src.condition),
      shortcut: pick("tShortcut", src.shortcut),
      every: Math.max(5, parseInt($("tEvery").value, 10) || src.every || 30),
      when: $("tWhen").value, mode: $("tMode").value, send: $("tSend").value,
      message: $("tMsg").value.trim(),
    });
    copy.name = copyName(pick("tName", src.name));
    triggers.splice(triggers.indexOf(src) + 1, 0, copy);
    persist();
    renderTriggerList();
    openTriggerForm(copy.id);
    $("tHint").textContent = "Saved a copy as \u201C" + copy.name + "\u201D. The original is unchanged. Change what you need here, for example the shortcut, and tap Save trigger.";
    $("trigForm").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function openTriggerForm(id) {
    const t = triggers.find((x) => x.id === id) || { name: "", condition: "", every: 30, when: "interval", mode: "rise", shortcut: "", send: "summary", message: "" };
    editingTrigger = id || null;
    $("tName").value = t.name;
    $("tCond").value = t.condition;
    $("tEvery").value = String(t.every);
    $("tWhen").value = t.when === "photo" ? "photo" : "interval";
    updateTrigFormUI();
    $("tMode").value = t.mode || "rise";
    $("tShortcut").value = t.shortcut;
    $("tSend").value = SEND_KINDS.indexOf(t.send) !== -1 ? t.send : "summary";
    $("tSendHint").textContent = SEND_HINTS[$("tSend").value];
    $("tMsg").value = t.message || "";
    $("tMsgBox").classList.toggle("hidden", $("tSend").value !== "custom");
    $("tDelete").classList.toggle("hidden", !id);
    $("tDup").classList.toggle("hidden", !id);
    $("tHint").textContent = "";
    $("tScHint").textContent = shortcutNames().length ? "" : "Tap Load my shortcuts to pick from a list instead of typing.";
    fillShortcutPickers();
    $("trigForm").classList.remove("hidden");
    $("tName").focus();
  }

  function wireTriggers() {
    $("tAdd").addEventListener("click", () => openTriggerForm(null));
    $("tLoadSc").addEventListener("click", loadShortcutNames);
    $("tPick").addEventListener("change", () => { if ($("tPick").value) { $("tShortcut").value = $("tPick").value; fillShortcutPickers(); } });
    $("tShortcut").addEventListener("input", () => { const n = $("tShortcut").value.trim(); $("tPick").value = shortcutNames().indexOf(n) !== -1 ? n : ""; });
    $("tDup").addEventListener("click", duplicateTrigger);
    fillShortcutPickers();
    $("tCancel").addEventListener("click", () => $("trigForm").classList.add("hidden"));
    $("tWhen").addEventListener("change", updateTrigFormUI);
    $("tMode").addEventListener("change", updateTrigFormUI);
    $("tSend").addEventListener("change", () => {
      const custom = $("tSend").value === "custom";
      $("tSendHint").textContent = SEND_HINTS[$("tSend").value] || "";
      $("tMsgBox").classList.toggle("hidden", !custom);
      if (custom) $("tMsg").focus();
    });
    $("tSave").addEventListener("click", () => {
      const name = $("tName").value.trim();
      const condition = $("tCond").value.trim();
      const shortcut = $("tShortcut").value.trim();
      const every = Math.max(5, parseInt($("tEvery").value, 10) || 30);
      if (!name) { $("tHint").textContent = "Give the trigger a name."; return $("tName").focus(); }
      if (!condition) { $("tHint").textContent = "Describe the condition to check."; return $("tCond").focus(); }
      if (!shortcut) { $("tHint").textContent = "Enter the exact name of the shortcut to run."; return $("tShortcut").focus(); }
      const send = $("tSend").value;
      const message = $("tMsg").value.trim();
      if (send === "custom" && !message) { $("tHint").textContent = "Write the message to send, or choose to send the capture summary."; return $("tMsg").focus(); }
      const data = { name: name, condition: condition, shortcut: shortcut, every: every, when: $("tWhen").value, mode: $("tMode").value, send: send, message: message };
      const existing = triggers.find((x) => x.id === editingTrigger);
      if (existing) Object.assign(existing, data);
      else triggers.push(Object.assign({ id: "t-" + Date.now().toString(36), enabled: true }, data));
      persist();
      $("trigForm").classList.add("hidden");
      renderTriggerList();
    });
    $("tDelete").addEventListener("click", () => {
      const b = $("tDelete");
      if (!b.dataset.armed) {
        b.dataset.armed = "1";
        b.classList.add("armed");
        b.textContent = "Tap again to delete";
        setTimeout(() => { delete b.dataset.armed; b.classList.remove("armed"); b.textContent = "Delete trigger"; }, 3000);
        return;
      }
      triggers = triggers.filter((x) => x.id !== editingTrigger);
      delete b.dataset.armed;
      b.classList.remove("armed");
      b.textContent = "Delete trigger";
      persist();
      $("trigForm").classList.add("hidden");
      renderTriggerList();
    });
  }


  async function analyze(sess, frame, dbg) {
    const r = await aiRequest(() => {
      const body = buildBody(sess, frame);
      if (dbg) dbg.request = requestForDebug(body);
      return body;
    });
    const result = parseResult(r.text);
    if (dbg) { dbg.raw = r.text; dbg.attempts = r.attempts; dbg.dropped = r.dropped; }
    return { result: result, usage: r.usage };
  }

  // The request as sent, minus the photo bytes (shown separately).
  function requestForDebug(body) {
    return {
      instructions: body.system || "",
      text: body.text || "",
      settings: {
        provider: cloud.name,
        model: cloud.model,
        image: body.image ? { size: imageInfo(body.image), detail: cloud.name === "OpenAI" ? body.detail : "n/a (OpenAI only)" } : null,
        max_tokens: body.maxTokens,
      },
    };
  }

  // One request through the Scriptable side's aiCall (Claude or OpenAI, as set in AI settings).
  async function aiRequest(makeBody) {
    const body = makeBody();
    let r;
    try {
      r = await nativeCall("ai", body, REQUEST_TIMEOUT_MS);
    } catch (e) {
      e.attempts = 1;
      e.dropped = [];
      if (e.bridgeDown) e.message = "the connection to Scriptable was lost. Close VisionX and open it again";
      throw e;
    }
    if (!r || !String(r.text || "").trim()) throw new Error("the model returned no text");
    return Object.assign(r, { body: body, attempts: 1, dropped: [] });
  }

  // Accepts strict JSON, JSON with common slips (code fences, line breaks,
  // trailing commas, curly quotes), or the labelled format used for Apple.
  function parseResult(text) {
    const raw = String(text || "").trim();
    if (!raw) return { frame: "(empty response)", state: null, summary: "", triggers: null };
    // Labels that come before any "{" mean the labelled format; read that first.
    const labelAt = raw.search(/^[\s*#>-]*(FRAME|SUMMARY)\s*\**\s*:/im);
    const braceAt = raw.indexOf("{");
    if (labelAt !== -1 && (braceAt === -1 || labelAt < braceAt)) {
      const first = parseLabelled(raw);
      if (first) return first;
    }
    const j = parseLooseJSON(raw);
    if (j && (j.summary != null || j.frame != null)) return fromReplyObject(j);
    const labelled = parseLabelled(raw);
    if (labelled) return labelled;
    return {
      frame: "The reply didn't follow the expected format, so it's shown as the summary.",
      state: null,
      summary: raw.slice(0, 2000),
      triggers: null,
      loose: true,
    };
  }

  function parseLooseJSON(raw) {
    // Unwrap only a fence around the whole reply; fences inside the text (Markdown code blocks) stay.
    const src = String(raw || "").trim().replace(/^\x60{3}[a-z]*[ \t]*\n/i, "").replace(/\n\x60{3}\s*$/, "");
    const a = src.search(/[{\[]/);
    if (a === -1) return null;
    const close = balancedEnd(src, a);
    const b = close !== -1 ? close - 1 : Math.max(src.lastIndexOf("}"), src.lastIndexOf("]"));
    if (b <= a) return null;
    const body = src.slice(a, b + 1);
    const oneLine = body.replace(/\r?\n/g, " ");
    const noTrailing = oneLine.replace(/,\s*([}\]])/g, "$1");
    const straight = noTrailing.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const quotedKeys = straight.replace(/([{,]\s*)([A-Za-z_][\w -]*?)\s*:/g, '$1"$2":');
    const singleQuotes = quotedKeys.replace(/'([^'"\\]*)'/g, '"$1"');
    // Bare words as values (status: asleep) become strings; numbers and true/false/null stay.
    const bareValues = singleQuotes.replace(/:\s*([^"{\[\s,][^,}\]]*?)\s*(?=[,}\]])/g, (m, v) =>
      /^(-?\d+(\.\d+)?|true|false|null)$/.test(v) ? ": " + v : ": " + JSON.stringify(v));
    for (const t of [body, oneLine, noTrailing, straight, quotedKeys, singleQuotes, bareValues]) {
      try {
        const j = JSON.parse(t);
        if (j && typeof j === "object") return j;
      } catch (_) {}
    }
    return null;
  }

  // Index just past the bracket that closes the one at str[from], or -1.
  function balancedEnd(str, from) {
    let depth = 0, inStr = false, esc = false;
    for (let i = from; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") { depth--; if (depth === 0) return i + 1; }
    }
    return -1;
  }

  // State text that couldn't be read is kept as notes only if it says something;
  // otherwise null, so the previous details stay in place.
  function stateFrom(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    const j = parseLooseJSON(t);
    if (j) return j;
    return t.replace(/[{}\[\]",:\s]/g, "").length > 15 ? { notes: t } : null;
  }

  function fromReplyObject(j) {
    let state = null;
    if (j.state && typeof j.state === "object") state = j.state;
    else if (typeof j.state === "string") state = stateFrom(j.state);
    return {
      frame: typeof j.frame === "string" ? j.frame : JSON.stringify(j.frame || ""),
      state: state,
      summary: typeof j.summary === "string" ? j.summary : j.summary ? JSON.stringify(j.summary) : "",
      triggers: normalizeVerdicts(typeof j.triggers === "string" ? parseLooseJSON(j.triggers) : j.triggers),
    };
  }

  function parseLabelled(raw) {
    const re = /^[\s*#>-]*(FRAME|SUMMARY|STATE|TRIGGERS)\s*\**\s*:\s*\**\s*/gim;
    const marks = [];
    let m;
    while ((m = re.exec(raw))) marks.push({ key: m[1].toUpperCase(), start: m.index, body: re.lastIndex });
    if (!marks.length) return null;
    const parts = {};
    let skipUntil = -1;
    marks.forEach((mk, i) => {
      if (mk.start < skipUntil) return; // a "label" inside a STATE/TRIGGERS block
      let end = raw.length;
      for (let k = i + 1; k < marks.length; k++) {
        if (marks[k].start >= mk.body) { end = marks[k].start; break; }
      }
      if (mk.key === "STATE" || mk.key === "TRIGGERS") {
        const offset = raw.slice(mk.body).search(/\S/);
        const at = offset === -1 ? -1 : mk.body + offset;
        if (at !== -1 && (raw[at] === "{" || raw[at] === "[")) {
          const close = balancedEnd(raw, at);
          if (close !== -1) { end = close; skipUntil = close; }
        }
      }
      if (!(mk.key in parts)) parts[mk.key] = raw.slice(mk.body, end).trim();
    });
    if (!parts.SUMMARY && !parts.FRAME) return null;
    const triggers = parts.TRIGGERS ? normalizeVerdicts(parseLooseJSON(parts.TRIGGERS)) : null;
    return { frame: parts.FRAME || "", state: stateFrom(parts.STATE), summary: parts.SUMMARY || parts.FRAME || "", triggers: triggers };
  }

  // ── timing ──
  function pause(sess, ms) {
    return new Promise((resolve) => {
      if (ms <= 0 || !sess.running || sess.paused) return resolve();
      sess.nextAt = Date.now() + ms;
      sess.wake = resolve;
      sess.sleepTimer = setTimeout(() => { sess.wake = null; sess.nextAt = 0; resolve(); }, ms);
    });
  }
  function wake(sess) {
    clearTimeout(sess.sleepTimer);
    sess.nextAt = 0;
    if (sess.wake) { const r = sess.wake; sess.wake = null; r(); }
  }
  function tickClock() {
    renderStats();
    if (!S.running) return;
    if (!S.paused) runDueTriggers(S);
    if (S.trigOrder.length) renderTriggerStatus();
    if (S.busyIdx) setStatus((isApple() ? "Running the shortcut for photo #" : "Analyzing photo #") + S.busyIdx + "…");
    else if (S.triggerWaitIdx) setStatus("Running triggers for photo #" + S.triggerWaitIdx + "…");
    else if (S.paused) setStatus("Paused");
    else if (S.nextAt) setStatus("Next photo in " + Math.max(0, Math.ceil((S.nextAt - Date.now()) / 1000)) + " s");
    else setStatus("Taking a photo\u2026");
    renderCountdown();
    updateNowWait();
  }

  // ── rendering ──
  function renderAll() { renderStats(); renderSummary(); renderFrames(); renderDebug(); }

  function renderStats() {
    const st = S.stats;
    const end = S.running ? Date.now() : st.end || st.start;
    $("sElapsed").textContent = fmtDur(st.start ? end - st.start - pausedMs(S) : 0);
    $("sPhotos").textContent = st.photos;
    $("sReq").textContent = st.requests;
    $("sTok").textContent = isApple() ? "–" : fmtNum(st.total);
  }

  function renderSummary() {
    const p = $("summary");
    if (S.summary) { p.innerHTML = md(S.summary); p.classList.remove("muted"); }
    else {
      p.textContent = isMoment()
        ? (S.running ? "Shows what the latest photo contains." : "Start a session. Each photo is described here on its own.")
        : (S.running ? "Builds up as photos are analyzed." : "Start a session. Everything seen is summarized here, following your instructions.");
      p.classList.add("muted");
    }
    const bits = [];
    if (S.summaryAt) bits.push((isMoment() ? "From photo #" : "Updated after photo #") + S.summaryAt.idx + " at " + S.summaryAt.time + ".");
    if (S.running && S.busyIdx) bits.push("Adding photo #" + S.busyIdx + "…");
    $("summaryMeta").textContent = bits.join(" ");
    $("summaryBy").textContent = S.summary && S.by ? "✦ AI summary by " + S.by : "";
    $("summaryBy").classList.toggle("hidden", !(S.summary && S.by));
    if (S.summary && S.summary !== shownSummary) {
      shownSummary = S.summary;
      const box = $("heroSummary");
      box.classList.add("fresh");
      clearTimeout(freshTimer);
      freshTimer = setTimeout(() => box.classList.remove("fresh"), 1500);
    }
    if (!S.summary) shownSummary = "";
    const hasState = S.state && Object.keys(S.state).length > 0;
    $("stateBox").classList.toggle("hidden", !hasState);
    $("state").innerHTML = hasState ? highlightJSON(JSON.stringify(S.state, null, 2)) : "";
  }

  function renderFrames() {
    renderNow();
    // Earlier photos: everything not already in the Analyzing or Analyzed tiles, as small thumbnails.
    const lastDone = S.frames.find((f) => !f.pending);
    const older = S.frames.filter((f) => !f.pending && f !== lastDone);
    const box = $("frames");
    box.textContent = "";
    if (older.length) {
      box.appendChild(el("h2", "olderTitle", "Earlier photos"));
      const row = el("div", "older");
      older.forEach((f) => row.appendChild(frameView(f)));
      box.appendChild(row);
    }
  }

  function photoView(f) {
    if (f.img) {
      const img = new Image();
      img.src = f.img;
      img.alt = "Photo #" + f.idx;
      return img;
    }
    return el("div", "placeholder", f.pending ? "Taking the photo in Shortcuts…" : f.noPhoto ? "Photo not shown (\u201CShow each photo here\u201D is off)" : "No photo came back. Allow pasting for Scriptable to see it.");
  }

  function frameView(f) {
    const card = el("article", "small");
    card.appendChild(photoView(f));
    noteParts(f, false).forEach((n) => card.appendChild(n));
    return card;
  }

  function noteParts(f, big) {
    const out = [];
    const cls = "text" + (f.pending ? " pending" : f.error ? " err" : "");
    const lead = big ? "This photo: " : "";
    if (f.pending || f.error) out.push(el("p", cls, f.pending ? "Analyzing…" : "Not analyzed: " + f.error));
    else { const t = el("div", cls + " md"); t.innerHTML = md(lead + (f.text || "")); out.push(t); }
    const bits = [];
    if (!big) bits.push("#" + f.idx + ", " + f.time);
    if (f.tokens) bits.push(fmtNum(f.tokens) + " tokens");
    if (f.ms) bits.push((f.ms / 1000).toFixed(1) + " s");
    if (bits.length) out.push(el("div", "meta num", bits.join(", ")));
    return out;
  }

  // The stats table for a session (saved with it, and shown in its report).
  function statsRows(sess) {
    const st = sess.stats;
    const rows = [
      ["Duration", fmtDur(st.end - st.start - (st.paused || 0)) + (st.paused > 999 ? " (plus " + fmtDur(st.paused) + " paused)" : "")],
      ["Photos taken", st.photos],
      ["Requests sent", st.requests],
      ["Analyzed", st.ok],
      ["Failed", st.failed],
    ];
    if (st.cancelled) rows.push(["Cancelled at end", st.cancelled]);
    if (isApple()) {
      rows.push(["Tokens", "Not reported by Apple"]);
    } else {
      rows.push(
        ["Input tokens", fmtNum(st.prompt)],
        ["Output tokens", fmtNum(st.completion)],
        ["Total tokens", fmtNum(st.total)],
        ["Average tokens per request", st.ok ? fmtNum(Math.round(st.total / st.ok)) : "–"]
      );
    }
    if (sess.trigOrder.length) {
      rows.push(["Trigger checks", st.checks], ["Triggers fired", st.fired]);
      sess.trigOrder.forEach((id) => {
        const t = sess.trig[id];
        rows.push(["\u201C" + t.t.name + "\u201D ran", t.fired + (t.fired === 1 ? " time" : " times") + (t.off ? " (off at the end)" : "")]);
      });
    }
    rows.push(
      ["Average response time", st.ok ? (st.latency / st.ok / 1000).toFixed(1) + " s" : "–"],
      ["Analyzed with", isApple() ? "Apple Intelligence (" + cfg.shortcut + ")" : (sess.by || cloud.name) + " — " + cloud.model],
      ["Interval", cfg.interval + " s"],
      ["Summary", isMoment() ? "Fresh for each photo" : "Built up over the session"]
    );
    return rows;
  }

  function showModal() {
    const st = S.stats;
    const rows = [
      ["Duration", fmtDur(st.end - st.start - (st.paused || 0)) + (st.paused > 999 ? " (plus " + fmtDur(st.paused) + " paused)" : "")],
      ["Photos taken", st.photos],
      ["Requests sent", st.requests],
      ["Analyzed", st.ok],
      ["Failed", st.failed],
    ];
    if (st.cancelled) rows.push(["Cancelled at end", st.cancelled]);
    if (isApple()) {
      rows.push(["Tokens", "Not reported by Apple"]);
    } else {
      rows.push(
        ["Input tokens", fmtNum(st.prompt)],
        ["Output tokens", fmtNum(st.completion)],
        ["Total tokens", fmtNum(st.total)],
        ["Average tokens per request", st.ok ? fmtNum(Math.round(st.total / st.ok)) : "–"]
      );
    }
    if (S.trigOrder.length) {
      rows.push(["Trigger checks", st.checks], ["Triggers fired", st.fired]);
      S.trigOrder.forEach((id) => {
        const t = S.trig[id];
        rows.push(["\u201C" + t.t.name + "\u201D ran", t.fired + (t.fired === 1 ? " time" : " times") + (t.off ? " (off at the end)" : "")]);
      });
    }
    rows.push(
      ["Average response time", st.ok ? (st.latency / st.ok / 1000).toFixed(1) + " s" : "–"],
      ["Analyzed with", isApple() ? "Apple Intelligence (" + cfg.shortcut + ")" : (S.by || cloud.name) + " — " + cloud.model],
      ["Interval", cfg.interval + " s"],
      ["Summary", isMoment() ? "Fresh for each photo" : "Built up over the session"]
    );
    const t = $("mTable");
    t.textContent = "";
    rows.forEach(([k, v]) => {
      const tr = el("tr");
      tr.append(el("td", null, k), el("td", null, String(v)));
      t.appendChild(tr);
    });
    $("mSummary").innerHTML = S.summary ? md(S.summary) : "<p>No photo was analyzed in this session.</p>";
    $("modal").classList.remove("hidden");
    $("mClose").focus();
  }

  function updateToggle() {
    const b = $("toggle");
    b.textContent = S.running ? "End session" : "Start session";
    b.classList.toggle("stop", S.running);
    $("statusBox").classList.toggle("running", S.running);
    renderTabs();
    updateControls();
  }
  function setStatus(t) { $("status").textContent = t; }
  function showError(msg) { const e = $("error"); e.textContent = msg; e.classList.remove("hidden"); }
  function hideError() { $("error").classList.add("hidden"); }
  function fmtNum(n) { return Number(n || 0).toLocaleString(); }
  function fmtDur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }
}
// The page goes on screen first; Scriptable hands over the data once it has read it (safe-startup recipe).
window.__parts = [];
window.__bootNote = function (title, detail) {
  var b = document.querySelector(".booting"); if (!b) return;
  b.className = "booting note";
  b.innerHTML = "<b></b><span></span>" + (detail ? "<pre></pre>" : "");
  b.querySelector("b").textContent = title;
  b.querySelector("span").textContent = "Close VisionX and open it again. If it keeps happening, run the installer once more.";
  if (detail) b.querySelector("pre").textContent = detail;
};
setTimeout(function () { if (!window.__booted) window.__bootNote("Still loading…"); }, 25000);
document.addEventListener("visibilitychange", function () {   // coming back into view: redraw
  if (document.visibilityState !== "visible") return;
  var d = document.documentElement; d.style.transform = "translateZ(0)"; void d.offsetHeight; d.style.transform = "";
});
window.__boot = function (st) {
  if (window.__booted) return;
  if (!st.sessions || !st.sessions.length) st.sessions = [].concat.apply([], window.__parts);
  window.__parts = [];
  window.__booted = true; window.__INIT = st;
  requestAnimationFrame(function () {   // make WebKit draw again once the data is in (helps if the window came up blank)
    var d = document.documentElement; d.style.transform = "translateZ(0)"; void d.offsetHeight;
    requestAnimationFrame(function () { d.style.transform = ""; });
  });
  clientApp(st);
  // VisionX's views are in the markup, not drawn by a first render: show them and drop the placeholder.
  document.body.classList.add("booted");
  var b = document.querySelector(".booting"); if (b) b.parentNode.removeChild(b);
};
`;

// Settings are loaded here, before every branch (app and widget runs both use the saved choices); data is read in each branch.
await loadSettings();
if (config.runsInWidget || config.runsInAccessoryWidget) {
  await loadData();
  await runWidget();             // never builds or presents a WebView, Alert or QuickLook (app-blueprints · widgets)
} else {
  try {
    await main();                // the widget's logo tile is cached 6 s after the first screen (bootApp)
  } catch (e) {
    startLog("start-up failed: " + ((e && e.message) || e));
    const a = new Alert();
    a.title = "Vision Session failed to start";
    a.message = String((e && e.message) || e);
    a.addAction("OK");
    await a.present();
  }
}
Script.complete();
