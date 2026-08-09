import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES } from "../../src/config/rules.js";
import { advanceGame, createGame, detonate, selectEntity, validateGame } from "../../src/core/engine.js";

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

test("selection preparation points are recorded in the score ledger", () => {
  const state = createGame(12, DEFAULT_RULES);
  advanceGame(state, 780, DEFAULT_RULES);
  const candidates = state.fireworks
    .filter((entity) => entity.waveIndex === 4 && entity.status === "active" && entity.visible)
    .slice(0, 4);
  for (let index = 0; index < candidates.length; index += 1) {
    advanceGame(state, 780 + index, DEFAULT_RULES);
    const entity = state.fireworks.find((candidate) => candidate.id === candidates[index].id);
    assert.ok(selectEntity(state, entity.id, DEFAULT_RULES, { x: entity.x, y: entity.y }));
  }
  advanceGame(state, 784, DEFAULT_RULES);
  assert.equal(detonate(state, DEFAULT_RULES, 44), true);
  assert.deepEqual(state.bonusEvents.map((event) => ({
    actionId: event.actionId,
    preparationAmount: event.preparationAmount,
    amount: event.amount,
  })), [{ actionId: 44, preparationAmount: 120, amount: 120 }]);
  assert.equal(
    state.score,
    [...state.scoreEvents, ...state.bonusEvents].reduce((sum, event) => sum + event.amount, 0),
  );
  assert.deepEqual(validateGame(state), []);
});
