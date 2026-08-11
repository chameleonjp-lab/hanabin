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

test("M7 Pages workflow deploys only the default branch artifact", async () => {
  const workflow = await readProjectFile(".github/workflows/pages.yml");

  assert.match(workflow, /push:\s*\n\s+branches:\s+\[main\]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /pages:\s+write/u);
  assert.match(workflow, /id-token:\s+write/u);
  assert.match(workflow, /actions\/configure-pages@v5/u);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/u);
  assert.match(workflow, /actions\/deploy-pages@v4/u);
  assert.match(workflow, /path:\s+\.\/site/u);
  assert.doesNotMatch(workflow, /npm (?:ci|install)/u);
});
