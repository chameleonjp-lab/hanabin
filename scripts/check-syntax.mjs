import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoots = ["src", "scripts", "tests"];
const supportedExtensions = new Set([".js", ".mjs"]);

const collectJavaScriptFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(entryPath)));
    } else if (supportedExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
};

const files = [];
for (const sourceRoot of sourceRoots) {
  files.push(...(await collectJavaScriptFiles(join(projectRoot, sourceRoot))));
}

files.sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Syntax check passed: ${files.length} JavaScript files`);
