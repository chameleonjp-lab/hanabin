import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RULES,
  INPUT_SCHEMA_VERSION,
  MVP_RELEASE_VERSION,
  PROFILE_STORAGE_KEY,
  RELEASE_MANIFEST,
  RULE_VERSION,
  STORAGE_FORMAT_VERSION,
} from "../../src/config/index.js";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readProjectFile = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("M7 release identifiers are fixed and agree across rules, storage, and package", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));

  assert.equal(packageJson.version, MVP_RELEASE_VERSION);
  assert.equal(RELEASE_MANIFEST.releaseVersion, MVP_RELEASE_VERSION);
  assert.equal(RELEASE_MANIFEST.gameVersion, DEFAULT_RULES.gameVersion);
  assert.equal(RELEASE_MANIFEST.ruleVersion, DEFAULT_RULES.ruleVersion);
  assert.equal(RELEASE_MANIFEST.ruleVersion, RULE_VERSION);
  assert.equal(RELEASE_MANIFEST.inputSchemaVersion, INPUT_SCHEMA_VERSION);
  assert.equal(RELEASE_MANIFEST.storageFormatVersion, STORAGE_FORMAT_VERSION);
  assert.equal(RELEASE_MANIFEST.profileStorageKey, PROFILE_STORAGE_KEY);
  assert.equal(PROFILE_STORAGE_KEY, "hanabin:profile:v1");
  assert.equal(RELEASE_MANIFEST.runtimeDependencies, 0);
});

test("M7 Pages workflow deploys only an exact-sha CI-approved artifact", async () => {
  const workflow = await readProjectFile(".github/workflows/pages.yml");

  assert.match(workflow, /workflow_run:\s*[\s\S]*workflows:\s*\["CI Core",\s*"CI Browser"\]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /actions:\s+read/u);
  assert.match(workflow, /pages:\s+write/u);
  assert.match(workflow, /id-token:\s+write/u);
  assert.match(workflow, /scripts\/check-ci-gate\.mjs/u);
  assert.match(workflow, /needs:\s+gate/u);
  assert.match(workflow, /ref:\s+\$\{\{\s*needs\.gate\.outputs\.target_sha\s*\}\}/u);
  assert.match(workflow, /actions\/configure-pages@[0-9a-f]{40}\s+#\s+v5/u);
  assert.match(workflow, /actions\/upload-pages-artifact@[0-9a-f]{40}\s+#\s+v4/u);
  assert.match(workflow, /actions\/deploy-pages@[0-9a-f]{40}\s+#\s+v4/u);
  assert.match(workflow, /path:\s+\.\/site/u);
  assert.doesNotMatch(workflow, /npm (?:ci|install)/u);
  assert.doesNotMatch(workflow, /^\s+push:/mu);
});

test("public release workflow rejects a non-Actions Pages source", async () => {
  const workflow = await readProjectFile(".github/workflows/public-release.yml");

  assert.match(workflow, /pages:\s+read/u);
  assert.match(workflow, /node scripts\/check-pages-source\.mjs/u);
  assert.match(workflow, /GITHUB_TOKEN:\s+\$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
});

test("Pages CI gate checks both required workflows for the exact commit", async () => {
  const gate = await readProjectFile("scripts/check-ci-gate.mjs");

  assert.match(gate, /actions\/runs\?head_sha=/u);
  assert.match(gate, /CI Core,CI Browser/u);
  assert.match(gate, /run\.head_sha === targetSha/u);
  assert.match(gate, /run\?\.status === "completed"/u);
  assert.match(gate, /run\?\.conclusion === "success"/u);
  assert.match(gate, /Required CI has not passed/u);
});
