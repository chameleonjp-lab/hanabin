import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INPUT_SCHEMA_VERSION,
  MVP_RELEASE_VERSION,
  PROFILE_STORAGE_KEY,
  RELEASE_MANIFEST,
  RULE_VERSION,
  STORAGE_FORMAT_VERSION,
} from "../src/config/index.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const pagesWorkflow = await readFile(
  resolve(projectRoot, ".github/workflows/pages.yml"),
  "utf8",
);

const checks = [
  [packageJson.version === MVP_RELEASE_VERSION, "package version must match the MVP release version"],
  [RELEASE_MANIFEST.releaseVersion === MVP_RELEASE_VERSION, "release manifest version mismatch"],
  [RELEASE_MANIFEST.ruleVersion === RULE_VERSION, "release rule version mismatch"],
  [RELEASE_MANIFEST.inputSchemaVersion === INPUT_SCHEMA_VERSION, "release input version mismatch"],
  [RELEASE_MANIFEST.storageFormatVersion === STORAGE_FORMAT_VERSION, "release storage version mismatch"],
  [RELEASE_MANIFEST.profileStorageKey === PROFILE_STORAGE_KEY, "profile storage key mismatch"],
  [RELEASE_MANIFEST.runtimeDependencies === 0, "MVP must have no runtime dependencies"],
  [/workflow_run:\s*[\s\S]*workflows:\s*\["CI Core",\s*"CI Browser"\]/u.test(pagesWorkflow), "Pages must wait for Core and Browser CI"],
  [/head_branch == 'main'/u.test(pagesWorkflow), "Pages must publish the main branch only"],
  [/actions:\s*read/u.test(pagesWorkflow), "Pages must read the exact CI run status"],
  [pagesWorkflow.includes("scripts/check-ci-gate.mjs"), "Pages must verify the exact CI revision"],
  [/needs:\s+gate/u.test(pagesWorkflow), "Pages build must depend on the CI gate"],
  [/actions\/upload-pages-artifact@[0-9a-f]{40}\s+#\s+v4/u.test(pagesWorkflow), "Pages artifact action is missing or not SHA-pinned"],
  [/actions\/deploy-pages@[0-9a-f]{40}\s+#\s+v4/u.test(pagesWorkflow), "Pages deploy action is missing or not SHA-pinned"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    release: RELEASE_MANIFEST,
    packageVersion: packageJson.version,
    pagesWorkflow: "main-only exact-sha CI-gated limited-artifact workflow contract",
    pagesRemoteSetting: "checked separately through GitHub Pages API",
  }, null, 2));
}
