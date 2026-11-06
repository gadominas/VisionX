// VisionX test harness: runs the real VisionX.js in a Node vm with Scriptable's APIs replaced by stand-ins
// (see docs/TESTING.md). The page runs in jsdom; its hidden vsbridge:// frames reach shouldAllowRequest,
// as on the phone. Nothing reaches the network: every request is answered by a fixture below, and a request
// without one fails loudly.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM, VirtualConsole } = require("jsdom");

const SCRIPT = process.env.VISIONX_SCRIPT || path.join(__dirname, "..", "VisionX.js");
const SOURCES = {};
const source = (p) => SOURCES[p] || (SOURCES[p] = fs.readFileSync(p, "utf8"));
const versionOf = (src) => (src.match(/const VERSION = '([^']+)'/) || [])[1] || "0.0.0";
const bump = (v) => v.split(".").map((n, i, a) => (i === a.length - 1 ? +n + 1 : n)).join(".");

// Paths on the pretend phone: iCloud Drive › Scriptable, Scriptable's local Documents, and its temporary folder
const ICLOUD = "/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents";
const LOCAL = "/var/mobile/Containers/Data/Application/SCRIPTABLE/Documents";
const TMP = "/var/mobile/Containers/Data/Application/SCRIPTABLE/tmp";
// The smallest valid JPEG (1×1 px): what the fake camera, the clipboard and thumbnails hand over
const TINY_JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const LIST_SHORTCUT = "VisionX Shortcut List";

function makeEnv(opts = {}) {
  const scriptPath = opts.script ? path.resolve(__dirname, "..", opts.script) : SCRIPT;
  const SRC = source(scriptPath);
  const VERSION = versionOf(source(SCRIPT));
  const files = opts.files || {};          // path → string (or { img } for images)
  const dirs = new Set(opts.dirs || []);
  const kc = opts.kc || {};
  const ls = opts.ls || {};                // the page's localStorage (https://localhost/), kept between runs
  const scale = opts.timeScale == null ? 0.1 : opts.timeScale;   // Timer.schedule runs 10× faster by default
  const noICloud = !!opts.noICloud;
  const log = {
    requests: [], unmocked: [], harness: [], ai: [], alerts: [], callbacks: [], shortcutsRun: [], pasteboard: [], pasteImage: 0,
    opened: [], widgets: [], windows: [], presented: 0, posthog: [], console: [], warnings: [], consoleErrors: [],
    camera: [], cameraStopped: 0, zoom: [], photos: 0, pageClipboard: [], icloudTouched: [], notImplemented: [],
  };
  const P = {
    icloud: ICLOUD, local: LOCAL, tmp: TMP,
    settings: (noICloud ? LOCAL : ICLOUD) + "/VisionX/settings.json",
    store: LOCAL + "/vision-session.json", usage: LOCAL + "/visionx-usage.json", aiSettings: LOCAL + "/visionx-ai-settings.json",
    sessions: LOCAL + "/VisionX-sessions", index: LOCAL + "/VisionX-sessions/index.json",
    widget: LOCAL + "/visionx-widget.json", startLog: LOCAL + "/visionx-startup.log", lock: TMP + "/visionx-running",
  };
  const matches = (p, list) => [].concat(list || []).some((n) => n && String(p).endsWith(n));

  // ── FileManager: in memory. iCloud files can be slow (opts.slowCloud) or unreadable (opts.unreadable) ──
  function fileManager(root, cloud) {
    const under = (p, d) => p.startsWith(d.replace(/\/$/, "") + "/");
    return {
      documentsDirectory: () => root, temporaryDirectory: () => TMP, libraryDirectory: () => root.replace(/Documents$/, "Library"),
      joinPath: (a, b) => String(a).replace(/\/$/, "") + "/" + String(b).replace(/^\//, ""),
      fileExists: (p) => p in files || dirs.has(p) || Object.keys(files).some((k) => under(k, p)),
      isDirectory: (p) => dirs.has(p) || Object.keys(files).some((k) => under(k, p)),
      createDirectory: (p) => { dirs.add(p); },
      readString: (p) => {
        if (matches(p, opts.unreadable)) throw new Error("The file couldn't be opened.");
        if (!(p in files)) return null;
        return typeof files[p] === "string" ? files[p] : null;
      },
      writeString: (p, s) => { if (matches(p, opts.readOnly)) throw new Error("You don't have permission to save the file."); files[p] = String(s); },
      readImage: (p) => (p in files ? { size: { width: 96, height: 96 }, path: p } : null),
      writeImage: (p) => { files[p] = { img: true }; },
      listContents: (d) => [...new Set(Object.keys(files).concat([...dirs]).filter((k) => under(k, d)).map((k) => k.slice(d.replace(/\/$/, "").length + 1).split("/")[0]))],
      remove: (p) => { for (const k of Object.keys(files)) if (k === p || under(k, p)) delete files[k]; dirs.delete(p); },
      isFileStoredIniCloud: (p) => cloud && p in files,
      isFileDownloaded: (p) => !(cloud && matches(p, opts.slowCloud)),
      downloadFileFromiCloud: (p) => (cloud && matches(p, opts.slowCloud) ? new Promise(() => {}) : Promise.resolve()),
      fileName: (p) => String(p).split("/").pop().replace(/\.[^.]*$/, ""),
    };
  }
  // A phone without iCloud: Scriptable still hands out an iCloud manager, but every call on it ends the script
  const noICloudFm = () => new Proxy({}, { get: (_, k) => () => {
    log.icloudTouched.push(String(k));
    log.harness.push("FileManager.iCloud()." + String(k) + " on a phone without iCloud");
    throw new Error("iCloud is not supported. Make sure that you are logged into iCloud in the device settings.");
  } });
  const FileManager = { local: () => fileManager(LOCAL, false), iCloud: () => (noICloud ? noICloudFm() : fileManager(ICLOUD, true)) };

  // ── Fixtures: every host VisionX calls. Unknown URLs fail loudly ──
  const aiCount = {};
  const analysisReply = (kind, req, n) => {
    const idx = +((req.text.match(/(?:Frame|Photo) #(\d+)/) || [])[1] || n);
    if (kind === "analysis-fresh") {
      const ids = [...req.system.matchAll(/^- "([^"]+)": /gm)].map((m) => m[1]);
      const out = { frame: "Photo " + idx + ": a grey hatchback with plate KXA 482 is at the gate.", state: { cars: 1, plate: "KXA 482" }, summary: "One car at the gate: KXA 482." };
      if (ids.length) out.triggers = Object.fromEntries(ids.map((id) => [id, { met: opts.verdict ? !!opts.verdict(id, idx, req) : true, reason: "KXA 482 is on the list." }]));
      return JSON.stringify(out);
    }
    return JSON.stringify({ frame: "Photo " + idx + ": " + idx + " people near the door.", state: { people: idx, ids: Array.from({ length: idx }, (_, i) => "p" + (i + 1)) }, summary: idx + " different people so far." });
  };
  const refineReply = (req) => {
    const cur = (req.text.split("CURRENT INSTRUCTIONS:\n")[1] || "").split("\n\nRespond with JSON only")[0].trim();
    if (/visually compelling/.test(req.text)) return JSON.stringify({ instructions: cur + " Open with one headline sentence, then show the count as stat tiles and a bar per category.", changes: "Added visuals for the counts." });
    return JSON.stringify({ instructions: cur + " Count each person once and ignore reflections.", changes: "Said what to count once and what to ignore." });
  };
  function aiKind(system, text) {
    if (/^You analyze a live camera feed/.test(system)) return "analysis-build";
    if (/^You analyze single photos/.test(system)) return "analysis-fresh";
    if (/^You check conditions/.test(system)) return "triggers";
    if (/^You improve instructions/.test(system)) return "refine";
    if (/^Reply with the single word OK/.test(system)) return "test";
    return null;
  }
  async function aiRoute(provider, req) {
    const b = JSON.parse(req.body);
    let system, user;
    if (provider === "anthropic") {
      if (!b.max_tokens) log.harness.push("Claude request without max_tokens");
      system = b.system; user = b.messages[0].content;
    } else {
      if ("max_tokens" in b) log.harness.push("OpenAI request with max_tokens");
      system = b.messages[0].content; user = b.messages[1].content;
    }
    const parts = Array.isArray(user) ? user : [{ type: "text", text: user }];
    const text = parts.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const images = parts.filter((c) => c.type === "image" || c.type === "image_url");
    const kind = aiKind(String(system), text);
    const entry = { provider, kind, system, text, images, model: b.model, maxTokens: b.max_tokens, headers: req.headers, body: b };
    log.ai.push(entry);
    if (!kind) { log.harness.push("AI prompt of an unknown kind: " + String(system).slice(0, 60)); return [400, JSON.stringify({ error: { message: "unknown prompt" } })]; }
    const n = aiCount[kind] = (aiCount[kind] || 0) + 1;
    if (opts.aiDelay) await new Promise((r) => setTimeout(r, typeof opts.aiDelay === "function" ? opts.aiDelay(kind, n) : opts.aiDelay));
    const err = typeof opts.aiError === "function" ? opts.aiError(kind, n) : opts.aiError;
    if (err) return [err.status || 401, JSON.stringify(provider === "anthropic" ? { type: "error", error: { type: "authentication_error", message: err.message } } : { error: { message: err.message, type: "invalid_request_error" } })];
    let out = opts.ai ? opts.ai(kind, entry, n) : undefined;
    if (out === undefined) out = kind === "test" ? "OK" : kind === "refine" ? refineReply(entry)
      : kind === "triggers" ? JSON.stringify({ met: opts.verdict ? !!opts.verdict(null, n, entry) : true, reason: "Two people are at the door." })
      : analysisReply(kind, entry, n);
    return [200, JSON.stringify(provider === "anthropic"
      ? { id: "msg_test", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: out }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 150 } }
      : { id: "chatcmpl-test", object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: out }, finish_reason: "stop" }], usage: { prompt_tokens: 1100, completion_tokens: 140, total_tokens: 1240 } })];
  }
  async function route(req) {
    const url = req.url;
    if (opts.offline) throw new Error("The Internet connection appears to be offline.");
    if (url.startsWith("https://raw.githubusercontent.com/gadominas/VisionX/main/")) {
      const rest = url.slice(57).split("?")[0];
      if (rest === "releases.json") return [200, JSON.stringify(opts.releases || { name: "VisionX", appId: "visionx", script: "VisionX.js", releases: [{ version: VERSION, title: "This version" }] })];
      if (rest === "VisionX.js") { log.scriptDownloads = (log.scriptDownloads || 0) + 1; return [opts.newScriptStatus || 200, opts.newScript != null ? opts.newScript : "// VisionX\nconst VERSION = '" + bump(VERSION) + "';\nconst APP_ID = 'visionx';\n"]; }
      if (rest === "docs/icon-1024.png") return [200, "PNG"];
    }
    if (url === "https://api.anthropic.com/v1/messages") return aiRoute("anthropic", req);
    if (url === "https://api.openai.com/v1/chat/completions") return aiRoute("openai", req);
    if (url.startsWith("https://api.anthropic.com/v1/models")) { log.modelLists = (log.modelLists || 0) + 1;
      return [200, JSON.stringify({ data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-06-02T00:00:00Z" }, { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-06-01T00:00:00Z" }] })]; }
    if (url === "https://api.openai.com/v1/models") { log.modelLists = (log.modelLists || 0) + 1;
      return [200, JSON.stringify({ data: [{ id: "gpt-4.1-mini", created: 1767225600 }, { id: "gpt-4.1", created: 1767139200 }, { id: "text-embedding-3-small", created: 1767052800 }, { id: "gpt-4o-audio-preview", created: 1767052800 }] })]; }
    if (url === "https://us.i.posthog.com/batch/") { log.posthog.push(JSON.parse(req.body)); return [opts.posthogStatus || 200, opts.posthogStatus && opts.posthogStatus !== 200 ? "Invalid API key" : JSON.stringify({ status: 1 })]; }
    return null;
  }
  class Request {
    constructor(url) { this.url = url; this.method = "GET"; this.headers = {}; this.body = null; this.timeoutInterval = 60; this.response = null; }
    async _go() {
      const req = { url: String(this.url), method: this.method, headers: this.headers, body: this.body == null ? null : String(this.body) };
      log.requests.push(req);
      const r = await route(req);
      if (!r) { log.unmocked.push(req.url); throw new Error("harness: no fixture for " + req.url); }
      this.response = { statusCode: r[0], url: req.url, headers: {} };
      return r[1];
    }
    async loadString() { return this._go(); }
    async loadJSON() { return JSON.parse(await this._go()); }
    async load() { const s = await this._go(); return { toRawString: () => s, toBase64String: () => Buffer.from(s).toString("base64") }; }
    async loadImage() { await this._go(); if (this.response.statusCode !== 200) throw new Error("The resource could not be loaded as an image."); return { size: { width: 1024, height: 1024 } }; }
  }

  // ── Alert: answers queued by the test: ["text", …] (fields, first button), { action: n }, { cancel: true } ──
  const alertValues = opts.alertValues || [];
  log.pushAlert = (v) => alertValues.push(v);
  class Alert {
    constructor() { this.title = ""; this.message = ""; this.actions = []; this.fields = []; this.hasCancel = false; }
    addTextField(p, v) { this.fields.push(v || ""); return { setDefaultKeyboard() {}, setDecimalPadKeyboard() {}, setNumberPadKeyboard() {} }; }
    addSecureTextField(p, v) { return this.addTextField(p, v); }
    addAction(t) { this.actions.push(t); } addDestructiveAction(t) { this.actions.push(t); } addCancelAction(t) { this.hasCancel = true; this.cancelLabel = t; }
    async present() {
      const a = alertValues.length ? alertValues.shift() : (this.hasCancel ? { cancel: true } : { action: 0 });
      this.vals = Array.isArray(a) ? a : (a.text || []);
      log.alerts.push({ title: this.title, message: this.message, actions: this.actions.slice(), answer: a });
      return a.cancel ? -1 : a.action || 0;
    }
    presentAlert() { return this.present(); } presentSheet() { return this.present(); }
    textFieldValue(i) { return this.vals[i] == null ? "" : String(this.vals[i]); }
  }

  // ── Shortcuts (CallbackURL): Apple Intelligence, the checker, the list helper and trigger shortcuts ──
  const clip = { image: null };
  class CallbackURL {
    constructor(base) { this.base = base; this.params = {}; }
    addParameter(k, v) { this.params[k] = v; }
    getURL() { return this.base + "?" + Object.entries(this.params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&"); }
    async open() {
      const name = this.params.name, text = String(this.params.text || "");
      log.callbacks.push({ url: this.base, name, text });
      const own = opts.shortcuts && opts.shortcuts[name];
      if (own === "fail" || (own && own.fail)) throw new Error("The shortcut failed.");
      if (typeof own === "function") return { result: own(text) };
      if (name === LIST_SHORTCUT) return { result: (opts.shortcutList || ["Open Gate", "Notify Me", "Doorbell Chime", LIST_SHORTCUT]).join("\n") };
      if (/^You analyze (a live camera feed|single photos)/.test(text)) {   // Vision Session AI: takes the photo, copies it, asks the model
        const n = log.callbacks.filter((c) => /^You analyze/.test(c.text)).length;
        clip.image = { size: { width: 768, height: 1024 } };
        const ids = [...text.matchAll(/^- "([^"]+)": /gm)].map((m) => m[1]);
        return { result: "FRAME: Photo " + n + ": " + n + " people at the bench.\nSUMMARY: " + n + " different people so far.\nSTATE: {\"people\": " + n + "}" +
          (ids.length ? "\nTRIGGERS: " + JSON.stringify(Object.fromEntries(ids.map((id) => [id, { met: true, reason: "Someone is at the bench." }]))) : "") };
      }
      if (/^You decide whether a condition is met/.test(text)) return { result: JSON.stringify({ met: opts.verdict ? !!opts.verdict(null, 0, { text }) : true, reason: "Someone is at the bench." }) };
      if (/^You improve instructions/.test(text)) return { result: refineReply({ text }) };
      log.shortcutsRun.push({ name, text });   // a trigger's own shortcut
      return { result: "" };
    }
  }

  // ── Widgets: a tree of plain objects (E.log.widgets), read with E.widgetText() ──
  class WStack {
    constructor(kind) { this.kind = kind || "stack"; this.children = []; this.vertical = false; }
    addStack() { const s = new WStack(); this.children.push(s); return s; }
    addText(t) { const x = { kind: "text", text: String(t), centerAlignText() { this.center = true; }, leftAlignText() {}, rightAlignText() {} }; this.children.push(x); return x; }
    addImage(img) { const x = { kind: "image", img }; this.children.push(x); return x; }
    addDate(d) { return this.addText(String(d)); }
    addSpacer(n) { this.children.push({ kind: "spacer", n: n == null ? null : n }); }
    setPadding(t, l, b, r) { this.pad = [t, l, b, r]; } useDefaultPadding() {}
    centerAlignContent() { this.align = "center"; } topAlignContent() { this.align = "top"; } bottomAlignContent() { this.align = "bottom"; }
    layoutVertically() { this.vertical = true; } layoutHorizontally() { this.vertical = false; }
  }
  class ListWidget extends WStack {
    constructor() { super("widget"); this.vertical = true; log.widgetsBuilt = (log.widgetsBuilt || 0) + 1; }
    presentSmall() { log.harness.push("a widget was presented"); } presentMedium() { log.harness.push("a widget was presented"); } presentLarge() { log.harness.push("a widget was presented"); }
  }
  class DrawContext {
    constructor() { this.size = { width: 0, height: 0 }; this.ops = []; }
    drawImageInRect(img) { this.ops.push("image"); } fillRect() { this.ops.push("rect"); } drawTextInRect(t) { this.ops.push("text:" + t); }
    setFillColor() {} setFont() {} setTextColor() {} setTextAlignedCenter() {} setTextAlignedLeft() {} setTextAlignedRight() {}
    getImage() { return { size: this.size, drawn: this.ops.slice() }; }
  }
  class DateFormatter {
    constructor() { this.dateFormat = "yyyy-MM-dd"; }
    useShortTimeStyle() {} useNoDateStyle() {} useShortDateStyle() {} useMediumDateStyle() {} useNoTimeStyle() {}
    string(d) {
      const p = (n) => String(n).padStart(2, "0"), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const T = { yyyy: () => d.getFullYear(), MMM: () => M[d.getMonth()], MM: () => p(d.getMonth() + 1), dd: () => p(d.getDate()), d: () => d.getDate(), HH: () => p(d.getHours()), mm: () => p(d.getMinutes()) };
      return String(this.dateFormat).replace(/yyyy|MMM|MM|dd|d|HH|mm/g, (t) => String(T[t]()));
    }
  }

  // ── WebView: one jsdom page per loadHTML; the bridge goes back to the script as on the phone ──
  let dom = null, wvRef = null, resolvePresent, pageLoads = 0;
  const presented = new Promise((r) => (resolvePresent = r));
  function pageSetup(w, wv) {
    w.matchMedia = (q) => ({ matches: !!opts.dark && /dark/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
    Object.defineProperty(w, "innerWidth", { configurable: true, value: 390 }); Object.defineProperty(w, "innerHeight", { configurable: true, value: 844 });   // an iPhone
    w.Element.prototype.scrollIntoView = function () {};
    // The bridge: a frame navigating to a custom scheme goes to the WebView's shouldAllowRequest, never loads
    const fsrc = Object.getOwnPropertyDescriptor(w.HTMLIFrameElement.prototype, "src");
    Object.defineProperty(w.HTMLIFrameElement.prototype, "src", { configurable: true, get() { return fsrc.get.call(this); }, set(v) {
      v = String(v);
      if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^(https?|about|data|blob|javascript):/i.test(v)) {
        log.bridgeCalls = (log.bridgeCalls || 0) + 1;
        setTimeout(() => { if (typeof wv.shouldAllowRequest === "function") wv.shouldAllowRequest({ url: v, method: "GET" }); }, 0);
        return;
      }
      fsrc.set.call(this, v);
    } });
    // The camera: a stream whose video always has frames; zoom when opts.cameraZoom (the lens maximum)
    const track = { kind: "video", readyState: "live", muted: false, label: "Back Camera",
      getCapabilities: () => (opts.cameraZoom ? { zoom: { min: 1, max: opts.cameraZoom, step: 0.1 } } : {}),
      getSettings: () => ({ width: 1920, height: 1080 }),
      applyConstraints: async (c) => { log.zoom.push(c); },
      stop() { this.readyState = "ended"; log.cameraStopped++; } };
    const devices = opts.noCamera ? undefined : { getUserMedia: async (c) => {
      log.camera.push(c);
      if (opts.cameraDenied) { const e = new Error("The request is not allowed by the user agent or the platform in the current context."); e.name = "NotAllowedError"; throw e; }
      track.readyState = "live";
      return { id: "stream", getVideoTracks: () => [track], getTracks: () => [track] };
    } };
    Object.defineProperty(w.navigator, "mediaDevices", { configurable: true, value: devices });
    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { log.pageClipboard.push(t); } } });
    const media = w.HTMLMediaElement.prototype, video = w.HTMLVideoElement.prototype;
    Object.defineProperty(media, "srcObject", { configurable: true, get() { return this.__so || null; }, set(v) { this.__so = v; } });
    Object.defineProperty(media, "paused", { configurable: true, get() { return !this.__playing; } });
    media.play = function () { this.__playing = true; return Promise.resolve(); };
    media.pause = function () { this.__playing = false; };
    Object.defineProperty(video, "videoWidth", { configurable: true, get() { return this.__so && track.readyState === "live" ? 1920 : 0; } });
    Object.defineProperty(video, "videoHeight", { configurable: true, get() { return this.__so && track.readyState === "live" ? 1080 : 0; } });
    // Canvas: drawing is recorded; every photo is the tiny JPEG
    const ctx2d = new Proxy({}, { get: (t, k) => (k === "drawImage" ? (...a) => { log.draws = (log.draws || 0) + 1; } : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    w.HTMLCanvasElement.prototype.getContext = function () { return ctx2d; };
    w.HTMLCanvasElement.prototype.toDataURL = function (type) { if (this.id === "cv") log.photos++; else log.thumbs = (log.thumbs || 0) + 1; return "data:image/jpeg;base64," + TINY_JPEG; };
    // Images from data: URLs load (as on the phone), with a size, so thumbnails get made
    const isrc = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, "src");
    Object.defineProperty(w.HTMLImageElement.prototype, "src", { configurable: true, get() { return isrc.get.call(this); }, set(v) {
      isrc.set.call(this, v);
      if (/^data:image\//.test(String(v))) { const img = this; setTimeout(() => {
        for (const [k, n] of [["width", 960], ["height", 1280], ["naturalWidth", 960], ["naturalHeight", 1280]]) Object.defineProperty(img, k, { configurable: true, value: n });
        img.dispatchEvent(new w.Event("load"));
      }, 1); }
    } });
    // localStorage at https://localhost/ survives reopening, as in Scriptable's WebView
    try {
      for (const [k, v] of Object.entries(ls)) w.localStorage.setItem(k, v);
      const S = w.Storage.prototype, set = S.setItem, rm = S.removeItem;
      S.setItem = function (k, v) { ls[k] = String(v); return set.call(this, k, v); };
      S.removeItem = function (k) { delete ls[k]; return rm.call(this, k); };
    } catch (e) {}
  }
  class WebView {
    constructor() { this.shouldAllowRequest = null; wvRef = this; log.webviews = (log.webviews || 0) + 1; }
    async loadHTML(html, baseURL) {
      html = String(html);
      const real = /<script/i.test(html);
      log.windows.push({ real, base: baseURL || null, bytes: html.length });
      if (!real) { dom = new JSDOM(html); return; }   // the empty first window
      pageLoads++;
      this.html = html;
      const vc = new VirtualConsole();
      vc.on("jsdomError", (e) => {
        const m = String(e && e.message || e);
        if (/Not implemented|Could not parse CSS/.test(m)) { log.notImplemented.push(m.slice(0, 120)); return; }
        log.jsErrors = (log.jsErrors || []).concat("page: " + (e.detail && e.detail.stack || e.stack || m).split("\n").slice(0, 3).join(" ")); });
      vc.on("error", (...a) => { log.jsErrors = (log.jsErrors || []).concat("page console.error: " + a.join(" ")); });
      const wv = this;
      dom = new JSDOM(html, { url: baseURL || "about:blank", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, beforeParse: (w) => pageSetup(w, wv) });
      if (opts.hangPage && pageLoads === 1) return new Promise(() => {});   // the page runs but its load never finishes (a window that stays blank)
    }
    async present() { log.presented++; return presented; }
    async evaluateJavaScript(code, useCallback) {
      await Promise.resolve();
      if (!dom) throw new Error("no page");
      try {
        const v = dom.window.eval(String(code));
        if (v && typeof v.then === "function") return null;
        return v === undefined ? null : JSON.parse(JSON.stringify(v));
      } catch (e) { log.jsErrors = (log.jsErrors || []).concat("evaluateJavaScript: " + String(e && e.stack || e).split("\n").slice(0, 2).join(" ")); throw e; }
    }
  }

  const rec = (name) => new Proxy({}, { get: (_, k) => (...a) => { (log[name] = log[name] || []).push({ call: String(k), args: a }); return Promise.resolve(null); } });
  const env = {
    FileManager, Request, Alert, WebView, CallbackURL, ListWidget, DrawContext, DateFormatter,
    Keychain: {
      contains: (k) => k in kc, get: (k) => { if (!(k in kc)) throw new Error("Keychain item not found: " + k); return kc[k]; },
      set: (k, v) => { kc[k] = String(v); }, remove: (k) => { delete kc[k]; },
    },
    Pasteboard: {
      copy: (t) => { log.pasteboard.push(String(t)); clip.text = String(t); clip.image = null; }, copyString: (t) => { log.pasteboard.push(String(t)); clip.text = String(t); },
      paste: () => clip.text || null, pasteString: () => clip.text || null,
      pasteImage: () => { log.pasteImage++; return opts.clipboardPhoto === false ? null : clip.image; },
    },
    Data: { fromJPEG: (img) => ({ toBase64String: () => TINY_JPEG }), fromPNG: (img) => ({ toBase64String: () => TINY_JPEG }), fromString: (s) => ({ toRawString: () => String(s) }) },
    Safari: { openInApp: async (u) => { log.opened.push(u); }, open: (u) => { log.opened.push(u); } },
    Timer: { schedule: (ms, repeats, fn) => { const t = (repeats ? setInterval : setTimeout)(fn, Math.max(1, Math.round(ms * scale))); return { invalidate: () => { clearInterval(t); clearTimeout(t); } }; } },
    UUID: { string: () => require("crypto").randomUUID().toUpperCase() },
    Device: { isUsingDarkAppearance: () => !!opts.dark, locale: () => "en_US", language: () => "en", model: () => "iPhone", systemVersion: () => "18.1" },
    Size: class { constructor(w, h) { this.width = w; this.height = h; } },
    Rect: class { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h }); } },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
    Color: class { constructor(hex, a) { this.hex = hex; this.alpha = a == null ? 1 : a; } },
    LinearGradient: class { constructor() { this.colors = []; this.locations = []; } },
    Font: new Proxy({}, { get: (_, name) => (size) => ({ name: String(name), size }) }),
    URLScheme: { forRunningScript: () => "scriptable:///run/VisionX" },
    Script: { setWidget: (w) => log.widgets.push(w), complete: () => { log.completed = true; }, setShortcutOutput: (v) => { log.shortcutOutput = v; }, name: () => "VisionX" },
    config: { runsInApp: !opts.widget, runsInWidget: !!opts.widget && !/^accessory/.test(opts.widget), runsInAccessoryWidget: /^accessory/.test(opts.widget || ""), widgetFamily: opts.widget || null, runsWithSiri: false },
    args: { widgetParameter: opts.widgetParameter || null, queryParameters: opts.queryParameters || {}, shortcutParameter: null, plainTexts: [], images: [], urls: [], fileURLs: [] },
    module: { filename: opts.filename || (noICloud ? LOCAL : ICLOUD) + "/" + path.basename(scriptPath) },
    // Recorded only: VisionX doesn't use them, so any call shows up in E.log
    Speech: rec("speech"), Notification: class { schedule() { (log.notifications = log.notifications || []).push(this.title); } },
    Photos: rec("photos"), DocumentPicker: rec("documentPicker"), QuickLook: rec("quickLook"), ShareSheet: rec("shareSheet"),
    console: { log: (...a) => log.console.push(a.join(" ")), warn: (...a) => log.warnings.push(a.join(" ")), error: (...a) => log.consoleErrors.push(a.join(" ")) },
    // Scriptable's JavaScriptCore has none of these browser APIs: a vm context lacks them too; spelled out here
    URL: undefined, URLSearchParams: undefined, setTimeout: undefined, setInterval: undefined, clearTimeout: undefined, clearInterval: undefined,
    atob: undefined, btoa: undefined, fetch: undefined, TextEncoder: undefined, TextDecoder: undefined, structuredClone: undefined, queueMicrotask: undefined,
  };
  const E = {
    env, files, dirs, kc, ls, log, path: P, src: SRC, scriptPath, version: VERSION,
    getDom: () => dom, win: () => dom && dom.window, doc: () => dom && dom.window.document, wv: () => wvRef,
    finish: () => resolvePresent(),
    $: (sel) => dom.window.document.querySelector(sel),
    $$: (sel) => [...dom.window.document.querySelectorAll(sel)],
    text: (sel) => { const n = dom.window.document.querySelector(sel); return n ? n.textContent.replace(/\s+/g, " ").trim() : null; },
    tap: (sel) => {
      const d = dom.window.document, n = typeof sel === "string" ? d.querySelector(sel) : sel;
      if (!n) throw new Error("no element " + sel);
      n.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    },
    // Types into a field and fires input and change, as a person's typing would
    type: (sel, v) => {
      const n = dom.window.document.querySelector(sel);
      if (!n) throw new Error("no element " + sel);
      n.value = v;
      n.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      n.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    },
    json: (p) => { try { return typeof files[p] === "string" ? JSON.parse(files[p]) : null; } catch (e) { return null; } },   // null when missing or damaged
    widgetText: (w) => { const out = []; (function walk(n) { if (!n) return; if (n.kind === "text") out.push(n.text); (n.children || []).forEach(walk); })(w); return out; },
    // What a test reports besides its own errors: unknown URLs, harness misuse, console.error from the script
    problems: () => log.unmocked.map((u) => "no fixture for " + u).concat(log.harness, log.consoleErrors.map((m) => "console.error: " + m)),
  };
  return E;
}

// Starts the script; returns { E, p }: p settles when the script ends (after E.finish(), or at once for a widget run).
async function run(opts = {}) {
  const E = makeEnv(opts);
  const ctx = vm.createContext(Object.assign({}, E.env));
  const p = vm.runInContext("(async () => {\n" + E.src + "\n})()", ctx, { filename: path.basename(E.scriptPath) });
  return { E, p };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Waits until fn() is truthy (checked every 20 ms), or fails after ms
async function until(fn, ms = 5000, what = "condition") {
  const t0 = Date.now();
  for (;;) { let v; try { v = fn(); } catch (e) {} if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what); await wait(20); }
}
module.exports = { run, makeEnv, wait, until, TINY_JPEG, paths: { ICLOUD, LOCAL, TMP } };
