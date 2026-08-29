import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES } from "../../src/config/rules.js";
import {
  advanceGame,
  createGame,
  detonate,
  playableChoiceCount,
  validateGame,
} from "../../src/core/engine.js";

const fixtureEntity = ({ id, x, layout = "choice-reserve" }) => ({
  id,
  waveId: "fixture-wave",
  waveIndex: 0,
  localIndex: id,
  color: 0,
  x,
  y: 4_500,
  baseX: x,
  baseY: 4_500,
  vx: 0,
  vy: 0,
  depth: 100,
  radius: DEFAULT_RULES.entityRadius,
  spawnTick: 0,
  lifetimeTicks: DEFAULT_RULES.lifetimeMaxTicks,
  expiresTick: DEFAULT_RULES.lifetimeMaxTicks,
  layout,
  forecastForWaveIndex: null,
  visible: true,
  status: "active",
  scored: false,
});

test("a running game exposes an extra same-colour choice beyond the minimum", () => {
  const state = createGame(101, DEFAULT_RULES);
  assert.ok(playableChoiceCount(state, DEFAULT_RULES) >= DEFAULT_RULES.minimumPlayableChoices);

  advanceGame(state, 0, DEFAULT_RULES);

  assert.equal(state.status, "running");
  assert.ok(playableChoiceCount(state, DEFAULT_RULES) >= DEFAULT_RULES.minimumPlayableChoices);
  assert.equal(state.stats.choiceGuaranteeGroups, 0);
  assert.equal(state.stats.choiceGuaranteeEntities, 0);
  assert.deepEqual(validateGame(state, DEFAULT_RULES), []);
});

test("the runtime reserve restores choices after the only group disappears", () => {
  const state = createGame(202, DEFAULT_RULES);
  advanceGame(state, 0, DEFAULT_RULES);
  for (const entity of state.fireworks) {
    if (entity.status === "active") {
      entity.status = "expired";
      entity.visible = false;
    }
  }
  state.pendingEntities = [];

  advanceGame(state, 1, DEFAULT_RULES);

  assert.ok(playableChoiceCount(state, DEFAULT_RULES) >= DEFAULT_RULES.minimumPlayableChoices);
  assert.equal(state.stats.choiceGuaranteeGroups, 1);
  assert.equal(state.stats.choiceGuaranteeEntities, 4);
  assert.deepEqual(validateGame(state, DEFAULT_RULES), []);
});

test("choice reserves provide direct recovery points without farming a chain", () => {
  const state = createGame(303, DEFAULT_RULES);
  state.status = "running";
  state.fireworks = [
    fixtureEntity({ id: 1, x: 7_800 }),
    fixtureEntity({ id: 2, x: 8_000 }),
    fixtureEntity({ id: 3, x: 8_200 }),
    fixtureEntity({ id: 4, x: 9_000, layout: "center" }),
  ];
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  state.upcomingWaves = [];
  state.upcomingWaveIndex = DEFAULT_RULES.maxWaves;
  state.selectedIds = [1, 2, 3];
  state.selectedColor = 0;
  state.selectionSinceTick = 0;
  state.selectionAgeTicks = DEFAULT_RULES.minHoldTicks;
  state.selectionRecords = state.selectedIds.map((id) => ({
    id,
    color: 0,
    x: state.fireworks.find((entity) => entity.id === id).x,
    y: 4_500,
    acquiredTick: 0,
  }));

  assert.equal(detonate(state, DEFAULT_RULES, 0), true);
  advanceGame(state, 1, DEFAULT_RULES);

  assert.deepEqual(state.scoreEvents.map((event) => event.targetId), [1, 2, 3]);
  assert.equal(state.fireworks.find((entity) => entity.id === 4).status, "active");
  assert.equal(state.chainEvents.some((event) => event.targetId === 4), false);
  assert.deepEqual(validateGame(state, DEFAULT_RULES), []);
});
