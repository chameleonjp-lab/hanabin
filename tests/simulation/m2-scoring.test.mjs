import assert from "node:assert/strict";
import { test } from "node:test";

test("provisional scoring adds direct, preparation, chain, and inclusion events", async () => {
  // Required public API: score components are integer events. Selection-count
  // radius and hold-duration multipliers must not multiply this total.
  const scoring = await import("../../src/core/scoring.js");
  for (const name of [
    "scoreForDirect",
    "scoreForPreparation",
    "scoreForChain",
    "scoreForInclusion",
    "calculateScore",
  ]) {
    assert.equal(typeof scoring[name], "function", `missing public scoring API: ${name}`);
  }
  assert.equal(scoring.scoreForDirect(1), 100);
  assert.equal(scoring.scoreForPreparation(3), 0);
  assert.equal(scoring.scoreForPreparation(8), 600);
  assert.equal(scoring.scoreForChain(1), 150);
  assert.equal(scoring.scoreForChain(2), 168);
  assert.equal(scoring.scoreForChain(7), 258);
  assert.equal(scoring.scoreForInclusion(3), 0);
  assert.equal(scoring.scoreForInclusion(30), 800);

  const fourSelected = scoring.calculateScore({
    directCount: 1,
    selectedCount: 4,
    chainGenerations: [1],
    includedCount: 4,
    durationTicks: 6,
  });
  assert.equal(typeof fourSelected, "number");
  assert.equal(fourSelected, 410);
  const sixSelected = scoring.calculateScore({
    directCount: 1,
    selectedCount: 6,
    chainGenerations: [1],
    includedCount: 6,
    durationTicks: 6,
  });
  assert.equal(sixSelected, 730);
});
