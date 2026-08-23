import { performance } from "node:perf_hooks";
import { appendFileSync, writeFileSync } from "node:fs";
import { DEFAULT_RULES, rulesFingerprint } from "../src/config/rules.js";
import { RELEASE_MANIFEST } from "../src/config/release.js";
import { replayGame } from "../src/core/replay.js";
import { compareStrategies, runSafetySweep, runSimulation } from "../src/core/simulation.js";
import { stateFingerprint } from "../src/core/state.js";
import { STRATEGY_NAMES } from "../src/core/strategies.js";

const startedAt = performance.now();
const safetyStartedAt = performance.now();
const safety = runSafetySweep({ seedCount: 10_000 });
const safetyElapsedMs = performance.now() - safetyStartedAt;
const comparisonStartedAt = performance.now();
const comparison = compareStrategies({ seedCount: 1_000 });
const comparisonElapsedMs = performance.now() - comparisonStartedAt;
const replayAudit = STRATEGY_NAMES.map((strategy) => {
  const simulation = runSimulation(0, { strategy });
  const replayed = replayGame(simulation.replay);
  return {
    strategy,
    score: simulation.score,
    replayScore: replayed.state.score,
    finalStateMatched: !replayed.simulationFault &&
      stateFingerprint(simulation.state) === stateFingerprint(replayed.state),
  };
});

// The core API keeps compatibility fields for callers, but the CI artifact
// contains only O(1) aggregate evidence rather than 8,000 per-case records.
const compact = {
  metadata: {
    ...RELEASE_MANIFEST,
    rulesFingerprint: rulesFingerprint(DEFAULT_RULES),
    commitSha: process.env.GITHUB_SHA ?? null,
    strategyNames: [...STRATEGY_NAMES],
  },
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
    generatedWavesInspected: safety.generatedWavesInspected,
    unselectableWaves: safety.unselectableWaves,
    unselectableSeeds: safety.unselectableSeeds,
    exactOverlapViolations: safety.exactOverlapViolations,
    forecastMismatches: safety.forecastMismatches,
    generationRuleViolations: safety.generationRuleViolations,
    strategyRngLeaks: safety.strategyRngLeaks,
    maxSelectableWaveGapTicks: safety.maxSelectableWaveGapTicks,
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
  replayAudit,
  elapsedMs: performance.now() - startedAt,
};
const report = `${JSON.stringify(compact, null, 2)}\n`;
writeFileSync("m2-simulation-report.json", report, "utf8");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## M4 deterministic gameplay gate",
    "",
    `- Rule: ${compact.metadata.ruleVersion} / ${compact.metadata.rulesFingerprint}`,
    `- Commit: ${compact.metadata.commitSha ?? "local-uncommitted"}`,
    `- Safety: ${safety.processedSeeds} seeds / ${safety.faults} faults / ${safety.invalidStates} invalid states`,
    `- Generation: ${safety.generatedWavesInspected} waves / ${safety.unselectableWaves} unselectable / ${safety.exactOverlapViolations} exact overlaps`,
    `- Comparison: ${comparison.processedRuns} runs / ${comparison.strategyCount} strategies`,
    `- Replay audit: ${replayAudit.filter((entry) => entry.finalStateMatched).length}/${replayAudit.length} strategies matched`,
    `- Elapsed: ${(compact.elapsedMs / 1000).toFixed(1)} seconds`,
    "",
  ].join("\n"), "utf8");
}
if (!safety.ok || !comparison.ok || replayAudit.some((entry) => !entry.finalStateMatched)) {
  process.exitCode = 1;
}
