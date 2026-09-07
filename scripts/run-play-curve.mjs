import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

import { DEFAULT_RULES, rulesFingerprint } from "../src/config/rules.js";
import { RELEASE_MANIFEST } from "../src/config/release.js";
import { comparePlayCurve } from "../src/core/simulation.js";

const seedCount = Number.isInteger(Number(process.env.HANABIN_PLAY_CURVE_SEEDS))
  ? Number(process.env.HANABIN_PLAY_CURVE_SEEDS)
  : 1_000;
const startedAt = performance.now();
const comparison = comparePlayCurve({ seedCount });
const report = {
  metadata: {
    ...RELEASE_MANIFEST,
    rulesFingerprint: rulesFingerprint(DEFAULT_RULES),
    commitSha: process.env.GITHUB_SHA ?? null,
    seedCount,
    metric: "deterministic strategy comparison grouped by five play-curve bands",
  },
  processedRuns: comparison.processedRuns,
  winner: comparison.winner,
  ok: comparison.ok,
  strategies: Object.fromEntries(Object.entries(comparison.byStrategy).map(([name, summary]) => [name, {
    strategy: name,
    processedSeeds: summary.processedSeeds,
    averageScore: summary.averageScore,
    averageMaxChain: summary.averageMaxChain,
    playCurve: summary.playCurve,
  }])),
  elapsedMs: performance.now() - startedAt,
};

writeFileSync("m2-play-curve-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!comparison.ok) process.exitCode = 1;
