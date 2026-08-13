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
  [/branches:\s*\[main\]/u.test(pagesWorkflow), "Pages must publish from main only"],
  [/actions\/upload-pages-artifact@v4/u.test(pagesWorkflow), "Pages artifact action is missing"],
  [/actions\/deploy-pages@v4/u.test(pagesWorkflow), "Pages deploy action is missing"],
  [pagesWorkflow.includes("- index.html"), "index.html must trigger Pages"],
  [pagesWorkflow.includes('- "styles/**"'), "styles must trigger Pages"],
  [pagesWorkflow.includes('- "src/**"'), "src must trigger Pages"],
  [pagesWorkflow.includes("- .github/workflows/pages.yml"), "Pages workflow changes must trigger Pages"],
  [pagesWorkflow.includes("- .github/workflows/public-release.yml"), "public smoke workflow changes must trigger Pages"],
  [pagesWorkflow.includes("- playwright.public.config.mjs"), "public smoke config changes must trigger Pages"],
  [pagesWorkflow.includes("- scripts/check-pages-source.mjs"), "Pages source check changes must trigger Pages"],
  [pagesWorkflow.includes("- tests/e2e/m7-public-release.spec.mjs"), "public smoke test changes must trigger Pages"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    release: RELEASE_MANIFEST,
    packageVersion: packageJson.version,
    pagesWorkflow: "main-only limited-artifact workflow contract",
    pagesRemoteSetting: "checked separately through GitHub Pages API",
  }, null, 2));
}
