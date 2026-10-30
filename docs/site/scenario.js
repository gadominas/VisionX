// Screenshot scenario for VisionX (repo-site, app-blueprints).
//
//   node ../app-blueprints/repo-site/tools/capture.js .            # every card
//   node ../app-blueprints/repo-site/tools/capture.js . --only=01-gate
//
// The camera is faked in the page: getUserMedia returns a canvas stream of a drawn test scene
// (a driveway gate or a car-park barrier with cars on invented plates). Each photo VisionX takes
// moves the scene on to the next car, and the AI replies below follow the same order, so every
// screen is the app's real interface with deterministic sample data. Nothing reaches the internet.

'use strict';
const fs = require('fs');
// Widget runs format times in Node: give Node the scenario's time zone too (the pages already have it).
process.env.TZ = 'Europe/Vilnius';
const path = require('path');

const NOW = Date.UTC(2026, 9, 29, 6, 12);            // Thursday 29 October 2026, 08:12 in Vilnius (UTC+2)
const at = (h, m, s = 0, dayOffset = 0) => Date.UTC(2026, 9, 29 + dayOffset, h - 2, m, s);   // Vilnius local time
const MIN = 60e3;

const LOCAL = '/var/mobile/Containers/Data/Application/SCRIPTABLE/Documents';
const ICLOUD = '/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents';
const SES = LOCAL + '/VisionX-sessions';
const MODEL = 'claude-haiku-5-5';
const ENGINE = 'Claude — ' + MODEL;

// ───────── The drawn test scene (720 × 960, portrait like a phone camera) ─────────
const CARS = {
  grey:  { plate: 'KXA 482', type: 'hatchback', colour: 'grey',  body: '#8C939C', dark: '#5E656E' },
  red:   { plate: 'LMN 215', type: 'sedan',     colour: 'red',   body: '#B8322F', dark: '#7E1F1D' },
  van:   { plate: 'BTR 907', type: 'van',       colour: 'white', body: '#E6E9EC', dark: '#A9B0B7' },
  blue:  { plate: 'GZA 318', type: 'SUV',       colour: 'blue',  body: '#2F5CA8', dark: '#1F3F78' },
  green: { plate: 'MRV 640', type: 'estate',    colour: 'green', body: '#3F7A55', dark: '#2A553A' },
};

function carSVG(c) {
  const cx = 360, g = 880;
  const W = { hatchback: 380, sedan: 400, estate: 400, SUV: 440, van: 450 }[c.type];
  const bodyH = { van: 190, SUV: 175 }[c.type] || 150;
  const roof = { van: 420, SUV: 340, hatchback: 310 }[c.type] || 300;
  const cabW = c.type === 'van' ? 0.46 : 0.37, topW = c.type === 'van' ? 0.42 : 0.27;
  const top = g - 60 - bodyH;   // where the body meets the cabin
  const x0 = cx - W / 2;
  return `
  <ellipse cx="${cx}" cy="${g + 4}" rx="${W / 2 + 34}" ry="24" fill="rgba(0,0,0,.35)"/>
  <rect x="${x0 + 22}" y="${g - 80}" width="64" height="80" rx="14" fill="#1C1E21"/>
  <rect x="${x0 + W - 86}" y="${g - 80}" width="64" height="80" rx="14" fill="#1C1E21"/>
  <path d="M${cx - W * cabW} ${top + 10} L${cx - W * topW} ${g - roof} Q${cx} ${g - roof - 12} ${cx + W * topW} ${g - roof} L${cx + W * cabW} ${top + 10} Z" fill="${c.dark}"/>
  <path d="M${cx - W * cabW + 22} ${top + 6} L${cx - W * topW + 14} ${g - roof + 16} L${cx + W * topW - 14} ${g - roof + 16} L${cx + W * cabW - 22} ${top + 6} Z" fill="#26343F"/>
  <path d="M${cx - W * topW + 40} ${g - roof + 22} L${cx - W * topW + 90} ${g - roof + 22} L${cx - W * cabW + 90} ${top} L${cx - W * cabW + 40} ${top} Z" fill="rgba(255,255,255,.14)"/>
  <rect x="${x0 - 14}" y="${top - 8}" width="30" height="20" rx="6" fill="${c.dark}"/>
  <rect x="${x0 + W - 16}" y="${top - 8}" width="30" height="20" rx="6" fill="${c.dark}"/>
  <rect x="${x0}" y="${top}" width="${W}" height="${bodyH}" rx="36" fill="${c.body}"/>
  <rect x="${x0 + 26}" y="${top + 26}" width="${W * 0.22}" height="28" rx="12" fill="#F6F2D2"/>
  <rect x="${x0 + W - 26 - W * 0.22}" y="${top + 26}" width="${W * 0.22}" height="28" rx="12" fill="#F6F2D2"/>
  <rect x="${cx - 74}" y="${top + 24}" width="148" height="34" rx="10" fill="#1F2326"/>
  <rect x="${x0 + 10}" y="${top + bodyH - 34}" width="${W - 20}" height="30" rx="14" fill="${c.dark}"/>
  <rect x="${cx - 86}" y="${top + bodyH - 74}" width="172" height="42" rx="5" fill="#FFFFFF" stroke="#222" stroke-width="2"/>
  <rect x="${cx - 86}" y="${top + bodyH - 74}" width="22" height="42" rx="4" fill="#1F4FBF"/>
  <text x="${cx + 11}" y="${top + bodyH - 43}" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#111" letter-spacing="1">${c.plate}</text>`;
}

function sceneSVG(o = {}) {
  const kind = o.kind || 'gate';
  let bars = '';
  for (let x = 166; x < 560; x += 24) bars += `<rect x="${x}" y="330" width="9" height="215" fill="#2B3036"/>`;
  const gate = `<g transform="translate(${o.open ? -405 : 0} 0)"><rect x="150" y="342" width="420" height="10" fill="#2B3036"/><rect x="150" y="522" width="420" height="10" fill="#2B3036"/>${bars}</g>
    <rect x="128" y="290" width="26" height="270" rx="3" fill="#23272C"/><rect x="566" y="290" width="26" height="270" rx="3" fill="#23272C"/>
    <rect x="566" y="380" width="26" height="40" fill="#E5383B" opacity=".0"/>`;
  let stripes = '';
  for (let x = 110; x < 720; x += 60) stripes += `<rect x="${x}" y="462" width="30" height="18" fill="#D33A35"/>`;
  const barrier = `<rect x="70" y="400" width="44" height="150" rx="6" fill="#E9E5DA"/><rect x="74" y="420" width="36" height="12" fill="#D33A35"/>
    <rect x="100" y="462" width="620" height="18" rx="4" fill="#F4F4F2"/>${stripes}
    <rect x="590" y="240" width="76" height="76" rx="12" fill="#1F4FBF"/><text x="628" y="300" font-family="Helvetica, Arial, sans-serif" font-size="60" font-weight="700" text-anchor="middle" fill="#fff">P</text>
    <rect x="624" y="316" width="8" height="200" fill="#8A9097"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8DB8E2"/><stop offset="1" stop-color="#D9E6F1"/></linearGradient>
  <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7A7F86"/><stop offset="1" stop-color="#5C6168"/></linearGradient></defs>
  <rect width="720" height="960" fill="url(#sky)"/>
  <circle cx="60" cy="380" r="90" fill="#46714A"/><circle cx="180" cy="350" r="80" fill="#3F6A43"/><circle cx="560" cy="355" r="85" fill="#3F6A43"/><circle cx="690" cy="375" r="95" fill="#46714A"/><circle cx="360" cy="390" r="70" fill="#4C7A4C"/>
  <rect x="0" y="420" width="720" height="540" fill="#5E8A4F"/>
  <rect x="0" y="430" width="720" height="110" fill="#3D6A3A"/>
  <path d="M250 520 L470 520 L720 960 L0 960 Z" fill="url(#road)"/>
  <path d="M360 560 L360 600 M360 660 L360 720" stroke="#D8D8D2" stroke-width="6" stroke-linecap="round" opacity=".6"/>
  ${kind === 'barrier' ? barrier : gate}
  ${o.car ? '<g transform="translate(360 900) scale(1.22) translate(-360 -900)">' + carSVG(CARS[o.car]) + '</g>' : ''}
  </svg>`;
}
const svgURL = (o) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sceneSVG(o));

// The fake camera: a canvas stream that shows scene N until VisionX takes photo N, then scene N + 1.
function cameraInit(scenes) {
  return `(() => {
  const SRC = ${JSON.stringify(scenes.map(sceneSVG))};
  const imgs = SRC.map((s) => { const i = new Image(); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); return i; });
  let shots = 0;
  const orig = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (src) {
    const r = orig.apply(this, arguments);
    if (src && src.tagName === 'VIDEO' && src.id === 'live') shots++;
    return r;
  };
  async function getUserMedia() {
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 960;
    const ctx = cv.getContext('2d');
    const draw = () => { const i = imgs[Math.min(shots, imgs.length - 1)]; if (i.complete && i.naturalWidth) orig.call(ctx, i, 0, 0, 720, 960); };
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    draw(); setInterval(draw, 80);
    return cv.captureStream(24);
  }
  try { navigator.mediaDevices.getUserMedia = getUserMedia; }
  catch (e) { Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia, enumerateDevices: async () => [] }, configurable: true }); }
})();`;
}

// ───────── Presets and triggers (vision-session.json) ─────────
const GATE_TEXT = 'Read the license plate of any car at the gate. Say its colour and type, and whether the plate is on my list: KXA 482, LMN 215.';
const COUNT_TEXT = 'Count the distinct vehicles that enter the car park and list their plates. Show a table of plates with the vehicle, and a bar per vehicle type.';
const PRESETS = [
  { id: 'p-gate', name: 'Gate: read plates', text: GATE_TEXT },
  { id: 'p-count', name: 'Count cars and plates', text: COUNT_TEXT },
  { id: 'p-people', name: 'Count people', text: 'Count the different people you see and summarize them: appearance, what they are doing, and when they first appeared.' },
  { id: 'p-delivery', name: 'Delivery at the door', text: 'Watch the front door. Say whether a courier or a delivery van is there, and what they leave.' },
];
const GATE_TRIGGERS = [
  { id: 't-gate', enabled: true, name: 'Open the gate', condition: 'A car with plate KXA 482 or LMN 215 is at the gate', shortcut: 'Open Gate', every: 30, when: 'photo', mode: 'rise', send: 'custom', message: 'Gate opened for {reason} at {time}' },
  { id: 't-unknown', enabled: true, name: 'Unknown car', condition: 'A car is at the gate and its plate is not KXA 482 or LMN 215', shortcut: 'Notify Me', every: 30, when: 'photo', mode: 'rise', send: 'frame', message: '' },
  { id: 't-courier', enabled: false, name: 'Courier at the door', condition: 'A courier or a delivery van is at the door', shortcut: 'Doorbell Chime', every: 20, when: 'interval', mode: 'new', send: 'summary', message: '' },
];
const COUNT_TRIGGERS = [
  { id: 't-van', enabled: true, name: 'Delivery van', condition: 'A delivery van has entered', shortcut: 'Notify Reception', every: 30, when: 'photo', mode: 'new', send: 'frame', message: '' },
  { id: 't-full', enabled: true, name: 'Lot is full', condition: 'More than 40 vehicles have entered', shortcut: 'Lot Full Sign', every: 30, when: 'photo', mode: 'once', send: 'summary', message: '' },
];
const SHORTCUT_NAMES = ['Doorbell Chime', 'Lot Full Sign', 'Notify Me', 'Notify Reception', 'Open Gate', 'Porch Light On', 'Vision Session AI', 'Vision Session Check'];

function store(kind, extra = {}) {
  const gate = kind === 'gate';
  return {
    savedAt: NOW - 3 * MIN,
    settings: Object.assign({
      instructions: gate ? GATE_TEXT : COUNT_TEXT, activePreset: gate ? 'p-gate' : 'p-count',
      interval: 4, engine: 'openai', accumulate: !gate, detail: 'auto', maxSide: 768, facing: 'environment', zoom: 1,
      shortcut: 'Vision Session AI', checkShortcut: 'Vision Session Check', applePhotos: true, shortcutNames: SHORTCUT_NAMES,
    }, extra),
    presets: PRESETS,
    triggers: gate ? GATE_TRIGGERS : COUNT_TRIGGERS,
  };
}

// ───────── AI replies ─────────
const GATE_REPLIES = [
  { frame: 'The driveway is empty and the gate is closed.', state: { cars: 0 }, summary: 'No car at the gate.',
    triggers: { 't-gate': { met: false, reason: 'No car is at the gate.' }, 't-unknown': { met: false, reason: 'No car is at the gate.' } } },
  { frame: 'A grey hatchback has stopped at the gate; the plate reads KXA 482.', state: { cars: 1, plate: 'KXA 482', vehicle: 'grey hatchback', on_list: true },
    summary: '**Grey hatchback at the gate.** Plate **KXA 482**, which is on your list.',
    triggers: { 't-gate': { met: true, reason: 'plate KXA 482 is at the gate' }, 't-unknown': { met: false, reason: 'KXA 482 is on the list.' } } },
  { frame: 'The gate is open and the grey hatchback, KXA 482, is driving in.', state: { cars: 1, plate: 'KXA 482', vehicle: 'grey hatchback', on_list: true },
    summary: '**Grey hatchback driving in.** Plate **KXA 482**, on your list. The gate is open.',
    triggers: { 't-gate': { met: true, reason: 'plate KXA 482 is at the gate' }, 't-unknown': { met: false, reason: 'KXA 482 is on the list.' } } },
];
const COUNT_ORDER = ['grey', 'red', 'van', 'blue', 'green'];
const KIND = (t) => (t === 'SUV' ? 'SUVs' : t === 'van' ? 'Vans' : 'Cars');
function countReply(n) {
  const seen = COUNT_ORDER.slice(0, n).map((k) => CARS[k]);
  const c = CARS[COUNT_ORDER[n - 1]];
  const by = { Cars: 0, SUVs: 0, Vans: 0 };
  seen.forEach((v) => { by[KIND(v.type)]++; });
  const rows = seen.map((v, i) => `| ${v.plate} | ${v.colour[0].toUpperCase() + v.colour.slice(1)} ${v.type} | #${i + 1} |`).join('\n');
  return {
    frame: `A ${c.colour} ${c.type}, plate ${c.plate}, is entering under the barrier.`,
    state: { count: n, vehicles: seen.map((v, i) => ({ id: 'v' + (i + 1), plate: v.plate, type: v.type, colour: v.colour })) },
    summary: `**${n} ${n === 1 ? 'vehicle has' : 'vehicles have'}** entered so far.\n\n| Plate | Vehicle | Photo |\n|---|---|---|\n${rows}\n\n` +
      '```mermaid\nxychart-beta\ntitle "By type"\nx-axis [Cars, SUVs, Vans]\nbar [' + [by.Cars, by.SUVs, by.Vans].join(', ') + ']\n```',
  };
}
const REFINED = {
  instructions: 'Watch the car park entrance. Each time a vehicle passes under the barrier, read its plate and note its colour and type (car, SUV, van, truck or motorbike).\n\nCount each vehicle once: if a plate was already counted, don’t count it again, even if it stops or reverses. Ignore vehicles that are leaving, parked cars in the background, people and bicycles. If a plate can’t be read, count the vehicle as “unreadable” with its colour and type.\n\nShow a table of plates with the vehicle and the photo it was first seen in, and a bar per vehicle type.',
  changes: 'Said what counts as entering, how to avoid double counting, what to ignore and what to do with unreadable plates.',
};

// One reply per request, shaped like the Anthropic Messages API.
function aiRoute(kind) {
  let photo = 0;
  return async (req) => {
    const b = req.json() || {};
    const sys = String(b.system || '');
    const msg = (b.messages || [])[0] || {};
    const user = typeof msg.content === 'string' ? msg.content : (msg.content || []).map((c) => c.text || '').join('');
    let text, tin, tout, wait = 500;
    if (/single word OK/.test(sys)) { text = 'OK'; tin = 14; tout = 2; }
    else if (/^You check conditions/.test(sys)) {
      const cond = (/CONDITION:\n(.*)/.exec(user) || [])[1] || '';
      const n = +((/\*\*(\d+) vehicles? ha/.exec(user) || [])[1] || 0);
      let v = { met: false, reason: 'Nothing in the summary matches.' };
      if (/delivery van/i.test(cond)) {
        if (/THIS TRIGGER ALREADY RAN/.test(user)) v = { met: false, reason: 'No new delivery van since the last run.' };
        else if (/\bvan\b/i.test(user.split('SUMMARY SO FAR:')[1] || '')) v = { met: true, reason: 'A white delivery van, BTR 907, has entered.' };
        else v = { met: false, reason: 'No delivery van has entered yet.' };
      } else if (/40 vehicles/.test(cond)) v = { met: false, reason: n + ' of 40 vehicles so far.' };
      text = JSON.stringify(v); tin = 610 + n * 40; tout = 24; wait = 350;
    } else if (/^You improve instructions/.test(sys)) { text = JSON.stringify(REFINED); tin = 880; tout = 196; wait = 1200; }
    else {
      photo++;
      const r = kind === 'gate' ? GATE_REPLIES[Math.min(photo, GATE_REPLIES.length) - 1] : countReply(Math.min(photo, COUNT_ORDER.length));
      text = JSON.stringify(r); tin = 1180 + photo * 36; tout = 150 + (photo * 23) % 60; wait = 900;
    }
    await new Promise((r) => setTimeout(r, wait));
    return { json: { id: 'msg_demo', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: tin, output_tokens: tout } } };
  };
}

// ───────── Saved sessions (VisionX-sessions on this iPhone) ─────────
function savedSessions() {
  const s1 = at(7, 2, 14), e1 = at(7, 47, 26);
  const t = (ts) => new Date(ts).toLocaleTimeString('en-US', { timeZone: 'Europe/Vilnius' });
  const sum1 = '**23 vehicles** entered between 07:02 and 07:47, most of them from 07:30 to 07:40. Both vans were deliveries.\n\n' +
    '```mermaid\npie title By type\n"🚗 Cars" : 17\n"🚙 SUVs" : 4\n"🚐 Vans" : 2\n```\n\n' +
    '```mermaid\nxychart-beta\ntitle "Entered per 10 min"\nx-axis [07:00, 07:10, 07:20, 07:30, 07:40]\nbar [2, 4, 5, 9, 3]\n```';
  const frames = [
    { idx: 262, time: t(e1 - 12e3), text: 'A green estate, plate MRV 640, is entering under the barrier.', ms: 1840, tokens: 1342, car: 'green' },
    { idx: 261, time: t(e1 - 22e3), text: 'The entrance is empty; the barrier is down.', ms: 1610, tokens: 1288 },
    { idx: 260, time: t(e1 - 32e3), text: 'A blue SUV, plate GZA 318, is waiting at the barrier.', ms: 1920, tokens: 1351, car: 'blue' },
  ];
  const images = {};
  frames.forEach((f) => { images[f.idx] = svgURL({ kind: 'barrier', car: f.car }); delete f.car; });
  const meta1 = {
    id: 's-' + s1, startedAt: s1, endedAt: e1, photos: 262, fired: 2, engine: ENGINE, mode: 'build', preset: 'Count cars and plates',
    thumb: svgURL({ kind: 'barrier', car: 'green' }),
    summary: '23 vehicles entered between 07:02 and 07:47: 17 cars, 4 SUVs and 2 vans. Busiest from 07:30 to 07:40.',
    ran: [{ name: 'Delivery van', fired: 2 }],
  };
  const rec1 = {
    id: meta1.id, version: '1.19.0', startedAt: s1, endedAt: e1, instructions: COUNT_TEXT, preset: meta1.preset, engine: ENGINE, mode: 'build', interval: 10,
    summary: sum1, summaryAt: { idx: 262, time: frames[0].time }, state: { count: 23, cars: 17, suvs: 4, vans: 2, last: 'MRV 640' },
    rows: [['Duration', '45:12'], ['Photos taken', 262], ['Requests sent', 262], ['Analyzed', 261], ['Failed', 1], ['Input tokens', '301,644'], ['Output tokens', '41,920'],
      ['Total tokens', '343,564'], ['Average tokens per request', '1,316'], ['Trigger checks', 522], ['Triggers fired', 2], ['“Delivery van” ran', '2 times'], ['“Lot is full” ran', '0 times'],
      ['Average response time', '1.9 s'], ['Analyzed with', ENGINE], ['Interval', '10 s'], ['Summary', 'Built up over the session']],
    triggers: [
      { name: 'Delivery van', condition: 'A delivery van has entered', shortcut: 'Notify Reception', mode: 'new', when: 'photo', off: false, fired: 2, checks: 261, reason: 'No new delivery van since the last run.', decision: 'Not met, so the shortcut didn’t run.', error: '', firedAt: '7:31:12 AM' },
      { name: 'Lot is full', condition: 'More than 40 vehicles have entered', shortcut: 'Lot Full Sign', mode: 'once', when: 'photo', off: false, fired: 0, checks: 261, reason: '23 of 40 vehicles so far.', decision: 'Not met, so the shortcut didn’t run.', error: '', firedAt: '' },
    ],
    frames, images,
    debug: frames.map((f) => ({ id: 'd-' + f.idx, idx: f.idx, time: f.time, engine: 'Claude', model: MODEL, mode: 'built up over the session', request: null, raw: '', parsed: { frame: f.text }, usage: { input_tokens: f.tokens - 160, output_tokens: 160, total_tokens: f.tokens }, ms: f.ms, attempts: 1, dropped: [], error: '', checks: [], noPhoto: false, pending: false })),
    meta: meta1,
  };
  const s2 = at(18, 40, 5, -1), e2 = at(19, 5, 40, -1);
  const meta2 = { id: 's-' + s2, startedAt: s2, endedAt: e2, photos: 154, fired: 3, engine: ENGINE, mode: 'fresh', preset: 'Gate: read plates', thumb: svgURL({ kind: 'gate', open: true, car: 'red' }),
    summary: 'Red sedan driving in. Plate LMN 215, on your list. The gate is open.', ran: [{ name: 'Open the gate', fired: 2 }, { name: 'Unknown car', fired: 1 }] };
  const s3 = at(14, 0, 0, -2), e3 = at(14, 21, 30, -2);
  const meta3 = { id: 's-' + s3, startedAt: s3, endedAt: e3, photos: 129, fired: 0, engine: ENGINE, mode: 'build', preset: 'Delivery at the door', thumb: '',
    summary: 'Two couriers came to the door: one left a parcel at 14:06, one a letter at 14:18.', ran: [] };
  const minimal = (m) => ({ id: m.id, version: '1.19.0', startedAt: m.startedAt, endedAt: m.endedAt, preset: m.preset, engine: m.engine, mode: m.mode, summary: m.summary, rows: [], triggers: [], frames: [], debug: [], images: {}, meta: m });
  return {
    [SES + '/index.json']: [meta1, meta2, meta3],
    [SES + '/' + meta1.id + '.json']: rec1,
    [SES + '/' + meta2.id + '.json']: minimal(meta2),
    [SES + '/' + meta3.id + '.json']: minimal(meta3),
  };
}

// ───────── AI settings and token usage ─────────
function aiFiles() {
  const days = {};
  const per = [0, 18200, 22600, 9400, 0, 31800, 26400, 14800, 0, 0, 41200, 23900, 30600, 12700];
  let tin = 0, tout = 0, calls = 0;
  per.forEach((v, i) => {
    if (!v) return;
    const d = new Date(NOW - (13 - i) * 864e5 + 2 * 3600e3);
    const k = d.toISOString().slice(0, 10);
    const c = Math.round(v / 1300), o = Math.round(v * 0.12);
    days[k] = { calls: c, in: v - o, out: o };
    tin += v - o; tout += o; calls += c;
  });
  const split = (f) => ({ calls: Math.round(calls * f), in: Math.round(tin * f), out: Math.round(tout * f) });
  return {
    [LOCAL + '/visionx-ai-settings.json']: { aiProvider: 'anthropic', ai: true, models: { anthropic: { at: NOW - 2 * 864e5, list: [
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }] } } },
    [LOCAL + '/visionx-usage.json']: { since: NOW - 40 * 864e5, p: { anthropic: { calls, in: tin, out: tout, models: { [MODEL]: { calls, in: tin, out: tout } },
      features: { analysis: split(0.86), triggers: split(0.12), refine: split(0.015), test: split(0.005) }, days } } },
  };
}

// ───────── Fixtures, fresh for every shot ─────────
const releases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'releases.json'), 'utf8'));
function withUpdate() {
  const r = JSON.parse(JSON.stringify(releases));
  const next = Object.assign({}, r.releases[0], { version: '1.20.0', date: '2026-10-29' });
  r.releases.unshift(next);
  return r;
}

const SCENES = {
  gate: [{ kind: 'gate' }, { kind: 'gate', car: 'grey' }, { kind: 'gate', car: 'grey', open: true }],
  count: COUNT_ORDER.map((car) => ({ kind: 'barrier', car })).concat([{ kind: 'barrier' }]),
};

module.exports = {
  app: { name: 'VisionX', script: 'VisionX.js', accent: '#E5383B' },
  now: NOW,
  locale: 'en_US', timezone: 'Europe/Vilnius',
  settle: 2900,
  sceneSVG,
  fixtures: (shot) => {
    const kind = shot.scene || 'count';
    const files = Object.assign({ [LOCAL + '/vision-session.json']: store(kind, shot.store || {}) }, savedSessions(), aiFiles());
    if (shot.look) files[ICLOUD + '/VisionX/settings.json'] = Object.assign({ theme: 'auto', density: 'comfortable', font: 'sans', textSize: 1, checkUpdates: true, cfg: {} }, shot.look);
    if (shot.widgetLive) files[LOCAL + '/visionx-widget.json'] = { running: true, preset: 'Gate: read plates', interval: 10, photos: 37, startedAt: NOW - 6 * MIN - 10e3, at: NOW - 20e3 };
    return {
      files,
      keychain: { VISIONX_ANTHROPIC_KEY: 'sk-ant-demo-0000000000001234' },
      alerts: [],
      routes: [
        { match: /releases\.json/, respond: { json: shot.update ? withUpdate() : releases } },
        { match: /icon-1024\.png/, respond: { file: path.join(__dirname, '..', 'icon-1024.png') } },
        { match: 'api.anthropic.com/v1/messages', respond: aiRoute(kind) },
        { match: 'api.anthropic.com/v1/models', respond: { json: { data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-08-01T00:00:00Z' }] } } },
      ],
      pageInit: cameraInit(SCENES[kind]),
      callback: (url, params) => ({ result: '' }),
    };
  },
  shots: [],
};

// ───────── Shots ─────────
const waitFor = (h, fn, arg, ms = 30000) => h.page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
// After photo n is analyzed and its trigger checks are done.
const lastIs = (n) => `(document.getElementById('lastCap').textContent || '').indexOf('#${n},') !== -1 && !document.querySelector('.tr2.checking, .tr2.firing')`;
// Scrolls the page (or a scrolling sheet) so the element matching sel, containing text, sits `off` px from the top.
const scrollToEl = (h, sel, text, off, box) => h.eval(([sel, text, off, box]) => {
  const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.indexOf(text) !== -1);
  if (!el) return;
  const d = el.getBoundingClientRect().top - off;
  if (box) document.querySelector(box).scrollTop += d; else window.scrollBy(0, d);
}, [sel, text, off, box]);
const blur = (h) => h.eval(() => document.activeElement && document.activeElement.blur());

module.exports.shots = [
  { id: '01-gate', scene: 'gate', label: 'Opens the gate for a known car', caption: 'Reads the plate, checks your list and runs your “Open Gate” shortcut.',
    run: async (h) => { await h.tap('#hStart'); await waitFor(h, lastIs(2)); await h.tap('.tr2.lit .tr2h'); await h.wait(900); } },
  { id: '02-count', scene: 'count', label: 'Counts cars and plates', caption: 'One running summary for the whole session, with a table and a bar per type.',
    run: async (h) => { await h.tap('#hStart'); await waitFor(h, lastIs(4)); await h.wait(1500); } },
  { id: '03-triggers', scene: 'gate', label: 'Triggers run your shortcuts', caption: 'A plain-language condition, when to check it and the shortcut to run.',
    run: async (h) => {
      await h.tap('#tab-triggers'); await h.tap('.tItem .chip'); await h.wait(300); await blur(h);
      await scrollToEl(h, '#trigForm label', 'Condition', 150); await h.wait(400);
    } },
  { id: '04-refine', scene: 'count', label: 'Refine instructions with AI', caption: 'A full-screen editor; AI rewrites what to count and ignore, you decide.',
    run: async (h) => {
      await h.tap('#iRefine'); await h.tap('#editor [data-ask^="Make it more specific"]');
      await waitFor(h, `!document.getElementById('edSuggest').classList.contains('hidden')`); await h.wait(300); await blur(h);
      await scrollToEl(h, '#edText', '', 10, '#editor');
    } },
  { id: '05-setup', scene: 'gate', label: 'Tell it what to look for', caption: 'Your own instructions, saved as presets, analyzed by Claude, OpenAI or Apple.' },
  { id: '06-report', scene: 'count', label: 'Every session saved', caption: 'The summary, stats, trigger runs and last photos of each finished session.',
    run: async (h) => { await h.tap('#tab-sessions'); await h.tap('.sesCard'); await h.wait(400); } },
  { id: '07-debug', scene: 'count', label: 'See what came back', caption: 'The debug log keeps each photo with exactly what was sent and what came back.',
    run: async (h) => {
      await h.tap('#hStart'); await waitFor(h, lastIs(3)); await h.tap('#hPause'); await h.wait(600);
      await h.eval(() => { document.getElementById('debugBox').open = true; }); await h.wait(300);
      await h.eval(() => { document.querySelector('#debugList details.dbg').open = true; }); await h.wait(400);
      await scrollToEl(h, '#debugList h3', 'Reply as received', 168);
    } },
  { id: '08-launch', scene: 'gate', label: 'Launch screen', caption: 'The eye draws itself, then “Sees. Understands. Acts.” Tap to skip.', settle: 1700, after: 0 },
  { id: '09-settings', scene: 'gate', label: 'Settings', caption: 'Colours, layout, text size and font, updates and capture limits, applied at once.',
    run: async (h) => { await h.tap('#cfgOpen'); await h.wait(500); } },
  { id: '10-ai-settings', scene: 'gate', look: { textSize: 0.92 }, label: 'Your own AI key', caption: 'Claude or OpenAI with your key in the Keychain; see tokens per day and feature.',
    run: async (h) => { await h.tap('#cfgOpen'); await h.tap('[data-act="ai-open"]'); await h.wait(800); await scrollToEl(h, '#aisheet .aicard.active', '', 64, '#aisheet'); } },
  { id: '11-update', scene: 'gate', update: true, label: 'Updates in the app', caption: 'A new version shows its three best features; your presets and triggers stay.', settle: 3600 },
  { id: '12-dark', scene: 'count', dark: true, label: 'Dark mode', caption: 'Scroll and the photo row stays pinned at half height above the triggers.',
    run: async (h) => { await h.tap('#hStart'); await waitFor(h, lastIs(4)); await h.wait(600); await h.scrollTo(560); await h.wait(700); } },
  { id: '13-widget', scene: 'count', widget: 'medium', label: 'Home Screen widget', caption: 'Your last session with the shortcuts that ran and its ✦ summary.' },
  { id: '14-widget-live', scene: 'gate', widget: 'medium', widgetLive: true, label: 'While a session runs', caption: 'The widget shows ● Live, the preset, the interval and the photos so far.' },
];
