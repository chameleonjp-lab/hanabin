import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PUBLIC_URL = "https://chameleonjp-lab.github.io/hanabin/";
const MANIFEST_NAME = "release.json";
const MANIFEST_VERSION = 1;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const PRODUCT_ROOTS = Object.freeze(["index.html", "styles", "src"]);
const ALLOWED_TOP_LEVEL = new Set([".nojekyll", MANIFEST_NAME, ...PRODUCT_ROOTS]);

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
};

const hasArgument = (name) => process.argv.includes(name);

const expectedSha = argumentValue("--expected-sha").trim().toLowerCase() ||
  process.env.EXPECTED_RELEASE_SHA?.trim().toLowerCase() || "";
const artifactRoot = argumentValue("--root").trim();
const publicUrl = (argumentValue("--url").trim() ||
  process.env.PUBLIC_BASE_URL?.trim() || DEFAULT_PUBLIC_URL).replace(/\/+$/u, "") + "/";

const fail = (message) => {
  throw new Error(message);
};

const assertCommitSha = (value, label) => {
  if (!COMMIT_SHA_PATTERN.test(value)) fail(`${label} must be a 40-character commit SHA`);
  return value;
};

const normalizePath = (value) => value.split("\\").join("/").replace(/^\.\//u, "");

const isSafeRelativePath = (relativePath) => {
  const normalized = normalizePath(relativePath);
  return normalized.length > 0 && !normalized.startsWith("/") &&
    !normalized.split("/").includes("..") && normalized === relativePath;
};

const isProductFile = (relativePath) => isSafeRelativePath(relativePath) &&
  (relativePath === "index.html" || relativePath.startsWith("styles/") ||
    relativePath.startsWith("src/"));

const listProductFiles = async (root, current = "") => {
  const directory = resolve(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = normalizePath(posix.join(current, entry.name));
    if (relativePath === MANIFEST_NAME || relativePath === ".nojekyll") continue;
    if (entry.isDirectory()) {
      files.push(...await listProductFiles(root, relativePath));
      continue;
    }
    if (!entry.isFile()) fail(`public artifact contains a non-file entry: ${relativePath}`);
    if (!isProductFile(relativePath)) fail(`public artifact contains an unapproved file: ${relativePath}`);
    files.push(relativePath);
  }
  return files.sort();
};

const hashEntries = async (entries, readEntry) => {
  const hash = createHash("sha256");
  for (const relativePath of [...entries].sort()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readEntry(relativePath));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const parseManifest = (value, label) => {
  let manifest;
  try {
    manifest = JSON.parse(value);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error?.message ?? String(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${label} must be a JSON object`);
  }
  if (manifest.schemaVersion !== MANIFEST_VERSION) {
    fail(`${label} schemaVersion must be ${MANIFEST_VERSION}`);
  }
  assertCommitSha(String(manifest.commitSha ?? "").toLowerCase(), `${label}.commitSha`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 ||
      manifest.files.some((entry) => typeof entry !== "string" || !isProductFile(entry))) {
    fail(`${label}.files must list only non-empty public product files`);
  }
  const files = [...manifest.files].map(normalizePath).sort();
  if (new Set(files).size !== files.length) fail(`${label}.files contains duplicates`);
  if (!DIGEST_PATTERN.test(String(manifest.artifactSha256 ?? ""))) {
    fail(`${label}.artifactSha256 must be a 64-character hexadecimal digest`);
  }
  return {
    ...manifest,
    commitSha: String(manifest.commitSha).toLowerCase(),
    files,
    artifactSha256: String(manifest.artifactSha256).toLowerCase(),
  };
};

const verifyManifest = async (manifest, readEntry, actualFiles, label) => {
  if (expectedSha && manifest.commitSha !== expectedSha) {
    fail(`${label}.commitSha ${manifest.commitSha} does not match expected ${expectedSha}`);
  }
  if (actualFiles) {
    const sortedActual = [...actualFiles].sort();
    if (JSON.stringify(sortedActual) !== JSON.stringify(manifest.files)) {
      fail(`${label}.files does not match the inspected public artifact`);
    }
  }
  const actualDigest = await hashEntries(manifest.files, readEntry);
  if (actualDigest !== manifest.artifactSha256) {
    fail(`${label}.artifactSha256 ${manifest.artifactSha256} does not match ${actualDigest}`);
  }
  return { ...manifest, inspectedDigest: actualDigest };
};

const verifyLocalArtifact = async () => {
  const root = resolve(projectRoot, artifactRoot || "site");
  const topLevel = await readdir(root, { withFileTypes: true });
  const unexpected = topLevel
    .map((entry) => entry.name)
    .filter((name) => !ALLOWED_TOP_LEVEL.has(name));
  if (unexpected.length) fail(`public artifact has unexpected top-level entries: ${unexpected.join(", ")}`);
  for (const required of PRODUCT_ROOTS) {
    const entry = topLevel.find((candidate) => candidate.name === required);
    if (!entry || (required === "index.html" ? !entry.isFile() : !entry.isDirectory())) {
      fail(`public artifact is missing ${required}`);
    }
  }
  const files = await listProductFiles(root);
  const manifestPath = resolve(root, MANIFEST_NAME);
  const manifest = parseManifest(await readFile(manifestPath, "utf8"), `site/${MANIFEST_NAME}`);
  const verified = await verifyManifest(
    manifest,
    (relativePath) => readFile(resolve(root, relativePath)),
    files,
    `site/${MANIFEST_NAME}`,
  );
  console.log(JSON.stringify({
    mode: "local",
    root,
    commitSha: verified.commitSha,
    files: verified.files.length,
    artifactSha256: verified.artifactSha256,
  }, null, 2));
};

const verifyRemoteArtifact = async () => {
  const manifestResponse = await fetch(new URL(MANIFEST_NAME, publicUrl));
  if (!manifestResponse.ok) fail(`public ${MANIFEST_NAME} returned HTTP ${manifestResponse.status}`);
  const manifest = parseManifest(await manifestResponse.text(), `public ${MANIFEST_NAME}`);
  const responseCache = new Map();
  const readEntry = async (relativePath) => {
    if (!isProductFile(relativePath)) fail(`manifest points outside the product artifact: ${relativePath}`);
    const url = new URL(relativePath, publicUrl);
    if (url.origin !== new URL(publicUrl).origin || !url.pathname.startsWith(new URL(publicUrl).pathname)) {
      fail(`manifest points outside the public base URL: ${relativePath}`);
    }
    if (!responseCache.has(relativePath)) {
      const response = await fetch(url);
      if (!response.ok) fail(`public artifact file ${relativePath} returned HTTP ${response.status}`);
      responseCache.set(relativePath, Buffer.from(await response.arrayBuffer()));
    }
    return responseCache.get(relativePath);
  };
  const verified = await verifyManifest(manifest, readEntry, null, `public ${MANIFEST_NAME}`);
  console.log(JSON.stringify({
    mode: "remote",
    url: publicUrl,
    commitSha: verified.commitSha,
    files: verified.files.length,
    artifactSha256: verified.artifactSha256,
  }, null, 2));
};

const writeManifest = async () => {
  if (!artifactRoot) fail("--write-manifest requires --root");
  assertCommitSha(expectedSha, "--expected-sha");
  const root = resolve(projectRoot, artifactRoot);
  const files = await listProductFiles(root);
  const artifactSha256 = await hashEntries(files, (relativePath) => readFile(resolve(root, relativePath)));
  const manifest = {
    schemaVersion: MANIFEST_VERSION,
    commitSha: expectedSha,
    files,
    artifactSha256,
  };
  await writeFile(resolve(root, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

if (hasArgument("--write-manifest")) await writeManifest();
if (artifactRoot) await verifyLocalArtifact();
else await verifyRemoteArtifact();
