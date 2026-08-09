import { performance } from "node:perf_hooks";
import { appendFileSync, writeFileSync } from "node:fs";
import { compareStrategies, runSafetySweep } from "../src/core/simulation.js";

const startedAt = performance.now();
const safetyStartedAt = performance.now();
const safety = runSafetySweep({ seedCount: 10_000 });
const safetyElapsedMs = performance.now() - safetyStartedAt;
const comparisonStartedAt = performance.now();
const comparison = compareStrategies({ seedCount: 1_000 });
const comparisonElapsedMs = performance.now() - comparisonStartedAt;

// The core API keeps compatibility fields for callers, but the CI artifact
// contains only O(1) aggregate evidence rather than 7,000 per-case records.
const compact = {
  safety: {
    requestedSeeds: safety.requestedSeeds,
    processedSeeds: safety.processedSeeds,
    processedTicks: safety.processedTicks,
    faults: safety.faults,
    invalidStates: safety.invalidStates,
    nondeterministicSeeds: safety.nondeterministicSeeds,
    minScore: safety.minScore,
    maxScore: safety.maxScore,
    maxEntities: safety.maxEntities,
    maxChain: safety.maxChain,
    maxChainDurationTicks: safety.maxChainDurationTicks,
    waveCounts: safety.waveCounts,
    ok: safety.ok,
    elapsedMs: safetyElapsedMs,
  },
  comparison: {
    requestedSeeds: comparison.requestedSeeds,
    processedSeeds: comparison.processedSeeds,
    processedTicksPerStrategy: 3_600 * comparison.requestedSeeds,
    strategyCount: comparison.strategyCount,
    strategies: comparison.strategies,
    winner: comparison.winner,
    ok: comparison.ok,
    elapsedMs: comparisonElapsedMs,
    byStrategy: comparison.byStrategy,
  },
  elapsedMs: performance.now() - startedAt,
};
const report = `${JSON.stringify(compact, null, 2)}\n`;
writeFileSync("m2-simulation-report.json", report, "utf8");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## M2 deterministic simulation gate",
    "",
    `- Safety: ${safety.processedSeeds} seeds / ${safety.faults} faults / ${safety.invalidStates} invalid states`,
    `- Comparison: ${comparison.processedRuns} runs / ${comparison.strategyCount} strategies`,
    `- Elapsed: ${(compact.elapsedMs / 1000).toFixed(1)} seconds`,
    "",
  ].join("\n"), "utf8");
}
if (!safety.ok || !comparison.ok) process.exitCode = 1;
