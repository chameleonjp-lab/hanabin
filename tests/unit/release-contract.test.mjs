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

test("M7 Pages waits for same-SHA Core and Browser checks before deployment", async () => {
  const workflow = await readProjectFile(".github/workflows/pages.yml");

  assert.match(workflow, /push:\s*\n\s+branches:\s+\[main\]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /core:\s*\n[\s\S]*?uses:\s+\.\/\.github\/workflows\/ci-core\.yml/u);
  assert.match(workflow, /browser:\s*\n[\s\S]*?uses:\s+\.\/\.github\/workflows\/ci-browser\.yml/u);
  assert.match(workflow, /build:\s*\n[\s\S]*?needs:\s*\[core,\s*browser\]/u);
  assert.match(workflow, /ref:\s+\$\{\{\s*github\.sha\s*\}\}/u);
  assert.match(workflow, /check-public-artifact\.mjs\s+--root site\s+--write-manifest/u);
  assert.match(workflow, /needs\.build\.result\s*==\s*['"]success['"]/u);
  assert.match(workflow, /pages:\s+write/u);
  assert.match(workflow, /id-token:\s+write/u);
  assert.match(workflow, /actions\/configure-pages@[0-9a-f]{40}\s+#\s+v5/u);
  assert.match(workflow, /actions\/upload-pages-artifact@[0-9a-f]{40}\s+#\s+v4/u);
  assert.match(workflow, /actions\/deploy-pages@[0-9a-f]{40}\s+#\s+v4/u);
  assert.match(workflow, /artifact_name:\s+github-pages/u);
  assert.match(workflow, /path:\s+\.\/site/u);
  assert.doesNotMatch(workflow, /npm (?:ci|install)/u);
  for (const releasePath of [
    "index.html",
    '"styles/**"',
    '"src/**"',
    ".github/workflows/pages.yml",
    ".github/workflows/public-release.yml",
    ".github/workflows/ci-core.yml",
    ".github/workflows/ci-browser.yml",
    "playwright.public.config.mjs",
    "scripts/check-pages-source.mjs",
    "scripts/check-public-artifact.mjs",
    "tests/e2e/m7-public-release.spec.mjs",
  ]) {
    assert.equal(workflow.includes(`- ${releasePath}`), true, `${releasePath} must trigger Pages`);
  }
  assert.doesNotMatch(workflow, /- (?:README\.md|docs\/|package\.json)/u);

  const coreWorkflow = await readProjectFile(".github/workflows/ci-core.yml");
  const browserWorkflow = await readProjectFile(".github/workflows/ci-browser.yml");
  assert.match(coreWorkflow, /workflow_call:/u);
  assert.match(browserWorkflow, /workflow_call:/u);
  assert.match(coreWorkflow, /git rev-parse HEAD/u);
  assert.match(browserWorkflow, /git rev-parse HEAD/u);
});

test("public release workflow rejects a non-Actions Pages source", async () => {
  const workflow = await readProjectFile(".github/workflows/public-release.yml");

  assert.match(workflow, /pages:\s+read/u);
  assert.match(workflow, /node scripts\/check-pages-source\.mjs/u);
  assert.match(workflow, /node scripts\/check-public-artifact\.mjs/u);
  assert.match(workflow, /EXPECTED_RELEASE_SHA/u);
  assert.match(workflow, /workflow_run\.conclusion\s*==\s*['"]success['"]/u);
  assert.match(workflow, /workflow_run\.head_branch\s*==\s*['"]main['"]/u);
  assert.doesNotMatch(workflow, /workflows?:\s*\[?['"](?:CI Core|CI Browser)/u);
  assert.match(workflow, /GITHUB_TOKEN:\s+\$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
});

test("public artifact checker keeps the Pages payload allowlisted and SHA-bound", async () => {
  const script = await readProjectFile("scripts/check-public-artifact.mjs");

  assert.match(script, /schemaVersion/u);
  assert.match(script, /commitSha/u);
  assert.match(script, /artifactSha256/u);
  assert.match(script, /index\.html/u);
  assert.match(script, /styles/u);
  assert.match(script, /src/u);
  assert.match(script, /unexpected top-level/u);
  assert.match(script, /EXPECTED_RELEASE_SHA/u);
});
