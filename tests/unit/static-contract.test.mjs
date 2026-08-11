import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readProjectFile = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("static page has the M1 loading contract", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /name="viewport"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /type="module"\s+src="\.\/src\/app\.js"/);
  assert.match(html, /id="app-error"[^>]+role="alert"/);
  assert.match(html, /id="orientation-guide"/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i);
});

test("public files do not load a CDN or external font", async () => {
  const html = await readProjectFile("index.html");
  const css = [
    await readProjectFile("styles/base.css"),
    await readProjectFile("styles/game.css"),
  ].join("\n");
  assert.doesNotMatch(`${html}\n${css}`, /(?:cdn|googleapis|fonts\.google|use\.typekit|@import\s+url)/i);
  assert.doesNotMatch(`${html}\n${css}`, /https?:\/\//i);
});

test("layout includes viewport fallbacks and all safe-area insets", async () => {
  const css = await readProjectFile("styles/base.css");
  for (const inset of ["top", "right", "bottom", "left"]) {
    assert.match(css, new RegExp(`safe-area-inset-${inset}`));
  }
  assert.match(css, /100vh/);
  assert.match(css, /100dvh/);
});

test("M1 entry files exist without a build step", async () => {
  for (const relativePath of [
    "styles/base.css",
    "styles/game.css",
    "src/app.js",
    "src/game/controller.js",
    "src/game/session.js",
    "src/input/pointer-controller.js",
    "src/render/canvas-renderer.js",
    "src/render/decorative-layer.js",
    "src/render/firework-effects.js",
    "src/render/particle-pool.js",
    "src/render/quality-controller.js",
    "src/ui/tutorial.js",
    "src/ui/result.js",
    "src/audio/sound.js",
    "src/storage/local-storage.js",
    "src/config/release.js",
    "src/ui/screens.js",
    "scripts/serve.mjs",
    "scripts/check-syntax.mjs",
    "playwright.config.mjs",
  ]) {
    await assert.doesNotReject(access(resolve(projectRoot, relativePath)), relativePath);
  }
});

test("runtime dependency remains empty", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  assert.ok(!packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0);
  assert.ok(packageJson.devDependencies?.["@playwright/test"]);
});

test("the fixed-tick browser bridge is limited to an explicit local test URL", async () => {
  const app = await readProjectFile("src/app.js");
  assert.match(app, /isLocalTestHost/);
  assert.match(app, /127\.0\.0\.1/);
  assert.match(app, /URLSearchParams\(window\.location\.search\)/);
  assert.match(app, /isLocalTestHost\s*&&/);
});

test("the public Pages artifact contains only the static game entry files", async () => {
  const workflow = await readProjectFile(".github/workflows/pages.yml");

  assert.match(workflow, /cp index\.html site\//);
  assert.match(workflow, /cp -R styles site\//);
  assert.match(workflow, /cp -R src site\//);
  assert.doesNotMatch(workflow, /cp .*README|cp .*tests|cp .*\.github/u);
});
