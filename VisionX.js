// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: camera;

/*
  VisionX — timed photo capture + AI analysis (OpenAI or Apple Intelligence).
  https://github.com/gadominas/VisionX

  • Takes a photo every N seconds from the live camera (no taps needed).
  • Sends each photo + your custom instructions + the accumulated state to OpenAI.
  • The model merges each frame into a cumulative result for the whole session.
  • Shows the latest photo large and the two before it small (last 3 only).
  • Photos live only in memory and are never written to disk or Photos.
  • End the session to see photos taken, requests sent and tokens used.

  Apple Intelligence runs through a Shortcut (Scriptable has no direct access);
  setup steps are in the app under "Analyze with".

  Settings (instructions, interval, model…) are edited inside the app UI.
  The API key is stored in the iOS Keychain. Change or remove it in the app
  with "Change API key" (RESET_API_KEY = true also re-asks at launch).
*/

const RESET_API_KEY = false;
const KEYCHAIN_KEY = "vision_session_openai_key";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_SHORTCUT = "Vision Session AI";
const STORE_FILE = "vision-session.json"; // presets + settings, in Scriptable's local Documents

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

const SKIP_KEY = KEYCHAIN_KEY + "_skipped";

// Returns the key, "" when the user chose Apple Intelligence only, or null to quit.
async function getApiKey(forcePrompt) {
  if (!forcePrompt && Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);
  if (!forcePrompt && Keychain.contains(SKIP_KEY)) return "";
  const a = new Alert();
  a.title = "OpenAI API key";
  a.message = "Saved in the iOS Keychain on this device only. You can skip it and use Apple Intelligence instead.";
  a.addSecureTextField("sk-…", "");
  a.addAction("Save");
  a.addAction("Use Apple Intelligence only");
  a.addCancelAction("Cancel");
  const choice = await a.present();
  if (choice === -1) return null;
  if (choice === 1) { Keychain.set(SKIP_KEY, "1"); return ""; }
  const key = a.textFieldValue(0).trim();
  if (!key) return null;
  Keychain.set(KEYCHAIN_KEY, key);
  if (Keychain.contains(SKIP_KEY)) Keychain.remove(SKIP_KEY);
  return key;
}

// Asked from the page ("Change API key"): replace or remove the saved key.
async function changeApiKey(ctx) {
  const a = new Alert();
  a.title = "OpenAI API key";
  a.message = ctx.apiKey
    ? "The saved key ends in \u2026" + ctx.apiKey.slice(-4) + ". Paste a new key to replace it."
    : "Paste your key. It's saved in the iOS Keychain on this device only.";
  a.addSecureTextField("sk-…", "");
  a.addAction("Save");
  if (ctx.apiKey) a.addDestructiveAction("Remove saved key");
  a.addCancelAction("Cancel");
  const choice = await a.present();
  if (choice === -1) return { cancelled: true };
  if (choice === 1) {
    Keychain.remove(KEYCHAIN_KEY);
    Keychain.set(SKIP_KEY, "1");
    ctx.apiKey = "";
  } else {
    const key = a.textFieldValue(0).trim();
    if (!key) return { cancelled: true };
    Keychain.set(KEYCHAIN_KEY, key);
    if (Keychain.contains(SKIP_KEY)) Keychain.remove(SKIP_KEY);
    ctx.apiKey = key;
  }
  return accountInfo(ctx);
}

async function accountInfo(ctx) {
  const m = ctx.apiKey ? await fetchModels(ctx.apiKey) : { models: [], status: 0, total: 0, error: null };
  return { hasKey: !!ctx.apiKey, apiKey: ctx.apiKey, models: m.models, error: m.error, status: m.status, total: m.total };
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
    if (msg.type === "openai") result = await callOpenAI(ctx.apiKey, msg.payload);
    else if (msg.type === "changeKey") result = await changeApiKey(ctx);
    else if (msg.type === "models") result = await accountInfo(ctx);
    else if (msg.type === "apple") result = await runAppleShortcut(msg.payload);
    else if (msg.type === "appleText") result = (await runShortcutText(msg.payload.shortcut, msg.payload.text)).text;
    else if (msg.type === "runShortcut") result = await runShortcutText(msg.payload.shortcut, msg.payload.text);
    else if (msg.type === "save") { writeStore(msg.payload); result = true; }
    else if (msg.type === "copy") { Pasteboard.copy(String(msg.payload.text || "")); result = true; }
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

async function callOpenAI(apiKey, body) {
  if (!apiKey) {
    const e = new Error("no OpenAI API key is saved. Tap Change API key to add one");
    e.fatal = true;
    throw e;
  }
  const r = new Request("https://api.openai.com/v1/responses");
  r.method = "POST";
  r.headers = { "Content-Type": "application/json", Authorization: "Bearer " + apiKey };
  r.body = JSON.stringify(body);
  r.timeoutInterval = 90;
  const text = await r.loadString();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { status: r.response.statusCode, data, raw: data ? null : String(text || "").slice(0, 300) };
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

// Only models that clearly can't do this job are hidden: non-chat models (speech,
// embeddings, image generation…), tool-only models and old text-only ones.
const NOT_FOR_THIS = /(embedding|tts|whisper|dall-e|gpt-image|chatgpt-image|sora|moderation|transcribe|realtime|audio|davinci|babbage|codex|computer-use|deep-research|search|-pro\b|gpt-3\.5|instruct|^gpt-4-0|^gpt-4$|o1-mini|o1-preview|o3-mini)/i;

async function fetchModels(apiKey) {
  try {
    const r = new Request("https://api.openai.com/v1/models");
    r.headers = { Authorization: "Bearer " + apiKey };
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    const status = r.response.statusCode;
    if (status !== 200) {
      return { models: [], status, total: 0, error: (j && j.error && j.error.message) || "HTTP " + status };
    }
    const all = j.data || [];
    const models = all
      .filter((m) => /^(gpt-|chatgpt-|o\d)/i.test(m.id) && !NOT_FOR_THIS.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0)) // newest first
      .map((m) => m.id);
    return { models, status, total: all.length, error: null };
  } catch (e) {
    return { models: [], status: 0, total: 0, error: String((e && e.message) || e) };
  }
}

async function main() {
  const apiKey = await getApiKey(RESET_API_KEY);
  if (apiKey === null) return;
  const ctx = { apiKey };
  const m = apiKey ? await fetchModels(apiKey) : { models: [], status: 0, total: 0, error: null };
  const boot = {
    apiKey,
    defaultModel: DEFAULT_MODEL,
    defaultShortcut: DEFAULT_SHORTCUT,
    models: m.models,
    modelsError: m.error,
    modelsStatus: m.status,
    modelsTotal: m.total,
    store: readStore(),
  };
  const wv = new WebView();
  attachBridge(wv, ctx);
  // An https base URL gives the page a secure origin, which the camera API requires.
  await wv.loadHTML(buildHTML(boot), "https://localhost/");
  await wv.present(true);
  await saveOnClose(wv);
}

// ───────────────────────────── Page ─────────────────────────────

function buildHTML(boot) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>VisionX</title>
<style>
:root{
  --paper:#F6F7F9; --surface:#FFFFFF; --ink:#15181D; --graphite:#5B6470;
  --rule:#DDE1E6; --rec:#E5383B; --done:#0F766E; --field:#EEF0F3;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#0E1116; --surface:#161A21; --ink:#E8EBEF; --graphite:#8C96A3;
    --rule:#252B34; --rec:#FF4D4F; --done:#2DD4BF; --field:#1D222B;
    color-scheme:dark;
  }
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink)}
body{
  font:16px/1.45 -apple-system,system-ui,sans-serif;
  padding:calc(env(safe-area-inset-top,0px) + 14px) 16px calc(env(safe-area-inset-bottom,0px) + 32px);
  max-width:720px;margin:0 auto;
}
.num{font-family:ui-rounded,-apple-system,system-ui,sans-serif;font-variant-numeric:tabular-nums}
h1{font:700 28px/1.1 ui-rounded,-apple-system,system-ui,sans-serif;margin:0;letter-spacing:-.01em}
h2{font-size:17px;margin:0 0 6px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.status{display:flex;align-items:center;gap:8px;color:var(--graphite);font-size:14px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--rule)}
.running .dot{background:var(--rec);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.running .dot{animation:none}}

details.settings{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:12px 14px;margin-bottom:14px}
details.settings>summary{font-weight:600;cursor:pointer}
label{display:block;font-size:13px;color:var(--graphite);margin-top:12px}
textarea,input,select{
  display:block;width:100%;margin-top:4px;padding:10px 12px;font:inherit;color:var(--ink);
  background:var(--field);border:1px solid transparent;border-radius:10px;
}
textarea{resize:vertical;min-height:80px}
textarea:focus,input:focus,select:focus{outline:none;border-color:var(--ink)}
:disabled{opacity:.55}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.hint{font-size:12px;color:var(--graphite);margin-top:4px}
.howto{margin-top:10px;font-size:14px}
.howto summary{cursor:pointer;color:var(--ink);font-weight:500}
.howto ol{margin:8px 0 0;padding-left:20px}
.howto li{margin:4px 0}
.switch{display:flex;align-items:center;gap:12px;margin-top:16px;font-size:15px;color:var(--ink);cursor:pointer}
.switch input{
  -webkit-appearance:none;appearance:none;display:inline-block;flex:none;width:46px;height:28px;margin:0;padding:0;
  border:0;border-radius:14px;background:var(--rule);position:relative;cursor:pointer;transition:background .2s
}
.switch input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
.switch input:checked{background:var(--done)}
.switch input:checked::after{transform:translateX(18px)}
.switch input:focus-visible{outline:3px solid var(--done);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.switch input,.switch input::after{transition:none}}
.trigCount{font-weight:400;font-size:13px;color:var(--graphite);margin-left:6px}
.trigList{display:grid;gap:8px;margin-top:10px}
.tItem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--field)}
.tItem .switch,.trow .switch{margin:0;flex:none}
.tItem.off .tText,.trow.off .tbody{opacity:.5}
.trow.off .tdot{background:transparent;border:2px solid var(--rule)}
.tItem .tText{flex:1;min-width:0}
.tItem .chip{flex:none}
.tsub{display:block;font-size:12px;color:var(--graphite);overflow-wrap:anywhere}
.trigForm{margin-top:10px;padding-top:4px;border-top:1px solid var(--rule)}
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
.tcount{flex:none;font:700 20px/1 ui-rounded,-apple-system,system-ui,sans-serif;color:var(--done);font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.trow{transition:none}.trow.checking .tdot,.trow.firing .tdot{animation:none}}
.placeholder{aspect-ratio:4/3;display:grid;place-items:center;color:#9aa3ae;font-size:14px;background:#000}
.presetBar{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.presetBar input{flex:1 1 150px;margin:0;width:auto}
.chip{
  height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--rule);
  background:transparent;color:var(--ink);font:500 14px/1 -apple-system,system-ui,sans-serif;cursor:pointer
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
.zoomRow label{margin:0;font-size:13px;color:var(--graphite);flex:none}
.zoomRow input[type=range]{flex:1;width:auto;margin:0;padding:0;background:transparent;border:0;accent-color:var(--done);height:28px}
.zoomRow output{flex:none;min-width:3.2em;text-align:right;font-weight:600}
.zoomRow .chip{height:30px;padding:0 10px;flex:none}
.zoomHint{font-size:12px;color:var(--graphite);margin:-8px 0 12px}
@media (prefers-reduced-motion:reduce){.liveWrap{transition:none}}
.btn{
  flex:1;height:56px;border:0;border-radius:28px;font:600 17px/1 -apple-system,system-ui,sans-serif;
  color:#fff;background:var(--rec);cursor:pointer;
}
.btn.stop{background:var(--ink);color:var(--paper)}
.btn:focus-visible{outline:3px solid var(--done);outline-offset:3px}
.btn:disabled{opacity:.6}

.strip{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-bottom:14px}
.strip div{padding:10px 4px;text-align:center}
.strip div+div{border-left:1px solid var(--rule)}
.strip b{display:block;font-size:20px}
.strip span{font-size:12px;color:var(--graphite)}

.error{background:color-mix(in srgb,var(--rec) 12%,var(--surface));border-left:4px solid var(--rec);padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:14px}
.hidden{display:none!important}

.muted{color:var(--graphite)}
.tracked{margin:10px 0 0;font-size:13px;color:var(--graphite)}
.tracked pre.old{white-space:pre-wrap;word-break:break-word;background:var(--field);padding:10px;border-radius:8px;font-size:12px;margin:6px 0 0;max-height:240px;overflow:auto}

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
.tag{position:absolute;left:14px;bottom:14px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;padding:3px 8px;border-radius:6px}
/* Latest photo and the running summary, side by side */
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:stretch}
@media (min-width:600px){.hero{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}}
.hero .finder img{max-height:60vh}
.hero .finder .placeholder{aspect-ratio:3/4}
.hero .finder::before,.hero .finder::after,.hero .finder i::before,.hero .finder i::after{width:16px;height:16px;border-width:2px}
.hero .finder::before{top:8px;left:8px}.hero .finder::after{top:8px;right:8px}
.hero .finder i::before{bottom:8px;left:8px}.hero .finder i::after{bottom:8px;right:8px}
.hero .tag{left:10px;bottom:10px;font-size:12px;padding:2px 6px}
.heroSummary{position:relative;min-height:180px;background:var(--surface);border:1px solid var(--rule);border-radius:12px;transition:box-shadow .4s}
.heroSummary .scroll{position:absolute;inset:0;overflow:auto;padding:10px 12px;-webkit-overflow-scrolling:touch}
.heroSummary h2{font-size:13px;font-weight:600;color:var(--graphite);margin:0 0 6px}
.heroSummary p{margin:0;font-size:15px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
.heroSummary .meta{margin:8px 0 0}
.heroSummary.fresh{box-shadow:0 0 0 2px var(--done)}
@media (prefers-reduced-motion:reduce){.heroSummary{transition:none}}
.latestNote .text{margin:10px 2px 0;font-size:15px}
.meta{font-size:12px;color:var(--graphite);margin:8px 2px 0}

.older{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}
.older img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#000}
.older .text{font-size:13px;margin:6px 2px 0;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.text.err{color:var(--rec)}
.text.pending{color:var(--graphite);font-style:italic}

/* End-of-session sheet */
.labelRow{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:12px}
.labelRow label{margin:0}
.labelRow .chips{display:flex;gap:6px;flex:none}
.chip.small{height:30px;padding:0 10px;font-size:13px}
.editor{
  position:fixed;inset:0;z-index:20;background:var(--paper);display:flex;flex-direction:column;overflow:auto;
  padding:calc(env(safe-area-inset-top,0px) + 10px) 16px calc(env(safe-area-inset-bottom,0px) + 20px)
}
.edHead{display:flex;align-items:center;gap:10px}
.edTitles{flex:1;min-width:0;text-align:center}
.edTitles h2{margin:0;font-size:17px}
.edTitles .hint{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#edText{flex:0 0 auto;height:32vh;min-height:180px;margin-top:12px;font-size:16px;line-height:1.5;resize:none}
.edMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;min-height:30px}
.edRefine{margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)}
.edRefine h2{font-size:15px;margin:0}
.edGo{width:100%;margin-top:10px}
.edSuggest{margin-top:12px}
.edProposal{white-space:pre-wrap;background:var(--surface);border:1px solid var(--done);border-radius:10px;padding:10px 12px;margin-top:6px;font-size:15px;line-height:1.45}
:root{--jk:#1d4ed8;--js:#0f766e;--jn:#b45309;--jb:#be185d;--jp:#6b7280}
@media (prefers-color-scheme:dark){:root{--jk:#7cb7ff;--js:#5eead4;--jn:#fbbf24;--jb:#f472b6;--jp:#8c96a3}}
.jk{color:var(--jk)}.js{color:var(--js)}.jn{color:var(--jn)}.jb{color:var(--jb);font-weight:600}.jp{color:var(--jp)}.jl{font-weight:700;color:var(--ink)}
.code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;background:var(--field);color:var(--ink);padding:10px;border-radius:8px;max-height:280px;overflow:auto;margin:4px 0 0}
.code.bad{color:var(--rec)}
#debugBox{margin-top:18px}
.dbgList{display:grid;gap:8px;margin-top:10px}
details.dbg{border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
.dbgHead{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;list-style:none}
.dbgHead::-webkit-details-marker{display:none}
.dbgHead img,.dbgNoImg{width:44px;height:44px;border-radius:6px;object-fit:cover;flex:none;background:#000}
.dbgText{flex:1;min-width:0}
.dbgStatus{flex:none;font-size:12px;font-weight:600;padding:2px 8px;border-radius:10px}
.dbgStatus.good{color:var(--done)}.dbgStatus.bad{color:var(--rec)}.dbgStatus.wait{color:var(--graphite)}
.dbgBody{padding:0 10px 10px}
.dbgBody h3{font-size:12px;font-weight:600;color:var(--graphite);margin:12px 0 0}
.dbgPhoto{display:block;max-width:100%;max-height:40vh;border-radius:6px;margin-top:4px}
details.dbgCheck{margin-top:10px;border-top:1px solid var(--rule);padding-top:6px}
details.dbgCheck>summary{font-size:13px;cursor:pointer}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;z-index:10}
.sheet{
  background:var(--surface);width:100%;max-width:720px;max-height:88vh;overflow:auto;
  border-radius:20px 20px 0 0;padding:20px 18px calc(env(safe-area-inset-bottom,0px) + 20px)
}
.sheet table{width:100%;border-collapse:collapse;margin:12px 0 16px}
.sheet td{padding:7px 0;border-bottom:1px solid var(--rule);font-size:15px}
.sheet td+td{text-align:right}
.sheet .final{white-space:pre-wrap;background:var(--field);padding:12px;border-radius:10px;font-size:14px}
.sheet .btn{width:100%;margin-top:16px;flex:none}
</style>
</head>
<body>
  <div class="top">
    <h1>VisionX</h1>
    <div class="status" id="statusBox"><span class="dot"></span><span id="status">Ready</span></div>
  </div>

  <details class="settings" id="settingsBox" open>
    <summary>What to look for</summary>
    <label for="preset">Preset</label>
    <select id="preset"></select>
    <div class="labelRow">
      <label for="instructions">Instructions for the model</label>
      <div class="chips">
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
      <option value="openai">OpenAI</option>
      <option value="apple">Apple Intelligence (via Shortcuts)</option>
    </select>
    <div id="appleBox" class="hidden">
      <label for="shortcut">Shortcut name</label>
      <input id="shortcut" autocapitalize="off" autocorrect="off" spellcheck="false">
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
      <div class="oa"><label for="model">OpenAI model</label><select id="model"></select>
        <input id="modelCustom" class="hidden" placeholder="Model ID, e.g. gpt-5-mini" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="oa"><label for="detail">Image detail</label><select id="detail"><option value="low">Low (fewest tokens)</option><option value="auto">Auto</option><option value="high">High</option></select></div>
      <div class="oa"><label for="maxSide">Photo size sent</label><select id="maxSide"><option value="512">512 px</option><option value="768">768 px</option><option value="1024">1024 px</option><option value="1536">1536 px</option></select></div>
    </div>
    <div class="oa">
      <div id="modelNote" class="hint"></div>
      <div class="presetBar">
        <button type="button" class="chip" id="kChange">Change API key</button>
        <button type="button" class="chip" id="kRefresh">Reload models</button>
      </div>
      <div id="keyState" class="hint" aria-live="polite"></div>
    </div>
  </details>

  <details class="settings" id="triggersBox">
    <summary>Triggers <span id="trigCount" class="trigCount"></span></summary>
    <div class="hint" id="trigHint"></div>
    <div id="trigList" class="trigList"></div>
    <div class="presetBar"><button type="button" class="chip" id="tAdd">Add trigger</button></div>
    <div id="trigForm" class="trigForm hidden">
      <label for="tName">Name</label>
      <input id="tName" maxlength="40" placeholder="Crowd alert" autocapitalize="sentences">
      <label for="tCond">Condition</label>
      <textarea id="tCond" rows="2" placeholder="More than 3 different people have been seen"></textarea>
      <div class="grid" id="tGrid">
        <div id="tEveryBox"><label for="tEvery">Check every (seconds)</label><input id="tEvery" type="number" min="5" step="1" inputmode="numeric"></div>
        <div><label for="tMode">Run the shortcut</label><select id="tMode">
          <option value="rise">Each time it becomes true</option>
          <option value="once">Only the first time</option>
          <option value="every">Every check while true</option>
        </select></div>
      </div>
      <label for="tShortcut">Shortcut to run</label>
      <input id="tShortcut" placeholder="Exact shortcut name" autocapitalize="off" autocorrect="off" spellcheck="false">
      <label for="tSend">Send to the shortcut</label>
      <select id="tSend">
        <option value="summary">The capture summary</option>
        <option value="custom">A custom message</option>
      </select>
      <div id="tMsgBox" class="hidden">
        <label for="tMsg">Message</label>
        <textarea id="tMsg" rows="2" placeholder="Gate opened for {reason} at {time}"></textarea>
        <div class="hint">Optional placeholders, filled in when the trigger runs: {summary} the capture summary, {reason} why the condition was met, {name} the trigger's name, {time} the time.</div>
      </div>
      <div class="presetBar">
        <button type="button" class="chip primary" id="tSave">Save trigger</button>
        <button type="button" class="chip danger" id="tDelete">Delete trigger</button>
        <button type="button" class="chip" id="tCancel">Cancel</button>
      </div>
      <div id="tHint" class="hint" aria-live="polite"></div>
    </div>
    <div id="checkBox" class="hidden">
      <label for="checkShortcut">Checker shortcut (Apple Intelligence)</label>
      <input id="checkShortcut" autocapitalize="off" autocorrect="off" spellcheck="false">
      <details class="howto">
        <summary>Set up the checker once</summary>
        <ol>
          <li>In Shortcuts, create a shortcut with the name shown above.</li>
          <li>Add <b>Use Model</b> (the cloud model) with <b>Shortcut Input</b> as its prompt.</li>
          <li>Add <b>Stop and Output</b> with the model's <b>Response</b>.</li>
        </ol>
      </details>
    </div>
  </details>

  <div class="control">
    <div class="liveWrap" id="liveWrap"><video id="live" class="live" playsinline muted autoplay></video></div>
    <button id="toggle" class="btn">Start session</button>
  </div>
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

  <section id="trigStatus" class="trigStatus hidden" aria-label="Triggers" aria-live="polite"></section>

  <div id="error" class="error hidden"></div>

  <section class="hero" aria-label="Latest photo and summary">
    <div id="heroPhoto"></div>
    <div class="heroSummary" id="heroSummary">
      <div class="scroll">
        <h2 id="summaryTitle">Summary so far</h2>
        <p id="summary" class="muted" aria-live="polite"></p>
        <div id="summaryMeta" class="meta num"></div>
      </div>
    </div>
  </section>
  <div id="latestNote" class="latestNote"></div>
  <details id="stateBox" class="tracked hidden"><summary>Tracked details</summary><pre id="state" class="code"></pre></details>

  <section id="frames"></section>

  <details class="settings" id="debugBox">
    <summary>Debug <span id="debugCount" class="trigCount"></span></summary>
    <div class="hint">The last 10 photos, each with exactly what was sent to the model and what came back. Kept in memory only and cleared when a new session starts.</div>
    <div class="presetBar"><button type="button" class="chip" id="debugCopy">Copy as JSON</button></div>
    <div id="debugHint" class="hint" aria-live="polite"></div>
    <div id="debugList" class="dbgList"></div>
  </details>

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
      <div class="final" id="mSummary"></div>
      <button class="btn" id="mClose">Done</button>
    </div>
  </div>

  <canvas id="cv" hidden></canvas>
<script>
window.addEventListener("error", function (e) {
  var b = document.getElementById("error");
  if (!b) return;
  b.textContent = "Script error: " + e.message + " (line " + e.lineno + ")";
  b.classList.remove("hidden");
});
</script>
<script>window.BOOT = ${JSON.stringify(boot).replace(/</g, "\\u003c")};</script>
<script>${PAGE_JS}</script>
</body>
</html>`;
}

// Everything below runs inside the WebView. It is kept as a plain string because
// Scriptable returns garbled source from Function.prototype.toString().
// String.raw keeps "\n" escapes intact; this block must contain no backticks or ${.
const PAGE_JS = String.raw`
(function (BOOT) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const API_URL = "https://api.openai.com/v1/responses";
  const modelQuirks = {}; // per model: parameters it rejected, so they aren't sent again
  const REQUEST_TIMEOUT_MS = 90000;
  const KEEP_FRAMES = 3;
  const DEBUG_KEEP = 10; // photos kept in the debug log (memory only)
  const LS_KEY = "vision-session-store-v2";
  const LS_OLD = "vision-session-settings-v1";
  const PRESET_IDS = ["preset", "pUpdate", "pNew", "pDelete", "pName", "pSave", "pCancel", "modelCustom", "kChange", "kRefresh", "iRefine", "iExpand", "applePhotos"];
  const OTHER = "__other";
  // Shown when your model list can't be loaded. Pick "Other model ID…" for anything else.
  const COMMON_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini"];
  const account = {
    hasKey: !!BOOT.apiKey,
    models: BOOT.models || [],
    error: BOOT.modelsError,
    status: BOOT.modelsStatus,
    total: BOOT.modelsTotal || 0,
  };
  const FIELDS = ["instructions", "interval", "engine", "shortcut", "checkShortcut", "model", "detail", "maxSide", "facing"];
  const TRIG_IDS = ["accumulate", "tAdd", "tName", "tCond", "tEvery", "tMode", "tShortcut", "tSend", "tMsg", "tSave", "tDelete", "tCancel"];
  const DEFAULTS = {
    instructions: "Count the different people you see and summarize them: appearance, what they are doing, and when they first appeared.",
    interval: 10,
    model: pickDefaultModel(),
    detail: "auto",
    maxSide: 768,
    facing: "environment",
    zoom: 1,
    engine: BOOT.apiKey ? "openai" : "apple",
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

  populateModels();
  fillForm();
  renderPresets();
  wirePresets();
  updateEngineUI();
  $("engine").addEventListener("change", () => { cfg.engine = $("engine").value; persist(); updateEngineUI(); });
  $("shortcut").addEventListener("change", () => { cfg.shortcut = $("shortcut").value.trim() || DEFAULTS.shortcut; persist(); });
  persist();
  wireAccount();
  wireTriggers();
  wireEditor();
  wireDebug();
  $("applePhotos").addEventListener("change", () => { cfg.applePhotos = $("applePhotos").checked; persist(); });
  wireZoom();
  $("accumulate").addEventListener("change", () => { cfg.accumulate = $("accumulate").checked; persist(); updateModeUI(); });
  updateModeUI();
  $("checkShortcut").addEventListener("change", () => { cfg.checkShortcut = $("checkShortcut").value.trim() || DEFAULTS.checkShortcut; persist(); });
  adoptDefaultModel();
  populateModels();
  renderAll();
  if (account.status === 401) {
    showError("OpenAI rejected the saved API key. Open the settings and tap Change API key.");
  }

  function isApple() { return cfg.engine === "apple"; }
  function updateEngineUI() {
    const apple = isApple();
    document.querySelectorAll(".oa").forEach((n) => n.classList.toggle("hidden", apple));
    $("appleBox").classList.toggle("hidden", !apple);
    $("liveWrap").classList.toggle("hidden", apple);
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

  function pickDefaultModel() {
    const list = BOOT.models || [];
    if (!list.length || list.indexOf(BOOT.defaultModel) !== -1) return BOOT.defaultModel;
    const mini = list.filter((id) => /mini/.test(id) && !/^o\d/.test(id));
    return mini[0] || list[0];
  }

  function populateModels() {
    const sel = $("model");
    const fromAccount = account.models.length > 0;
    const list = fromAccount ? account.models.slice() : COMMON_MODELS.slice();
    const custom = cfg.model && list.indexOf(cfg.model) === -1;
    sel.textContent = "";
    list.forEach((id) => {
      const o = el("option", null, id);
      o.value = id;
      sel.appendChild(o);
    });
    const other = el("option", null, "Other model ID…");
    other.value = OTHER;
    sel.appendChild(other);
    sel.value = custom ? OTHER : cfg.model;
    $("modelCustom").value = custom ? cfg.model : "";
    $("modelCustom").classList.toggle("hidden", !custom);

    let note;
    if (!account.hasKey) note = "No API key saved. Add one with Change API key, or use Apple Intelligence.";
    else if (account.error) note = "Couldn't list your models (" + account.error + "). Showing common models instead.";
    else note = list.length + " chat models from your account (of " + account.total + " in total).";
    $("modelNote").textContent = note;
    $("keyState").textContent = account.hasKey ? "An API key is saved on this device." : "";
  }

  function applyAccount(info) {
    account.hasKey = !!info.hasKey;
    account.models = info.models || [];
    account.error = info.error;
    account.status = info.status;
    account.total = info.total || 0;
    BOOT.apiKey = info.apiKey || "";
    adoptDefaultModel();
    populateModels();
    persist();
  }

  // Until you pick a model yourself, follow what your account actually offers.
  function adoptDefaultModel() {
    if (!account.models.length || account.models.indexOf(cfg.model) !== -1 || cfg.modelChosen) return;
    cfg.model = account.models.indexOf(BOOT.defaultModel) !== -1 ? BOOT.defaultModel : account.models[0];
  }

  function wireAccount() {
    $("model").addEventListener("change", () => {
      const v = $("model").value;
      const isOther = v === OTHER;
      $("modelCustom").classList.toggle("hidden", !isOther);
      if (isOther) { $("modelCustom").focus(); return; }
      cfg.model = v;
      cfg.modelChosen = true;
      persist();
    });
    $("modelCustom").addEventListener("change", () => {
      const v = $("modelCustom").value.trim();
      if (!v) return;
      cfg.model = v;
      cfg.modelChosen = true;
      persist();
    });
    const busy = (b, label) => { b.disabled = !!label; if (label) { b.dataset.label = b.textContent; b.textContent = label; } else if (b.dataset.label) b.textContent = b.dataset.label; };
    $("kChange").addEventListener("click", async () => {
      busy($("kChange"), "Waiting for the key…");
      try {
        const info = await nativeCall("changeKey", null, 600000);
        if (info && !info.cancelled) {
          applyAccount(info);
          hideError();
          $("keyState").textContent = info.hasKey ? "Key saved. Models reloaded." : "Key removed.";
        }
      } catch (e) {
        $("keyState").textContent = "Couldn't change the key: " + e.message;
      } finally {
        busy($("kChange"));
      }
    });
    $("kRefresh").addEventListener("click", async () => {
      busy($("kRefresh"), "Loading…");
      try {
        applyAccount(await nativeCall("models", null, 30000));
      } catch (e) {
        $("modelNote").textContent = "Couldn't reload models: " + e.message;
      } finally {
        busy($("kRefresh"));
      }
    });
  }
  $("toggle").addEventListener("click", () => (S.running ? endSession() : startSession()));
  $("mClose").addEventListener("click", () => $("modal").classList.add("hidden"));

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
    FIELDS.forEach((k) => { if (k !== "model") $(k).value = String(cfg[k]); });
    $("accumulate").checked = cfg.accumulate !== false;
    $("applePhotos").checked = cfg.applePhotos !== false;
    populateModels();
  }
  function isMoment() { return cfg.accumulate === false; }
  function updateModeUI() {
    const moment = isMoment();
    $("accHint").textContent = moment
      ? "Off: each photo is judged on its own and nothing carries over. The summary shows only the latest moment, and triggers are checked against every photo as it's analyzed."
      : "On: each photo adds to one running summary for the whole session. Triggers check that summary on their own schedule.";
    $("summaryTitle").textContent = moment ? "Right now" : "Summary so far";
    $("checkBox").classList.toggle("hidden", !isApple() || moment);
    $("tEveryBox").classList.toggle("hidden", moment);
    $("tGrid").style.gridTemplateColumns = moment ? "1fr" : "";
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
      model: ($("model").value === OTHER ? $("modelCustom").value.trim() : $("model").value) || cfg.model || DEFAULTS.model,
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

  async function startSession() {
    if (starting) return;
    starting = true;
    $("toggle").disabled = true;
    readForm();
    hideError();
    S = newSession();
    renderAll();
    if (!isApple() && !account.hasKey) {
      showError("OpenAI needs an API key. Open the settings and tap Change API key, or switch to Apple Intelligence.");
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
    initTriggerState(S);
    renderTriggerStatus();
    starting = false;
    $("toggle").disabled = false;
    $("settingsBox").open = false;
    setFormDisabled(true);
    updateToggle();
    clock = setInterval(tickClock, 500);
    loop(S);
  }

  async function endSession() {
    const sess = S;
    if (!sess.running) return;
    sess.running = false;
    sess.stats.end = Date.now();
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
    showModal();
  }

  async function loop(sess) {
    while (sess.running) {
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
    const frame = { idx: ++sess.seq, img, time: new Date().toLocaleTimeString(), pending: true };
    sess.frames.unshift(frame);
    if (sess.frames.length > KEEP_FRAMES) sess.frames.length = KEEP_FRAMES; // older photos dropped from memory
    sess.busyIdx = frame.idx;
    renderAll(); tickClock();

    sess.stats.requests++;
    const dbg = addDebug(sess, frame, "OpenAI");
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
      if (isMoment()) handleMomentVerdicts(sess, result.triggers);
      if (sess === S) hideError();
    } catch (e) {
      frame.error = e.message;
      if (e.cancelled) sess.stats.cancelled++;
      else sess.stats.failed++;
      dbg.error = e.message;
      if (e.attempts) { dbg.attempts = e.attempts; dbg.dropped = e.dropped || []; }
      if (e.fatal) sess.fatal = "OpenAI request stopped the session: " + e.message;
      else if (!e.cancelled && sess === S) showError("Photo #" + frame.idx + " wasn't analyzed: " + e.message + ". The session keeps going.");
    } finally {
      dbg.ms = Date.now() - t0;
      frame.pending = false;
      sess.busyIdx = 0;
      if (sess === S) renderAll();
    }
  }

  async function shootApple(sess) {
    const frame = { idx: ++sess.seq, img: null, time: new Date().toLocaleTimeString(), pending: true };
    sess.frames.unshift(frame);
    if (sess.frames.length > KEEP_FRAMES) sess.frames.length = KEEP_FRAMES;
    sess.busyIdx = frame.idx;
    renderAll(); tickClock();
    sess.stats.requests++;
    const dbg = addDebug(sess, frame, "Apple Intelligence");
    const t0 = Date.now();
    try {
      const prompt = systemPrompt(true) + "\n\n" + frameContext(sess, frame) + "\n\nThe photo for this frame is attached.";
      dbg.request = { prompt: prompt };
      const wantPhoto = cfg.applePhotos !== false;
      frame.noPhoto = !wantPhoto;
      const r = await withShortcutLock(() => nativeCall("apple", { shortcut: cfg.shortcut, prompt: prompt, wantPhoto: wantPhoto }, 180000));
      if (r.photo) frame.img = r.photo;
      if (r.photo || (!wantPhoto && r.text)) sess.stats.photos++;
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
      if (isMoment()) handleMomentVerdicts(sess, result.triggers);
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

  function buildBody(sess, frame) {
    const body = {
      model: cfg.model,
      instructions: systemPrompt(),
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: frameContext(sess, frame) },
          { type: "input_image", image_url: frame.img, detail: cfg.detail },
        ],
      }],
      max_output_tokens: 4000,
      store: false,
    };
    return withModelOptions(body);
  }

  function withModelOptions(body) {
    const q = modelQuirks[body.model] || {};
    if (!q.noJson) body.text = { format: { type: "json_object" } };
    // Reasoning models think before answering; keep that short for a live feed.
    if (!q.noReasoning && /^(o\d|gpt-5|gpt-6)/i.test(body.model) && !/chat/i.test(body.model)) {
      body.reasoning = { effort: "low" };
    }
    return body;
  }

  // ── debug log: the last 10 photos with what was sent and what came back ──
  // Kept in memory only (never written to disk) and cleared when a session starts.

  function addDebug(sess, frame, engine) {
    const entry = {
      id: "d-" + frame.idx, idx: frame.idx, time: frame.time, frame: frame,
      engine: engine, model: engine === "OpenAI" ? cfg.model : cfg.shortcut,
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
    const box = $("debugList");
    const list = S.debug || [];
    $("debugCount").textContent = list.length ? list.length + " of " + DEBUG_KEEP : "";
    $("debugCopy").disabled = !list.length;
    const open = new Set(Array.from(box.querySelectorAll("details.dbg[open]")).map((d) => d.dataset.id));
    box.textContent = "";
    if (!list.length) {
      box.appendChild(el("div", "hint", "Start a session to see exactly what is sent to the model and what comes back for each photo."));
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
      d.appendChild(el("summary", null, "Trigger check: " + c.trigger + " at " + c.time + (c.error ? " (error)" : c.verdict ? (c.verdict.met ? " (met)" : " (not met)") : "")));
      const inner = el("div");
      const add = (title, node) => { inner.appendChild(el("h3", null, title)); inner.appendChild(node); };
      add("Sent", codeBlock(highlightMixed(c.prompt)));
      if (c.raw) add("Reply as received", codeBlock(highlightMixed(c.raw)));
      if (c.verdict) add("Reply as understood", codeBlock(highlightJSON(JSON.stringify(c.verdict, null, 2))));
      if (c.error) add("Error", codeBlock(escHTML(c.error), "bad"));
      d.appendChild(inner);
      body.appendChild(d);
    });
  }

  function debugExport() {
    return JSON.stringify((S.debug || []).map((e) => ({
      photo: "#" + e.idx, time: e.time, engine: e.engine, model: e.model, summary_mode: e.mode,
      image: imageInfo(e.frame.img), seconds: e.ms ? +(e.ms / 1000).toFixed(2) : null,
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

  function refinePrompt(current, ask) {
    return [
      "You improve instructions for a vision model. The model looks at photos from a live phone camera, one photo every few seconds, and answers by following these instructions.",
      isMoment()
        ? "Each photo is judged on its own, so the instructions should say what to report about a single moment."
        : "Each photo is merged into one running summary for the whole session, so the instructions should say what to track and count over time.",
      "",
      "Rewrite the instructions so they are clear, specific and unambiguous: what to look for, what to count or track, what to ignore, and how to phrase the answer (concise).",
      "Keep the user's intent, any names, numbers or plates they gave, and the language they wrote in. Don't add output-format or JSON rules; the app adds those. Don't invent requirements the user didn't imply.",
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

  async function refineInstructions(ask) {
    const current = $("edText").value.trim();
    if (!current) { $("edStatus").textContent = "Write some instructions first."; $("edText").focus(); return; }
    if (refining) return;
    refining = true;
    const buttons = document.querySelectorAll("#editor .edRefine button, #edUse, #edKeep");
    buttons.forEach((b) => { b.disabled = true; });
    $("edSuggest").classList.add("hidden");
    $("edStatus").textContent = "Refining…";
    try {
      const prompt = refinePrompt(current, ask);
      let reply, via;
      if (account.hasKey) {
        const r = await openaiRequest({ running: true }, () => withModelOptions({
          model: cfg.model,
          input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
          max_output_tokens: 2000,
          store: false,
        }));
        reply = r.text;
        via = cfg.model + (r.usage.total_tokens ? ", " + fmtNum(r.usage.total_tokens) + " tokens" : "");
      } else if (isApple()) {
        reply = await withShortcutLock(() => nativeCall("appleText", { shortcut: cfg.checkShortcut, text: prompt }, 180000));
        via = "Apple Intelligence";
      } else {
        throw new Error("add an OpenAI API key, or switch to Apple Intelligence");
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
        (!account.hasKey && isApple() ? ". Refining with Apple Intelligence uses the checker shortcut (see Triggers)." : ".");
    } finally {
      refining = false;
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  function wireEditor() {
    $("iExpand").addEventListener("click", () => openEditor(false));
    $("iRefine").addEventListener("click", () => openEditor(true));
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

  function triggerPrompt(sess, t) {
    const started = new Date(sess.stats.start);
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
      "",
      "Judge only from this information. If it isn't enough to tell, the condition is not met.",
      'Respond with JSON only: {"met": true or false, "reason": "one short sentence"}',
    ].join("\n");
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
    rowEls = {};
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
      if (st.off || st.busy || st.done || now < st.nextAt) return;
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
    const prompt = triggerPrompt(sess, st.t);
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
        const r = await openaiRequest(sess, () => withModelOptions({
          model: cfg.model,
          input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
          max_output_tokens: 1500,
          store: false,
        }));
        sess.stats.prompt += r.usage.prompt_tokens || 0;
        sess.stats.completion += r.usage.completion_tokens || 0;
        sess.stats.total += r.usage.total_tokens || 0;
        log.raw = r.text;
        verdict = parseVerdict(r.text);
      }
      log.verdict = verdict;
      if (!sess.running) return;
      await applyVerdict(sess, st, verdict);
    } catch (e) {
      log.error = e.message;
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
  async function applyVerdict(sess, st, verdict) {
    sess.stats.checks++;
    st.checks++;
    st.reason = verdict.reason;
    st.error = "";
    const mode = st.t.mode || "rise";
    const fire = verdict.met && (mode === "every" || (mode === "rise" && st.armed) || (mode === "once" && !st.fired));
    if (!verdict.met) st.armed = true;
    if (!fire) {
      st.status = verdict.met ? "met" : "notmet";
      return;
    }
    st.status = "firing";
    renderTriggerStatus();
    const text = shortcutInput(sess, st);
    await withShortcutLock(() => nativeCall("runShortcut", { shortcut: st.t.shortcut, text: text }, 600000));
    st.fired++;
    sess.stats.fired++;
    st.armed = false;
    st.firedAt = new Date().toLocaleTimeString();
    st.flashUntil = Date.now() + 2500;
    st.status = "fired";
    if (mode === "once") st.done = true;
  }

  // What the trigger's shortcut receives as Shortcut Input.
  function shortcutInput(sess, st) {
    if (st.t.send !== "custom") return sess.summary;
    const values = {
      summary: sess.summary || "",
      reason: st.reason || "",
      name: st.t.name,
      time: new Date().toLocaleTimeString(),
    };
    return String(st.t.message || "").replace(/\{(summary|reason|name|time)\}/gi, (m, key) => values[key.toLowerCase()]);
  }

  // Fresh mode: the photo's own answer says which conditions are met right now.
  function handleMomentVerdicts(sess, verdicts) {
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
      applyVerdict(sess, st, v)
        .catch((e) => { if (!e.cancelled) { st.status = "error"; st.error = e.message; } })
        .finally(() => { st.busy = false; if (sess === S) renderTriggerStatus(); });
    });
    if (sess === S) renderTriggerStatus();
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

  function renderTriggerStatus() {
    const box = $("trigStatus");
    const sess = S;
    box.classList.toggle("hidden", !sess.trigOrder.length);
    if (Object.keys(rowEls).length !== sess.trigOrder.length) {
      box.textContent = "";
      rowEls = {};
      sess.trigOrder.forEach((id) => {
        const st = sess.trig[id];
        const r = { row: el("div", "trow"), name: el("b", null, st.t.name), sub: el("span", "tsub"), count: el("span", "tcount") };
        const body = el("div", "tbody");
        body.append(r.name, r.sub);
        r.sw = makeSwitch(!st.off, "Trigger " + st.t.name + " on", (on) => setTriggerEnabled(id, on));
        r.row.append(el("span", "tdot"), body, r.count, r.sw.wrap);
        r.row.title = st.t.condition;
        box.appendChild(r.row);
        rowEls[id] = r;
      });
    }
    const now = Date.now();
    sess.trigOrder.forEach((id) => {
      const st = sess.trig[id];
      const r = rowEls[id];
      const cls = ["trow", st.off ? "off" : st.status];
      if (st.fired) cls.push("lit");
      if (st.flashUntil > now) cls.push("flash");
      r.row.className = cls.join(" ");
      const next = Math.max(0, Math.ceil((st.nextAt - now) / 1000));
      let line;
      switch (st.status) {
        case "idle": line = !sess.running ? "Not checked." : isMoment() ? "Checked with every photo. Waiting for the next one." : "First check in " + next + " s."; break;
        case "waiting": line = "Waiting for the first summary."; break;
        case "checking": line = "Checking the condition…"; break;
        case "firing": line = "Condition met. Running \u201C" + st.t.shortcut + "\u201D…"; break;
        case "notmet": line = "Not met: " + st.reason; break;
        case "met": line = "Still met, already ran: " + st.reason; break;
        case "fired": line = "Ran \u201C" + st.t.shortcut + "\u201D at " + st.firedAt + ": " + st.reason; break;
        case "error": line = "Problem: " + st.error; break;
        default: line = "";
      }
      line = String(line).trim();
      if (line && !/[.!?…]$/.test(line)) line += ".";
      if (st.off) line = "Off." + (st.fired ? " Ran " + st.fired + (st.fired === 1 ? " time" : " times") + " before." : "");
      else if (st.done) line += " Done for this session.";
      else if (sess.running && !isMoment() && !st.busy && st.status !== "idle" && st.status !== "waiting") line += " Next check in " + next + " s.";
      r.sub.textContent = line;
      r.count.textContent = st.fired ? st.fired + "\u00D7" : "";
      r.count.classList.toggle("hidden", !st.fired);
      if (r.sw.input.checked === st.off) r.sw.input.checked = !st.off;
      r.sw.wrap.classList.toggle("hidden", !sess.running);
    });
  }

  function renderTriggerList() {
    const box = $("trigList");
    box.textContent = "";
    if (!triggers.length) box.appendChild(el("div", "hint", "No triggers yet. Example: \u201CSomeone is holding a phone\u201D runs a shortcut that sends you a notification."));
    triggers.forEach((t) => {
      const row = el("div", "tItem" + (t.enabled === false ? " off" : ""));
      const sw = makeSwitch(t.enabled !== false, "Trigger " + t.name + " on", (on) => setTriggerEnabled(t.id, on));
      const txt = el("div", "tText");
      const modeText = { rise: "each time it becomes true", once: "only the first time", every: "every check while true" }[t.mode || "rise"];
      txt.append(el("b", null, t.name), el("span", "tsub", t.condition), el("span", "tsub", (isMoment() ? "Checked with every photo" : "Checks every " + t.every + " s") + "; runs \u201C" + t.shortcut + "\u201D " + modeText + ", sending " + (t.send === "custom" ? "a custom message" : "the summary") + "."));
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

  function openTriggerForm(id) {
    const t = triggers.find((x) => x.id === id) || { name: "", condition: "", every: 30, mode: "rise", shortcut: "", send: "summary", message: "" };
    editingTrigger = id || null;
    $("tName").value = t.name;
    $("tCond").value = t.condition;
    $("tEvery").value = String(t.every);
    $("tMode").value = t.mode || "rise";
    $("tShortcut").value = t.shortcut;
    $("tSend").value = t.send === "custom" ? "custom" : "summary";
    $("tMsg").value = t.message || "";
    $("tMsgBox").classList.toggle("hidden", $("tSend").value !== "custom");
    $("tDelete").classList.toggle("hidden", !id);
    $("tHint").textContent = "";
    $("trigForm").classList.remove("hidden");
    $("tName").focus();
  }

  function wireTriggers() {
    $("tAdd").addEventListener("click", () => openTriggerForm(null));
    $("tCancel").addEventListener("click", () => $("trigForm").classList.add("hidden"));
    $("tSend").addEventListener("change", () => {
      const custom = $("tSend").value === "custom";
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
      const data = { name: name, condition: condition, shortcut: shortcut, every: every, mode: $("tMode").value, send: send, message: message };
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
    const r = await openaiRequest(sess, () => {
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
    const content = (body.input && body.input[0] && body.input[0].content) || [];
    const textPart = content.find((c) => c.type === "input_text");
    const imgPart = content.find((c) => c.type === "input_image");
    return {
      instructions: body.instructions || "",
      text: textPart ? textPart.text : "",
      settings: {
        model: body.model,
        image: imgPart ? { size: imageInfo(imgPart.image_url), detail: imgPart.detail } : null,
        max_output_tokens: body.max_output_tokens,
        json_format: !!body.text,
        reasoning: body.reasoning ? body.reasoning.effort : null,
        store: body.store,
      },
    };
  }

  // If a model rejects an optional parameter, drop it and try again.
  async function openaiRequest(sess, makeBody) {
    const dropped = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = makeBody();
      try {
        const r = await sendOpenAI(sess, body);
        return Object.assign(r, { body: body, attempts: attempt + 1, dropped: dropped });
      } catch (e) {
        e.attempts = attempt + 1;
        e.dropped = dropped;
        if (e.status !== 400 || !sess.running) throw e;
        const q = (modelQuirks[cfg.model] = modelQuirks[cfg.model] || {});
        const what = String(e.param || "") + " " + e.message;
        if (body.reasoning && /reasoning/i.test(what)) { q.noReasoning = true; dropped.push("reasoning (" + e.message + ")"); continue; }
        if (body.text && /(text\.format|json_object|response_format)/i.test(what)) { q.noJson = true; dropped.push("JSON format (" + e.message + ")"); continue; }
        throw e;
      }
    }
    throw new Error("the model rejected the request");
  }

  // Normal path: Scriptable sends the request natively (no WebView network limits).
  async function sendOpenAI(sess, body) {
    let r;
    try {
      r = await nativeCall("openai", body, REQUEST_TIMEOUT_MS);
    } catch (e) {
      if (e.bridgeDown) return analyzeDirect(sess, body);
      throw e;
    }
    return interpretOpenAI(r.status, r.data, r.raw);
  }

  function interpretOpenAI(status, data, raw) {
    if (status < 200 || status >= 300 || !data) {
      const apiErr = (data && data.error) || {};
      const err = new Error(apiErr.message || ("HTTP " + status + (raw ? ": " + raw : "")));
      err.status = status;
      err.param = apiErr.param;
      err.fatal = [401, 403, 404].includes(status) || apiErr.code === "insufficient_quota" || apiErr.code === "model_not_found";
      throw err;
    }
    const parts = [];
    (data.output || []).forEach((item) => {
      (item.content || []).forEach((c) => { if (c.type === "output_text" && c.text) parts.push(c.text); });
    });
    const content = parts.join("") || data.output_text || "";
    if (!content) {
      const why = data.status === "incomplete"
        ? "the model stopped early (" + ((data.incomplete_details && data.incomplete_details.reason) || "incomplete") + ")"
        : "the model returned no text";
      throw new Error(why);
    }
    const u = data.usage || {};
    return {
      text: content,
      usage: { prompt_tokens: u.input_tokens || 0, completion_tokens: u.output_tokens || 0, total_tokens: u.total_tokens || 0 },
    };
  }

  // Fallback if the bridge isn't working: call OpenAI straight from the WebView.
  async function analyzeDirect(sess, body) {
    const ctrl = new AbortController();
    sess.ctrl = ctrl;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + BOOT.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (_) {}
      return interpretOpenAI(res.status, data, null);
    } catch (e) {
      if (e.name === "AbortError") {
        const err = new Error(timedOut ? "request timed out" : "cancelled when the session ended");
        err.cancelled = !timedOut;
        throw err;
      }
      if (e.name === "TypeError") throw new Error("the WebView couldn't reach OpenAI (" + (e.message || "TypeError") + ")");
      throw e;
    } finally {
      clearTimeout(timer);
      if (sess.ctrl === ctrl) sess.ctrl = null;
    }
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
    const src = String(raw || "").replace(/\x60{3}(?:json)?/gi, "");
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
      if (ms <= 0 || !sess.running) return resolve();
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
    runDueTriggers(S);
    if (S.trigOrder.length) renderTriggerStatus();
    if (S.busyIdx) setStatus((isApple() ? "Running the shortcut for photo #" : "Analyzing photo #") + S.busyIdx + "…");
    else if (S.nextAt) setStatus("Next photo in " + Math.max(0, Math.ceil((S.nextAt - Date.now()) / 1000)) + " s");
  }

  // ── rendering ──
  function renderAll() { renderStats(); renderSummary(); renderFrames(); renderDebug(); }

  function renderStats() {
    const st = S.stats;
    const end = S.running ? Date.now() : st.end || st.start;
    $("sElapsed").textContent = fmtDur(st.start ? end - st.start : 0);
    $("sPhotos").textContent = st.photos;
    $("sReq").textContent = st.requests;
    $("sTok").textContent = isApple() ? "–" : fmtNum(st.total);
  }

  function renderSummary() {
    const p = $("summary");
    if (S.summary) { p.textContent = S.summary; p.classList.remove("muted"); }
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
    const [latest, ...older] = S.frames;

    // Latest photo, left of the summary
    const hp = $("heroPhoto");
    hp.textContent = "";
    const finder = el("div", "finder");
    if (latest) finder.append(photoView(latest), el("i"), el("span", "tag num", "#" + latest.idx + "  " + latest.time));
    else finder.append(el("div", "placeholder", S.running ? "First photo coming…" : "No photo yet"), el("i"));
    hp.appendChild(finder);

    // What the latest photo itself showed, under the pair
    const note = $("latestNote");
    note.textContent = "";
    if (latest) noteParts(latest, true).forEach((n) => note.appendChild(n));

    // The two photos before it
    const box = $("frames");
    box.textContent = "";
    if (older.length) {
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
    out.push(el("p", cls, f.pending ? "Analyzing…" : f.error ? "Not analyzed: " + f.error : lead + f.text));
    const bits = [];
    if (!big) bits.push("#" + f.idx + ", " + f.time);
    if (f.tokens) bits.push(fmtNum(f.tokens) + " tokens");
    if (f.ms) bits.push((f.ms / 1000).toFixed(1) + " s");
    if (bits.length) out.push(el("div", "meta num", bits.join(", ")));
    return out;
  }

  function showModal() {
    const st = S.stats;
    const rows = [
      ["Duration", fmtDur(st.end - st.start)],
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
      ["Analyzed with", isApple() ? "Apple Intelligence (" + cfg.shortcut + ")" : cfg.model],
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
    $("mSummary").textContent = S.summary || "No photo was analyzed in this session.";
    $("modal").classList.remove("hidden");
    $("mClose").focus();
  }

  function updateToggle() {
    const b = $("toggle");
    b.textContent = S.running ? "End session" : "Start session";
    b.classList.toggle("stop", S.running);
    $("statusBox").classList.toggle("running", S.running);
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
})(window.BOOT);
`;

try {
  await main();
} catch (e) {
  const a = new Alert();
  a.title = "Vision Session failed to start";
  a.message = String((e && e.message) || e);
  a.addAction("OK");
  await a.present();
}
Script.complete();
