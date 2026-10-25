// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: download;

/*
  VisionX installer for Scriptable.
  Downloads the latest VisionX.js from GitHub into your Scriptable scripts.
  Run it again any time to update. Presets, triggers, settings and your
  API key are stored separately and are kept.
  https://github.com/gadominas/VisionX
*/

const VISIONX_URL = "https://raw.githubusercontent.com/gadominas/VisionX/main/VisionX.js";
const VISIONX_NAME = "VisionX";

async function say(title, message, openLabel) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  if (openLabel) a.addAction(openLabel);
  a.addCancelAction(openLabel ? "Later" : "OK");
  return (await a.present()) === 0;
}

// Install next to this script, in iCloud or on the device, wherever your scripts live.
function scriptsFolder() {
  const here = module.filename;
  const dir = here.slice(0, here.lastIndexOf("/"));
  try {
    const icloud = FileManager.iCloud();
    if (icloud.fileExists(here)) return { fm: icloud, dir };
  } catch (_) {}
  return { fm: FileManager.local(), dir };
}

async function installVisionX() {
  const req = new Request(VISIONX_URL);
  req.timeoutInterval = 30;
  let code;
  try {
    code = await req.loadString();
  } catch (e) {
    await say("Couldn't download VisionX", "Check your internet connection and try again.\n\n" + e.message);
    return;
  }
  const status = req.response && req.response.statusCode;
  if (status !== 200 || code.indexOf("VisionX") === -1) {
    await say("Couldn't download VisionX", "GitHub answered with HTTP " + status + ". Try again in a moment.");
    return;
  }

  const { fm, dir } = scriptsFolder();
  const path = fm.joinPath(dir, VISIONX_NAME + ".js");
  const existed = fm.fileExists(path);
  if (existed) {
    if (fm.isFileStoredIniCloud(path) && !fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
    if (fm.readString(path) === code) {
      if (await say("VisionX is up to date", "You already have the latest version.", "Open VisionX")) openVisionX();
      return;
    }
  }
  fm.writeString(path, code);
  const title = existed ? "VisionX updated" : "VisionX installed";
  const msg = existed
    ? "You now have the latest version. Your presets, triggers and settings are kept."
    : "It's in your script list. On first run, paste an OpenAI API key or choose Apple Intelligence.";
  if (await say(title, msg, "Open VisionX")) openVisionX();
}

function openVisionX() {
  Safari.open("scriptable:///run/" + encodeURIComponent(VISIONX_NAME));
}

await installVisionX();
