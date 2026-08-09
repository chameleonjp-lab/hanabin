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
  const css = await readProjectFile("styles/base.css");
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
    "src/app.js",
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
