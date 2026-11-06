#!/usr/bin/env node
// Builds sample data with the harness and takes smoke screenshots of the real page (see docs/TESTING.md).
//   node tests/screens/run.js     → PNGs in $VISIONX_SHOTS or <tmp>/visionx-screens/shots/
// Needs Playwright with Chromium: cd tests && npm i playwright && npx playwright install chromium
const { execFileSync } = require("child_process"), path = require("path"), os = require("os");
for (const s of ["snapshot.js", "shots.js"]) {
  console.log("› " + s);
  execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: "inherit", timeout: 300e3 });
}
