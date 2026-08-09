import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STRATEGIES,
  STRATEGY_NAMES,
  createStrategyContext,
  getStrategy,
} from "../../src/core/strategies.js";

test("exactly seven deterministic strategies are publicly available", () => {
  assert.equal(STRATEGY_NAMES.length, 7);
  assert.equal(new Set(STRATEGY_NAMES).size, 7);
  assert.deepEqual(Object.keys(STRATEGIES).sort(), [...STRATEGY_NAMES].sort());
  for (const name of STRATEGY_NAMES) {
    assert.equal(typeof getStrategy(name), "function");
    const left = createStrategyContext(0, name);
    const right = createStrategyContext(0, name);
    assert.equal(left.strategySeed, right.strategySeed);
    assert.deepEqual(
      Array.from({ length: 4 }, () => left.rng.nextUint32()),
      Array.from({ length: 4 }, () => right.rng.nextUint32()),
    );
  }
});

const assertComparisonShape = (comparison, seedCount) => {
  assert.equal(comparison.requestedSeeds, seedCount);
  assert.equal(comparison.processedSeeds, seedCount);
  assert.equal(comparison.strategies.length, 7);
  assert.equal(Object.keys(comparison.byStrategy).length, 7);
  for (const summary of Object.values(comparison.byStrategy)) {
    assert.equal(summary.processedSeeds, seedCount);
  }
};

const assertSafetyShape = (safety, seedCount) => {
  assert.equal(safety.requestedSeeds, seedCount);
  assert.equal(safety.processedSeeds, seedCount);
  assert.equal(safety.faults, 0);
  assert.equal(safety.invalidStates, 0);
};

test("small comparison and safety inspection expose bounded public results", async () => {
  // Required public API: these calls are deterministic and side-effect free;
  // implementations may optimize internally but cannot reduce requested case
  // counts or silently omit a strategy.
  const simulation = await import("../../src/core/simulation.js");
  assert.equal(typeof simulation.compareStrategies, "function", "missing comparison API");
  assert.equal(typeof simulation.runSafetySweep, "function", "missing safety API");
  assertComparisonShape(simulation.compareStrategies({ seedCount: 3 }), 3);
  assertSafetyShape(simulation.runSafetySweep({ seedCount: 3 }), 3);
});

test("full 1000x7 comparison and 10000-case safety inspection", {
  skip: process.env.HANABIN_FULL_SIMULATION !== "1",
}, async () => {
  const simulation = await import("../../src/core/simulation.js");
  assert.equal(typeof simulation.compareStrategies, "function", "missing comparison API");
  assert.equal(typeof simulation.runSafetySweep, "function", "missing safety API");
  // This is intentionally opt-in so Node22/24's ordinary unit pass does not
  // duplicate the long independent CI job. The requested counts are not
  // reduced when the full verification is enabled.
  assertComparisonShape(simulation.compareStrategies({ seedCount: 1_000 }), 1_000);
  assertSafetyShape(simulation.runSafetySweep({ seedCount: 10_000 }), 10_000);
});
