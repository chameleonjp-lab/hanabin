import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_RULES,
  STRATEGY_NAMES,
  advanceGame,
  compareStrategies,
  createGame,
  detonate,
  runSimulation,
  scoreForChain,
  selectEntity,
  snapshotGame,
} from "../../src/core/index.js";

const firework = (id, x, color = 0) => ({
  id,
  waveId: "score-fixture",
  waveIndex: 0,
  localIndex: id,
  color,
  x,
  y: 4_500,
  baseX: x,
  baseY: 4_500,
  vx: 0,
  vy: 0,
  depth: 100,
  radius: DEFAULT_RULES.entityRadius,
  spawnTick: 0,
  lifetimeTicks: 300,
  expiresTick: 300,
  layout: "center",
  visible: true,
  status: "active",
  scored: false,
});

test("the seven comparison strategies keep the planned public identities", () => {
  assert.deepEqual(STRATEGY_NAMES, [
    "random",
    "shortest-three",
    "wait-six",
    "full-sweep",
    "idle-first-half",
    "forecast",
    "dense-detonation",
  ]);
});

test("chain score growth is capped after the seventh generation", () => {
  assert.equal(scoreForChain(1), 150);
  assert.equal(scoreForChain(7), 258);
  assert.equal(scoreForChain(8), 258);
  assert.equal(scoreForChain(100), 258);
});

test("a selection of three auto-detonates at the 150 tick boundary", () => {
  const state = createGame(123);
  const ids = state.fireworks.slice(0, 3).map((entity) => entity.id);
  for (let index = 0; index < ids.length; index += 1) {
    advanceGame(state, index, DEFAULT_RULES);
    const entity = state.fireworks.find((candidate) => candidate.id === ids[index]);
    assert.ok(selectEntity(state, ids[index], DEFAULT_RULES, { x: entity.x, y: entity.y }));
  }
  advanceGame(state, 150, DEFAULT_RULES);
  assert.equal(state.stats.detonationCount, 1);
  assert.equal(state.lastDetonationTick, 150);
  assert.deepEqual(state.selectedIds, []);
  assert.ok(state.score >= 300);
});

test("the first chain capture scores 150 plus the fourth-target inclusion bonus", () => {
  const state = createGame(321);
  state.fireworks = [
    firework(1, 4_000),
    firework(2, 4_060),
    firework(3, 4_120),
    firework(4, 4_300),
  ];
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  for (let index = 0; index < 3; index += 1) {
    advanceGame(state, index, DEFAULT_RULES);
    selectEntity(state, index + 1, DEFAULT_RULES, { x: 4_000 + index * 60, y: 4_500 });
  }
  advanceGame(state, 3, DEFAULT_RULES);
  assert.equal(detonate(state, DEFAULT_RULES), true);
  advanceGame(state, 4, DEFAULT_RULES);
  const chainEvent = state.scoreEvents.find((event) => event.kind === "chain");
  assert.deepEqual(
    {
      generation: chainEvent.generation,
      sourceId: chainEvent.sourceId,
      baseAmount: chainEvent.baseAmount,
      inclusionAmount: chainEvent.inclusionAmount,
      amount: chainEvent.amount,
    },
    { generation: 1, sourceId: 1, baseAmount: 150, inclusionAmount: 40, amount: 190 },
  );
  assert.equal(state.score, 490);
});

test("engine collision uses each selected firework center and the full direct radius", () => {
  const state = createGame(320);
  state.fireworks = [
    firework(1, 2_000),
    firework(2, 4_000),
    firework(3, 6_000),
    firework(4, 7_700),
  ];
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  for (let index = 0; index < 3; index += 1) {
    advanceGame(state, index, DEFAULT_RULES);
    assert.ok(selectEntity(state, index + 1, DEFAULT_RULES, {
      x: 2_000 + index * 2_000,
      y: 4_500,
    }));
  }
  advanceGame(state, 3, DEFAULT_RULES);
  assert.equal(detonate(state, DEFAULT_RULES), true);
  advanceGame(state, 4, DEFAULT_RULES);
  const capture = state.chainEvents.find((event) => event.targetId === 4);
  assert.ok(capture, "a same-color target at 1,700 is inside the direct radius");
  assert.equal(capture.radius, 1_620, "attenuation applies to the caught target's next explosion");

  const shifted = createGame(321);
  shifted.fireworks = [
    firework(1, 2_000),
    firework(2, 4_000),
    firework(3, 6_000),
    firework(4, 8_220),
  ];
  shifted.pendingEntities = [];
  shifted.waves = [];
  shifted.nextWaveIndex = DEFAULT_RULES.maxWaves;
  for (let index = 0; index < 3; index += 1) {
    advanceGame(shifted, index, DEFAULT_RULES);
    assert.ok(selectEntity(shifted, index + 1, DEFAULT_RULES, {
      x: 2_420 + index * 2_000,
      y: 4_500,
    }));
  }
  advanceGame(shifted, 3, DEFAULT_RULES);
  assert.equal(detonate(shifted, DEFAULT_RULES), true);
  advanceGame(shifted, 4, DEFAULT_RULES);
  assert.equal(
    shifted.scoreEvents.some((event) => event.targetId === 4),
    false,
    "touching the edge of a hit area cannot shift the explosion center by 420 units",
  );
});

test("a moving firework entering an active explosion is captured", () => {
  const state = createGame(319);
  state.fireworks = [
    firework(1, 4_000),
    firework(2, 4_060),
    firework(3, 4_120),
    { ...firework(4, 6_500), vx: -100, baseX: 6_500 },
  ];
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  for (let index = 0; index < 3; index += 1) {
    advanceGame(state, index, DEFAULT_RULES);
    const entity = state.fireworks[index];
    assert.ok(selectEntity(state, entity.id, DEFAULT_RULES, { x: entity.x, y: entity.y }));
  }
  advanceGame(state, 3, DEFAULT_RULES);
  assert.equal(detonate(state, DEFAULT_RULES), true);
  advanceGame(state, 5, DEFAULT_RULES);
  assert.equal(state.scoreEvents.some((event) => event.targetId === 4), false);
  advanceGame(state, 7, DEFAULT_RULES);
  assert.equal(state.scoreEvents.some((event) => event.targetId === 4), true);
});

test("a firework captured by an older chain cannot become a newer selection", () => {
  const state = createGame(322);
  state.fireworks = [
    firework(1, 4_000),
    firework(2, 4_060),
    firework(3, 4_120),
    firework(4, 4_300),
  ];
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  for (let index = 0; index < 3; index += 1) {
    advanceGame(state, index, DEFAULT_RULES);
    selectEntity(state, index + 1, DEFAULT_RULES, { x: 4_000 + index * 60, y: 4_500 });
  }
  advanceGame(state, 3, DEFAULT_RULES);
  detonate(state, DEFAULT_RULES);
  assert.equal(selectEntity(state, 4, DEFAULT_RULES, { x: 4_300, y: 4_500 }), null);
  advanceGame(state, 4, DEFAULT_RULES);
  assert.deepEqual(state.selectedIds, []);
  assert.equal(state.scoreEvents.filter((event) => event.targetId === 4).length, 1);
});

test("jumped advance matches one-tick chain resolution", () => {
  const initial = createGame(323);
  initial.fireworks = [
    firework(1, 4_000),
    firework(2, 4_060),
    firework(3, 4_120),
    firework(4, 4_300),
    firework(5, 4_440),
  ];
  initial.pendingEntities = [];
  initial.waves = [];
  initial.nextWaveIndex = DEFAULT_RULES.maxWaves;
  for (let index = 0; index < 3; index += 1) {
    advanceGame(initial, index, DEFAULT_RULES);
    selectEntity(initial, index + 1, DEFAULT_RULES, {
      x: 4_000 + index * 60,
      y: 4_500,
    });
  }
  advanceGame(initial, 3, DEFAULT_RULES);
  assert.equal(detonate(initial, DEFAULT_RULES), true);

  const jumped = structuredClone(initial);
  const stepped = structuredClone(initial);
  advanceGame(jumped, 12, DEFAULT_RULES);
  for (let tick = 4; tick <= 12; tick += 1) advanceGame(stepped, tick, DEFAULT_RULES);
  assert.deepEqual(snapshotGame(jumped), snapshotGame(stepped));
});

test("comparison scores come from the same unskipped 3600-tick strategy run", () => {
  const comparison = compareStrategies({ seedCount: 1, startSeed: 0 });
  for (const strategy of STRATEGY_NAMES) {
    const direct = runSimulation(0, {
      strategy,
      summaryOnly: true,
      summaryStride: 1,
    });
    assert.equal(comparison.byStrategy[strategy].scoreSum, direct.score, strategy);
    assert.equal(direct.processedTicks, 3_600, strategy);
  }
});

test("the 3600 tick boundary releases a valid selection and resolves the final chain", () => {
  const state = createGame(987);
  advanceGame(state, 3_590, DEFAULT_RULES);
  const activeByColor = Map.groupBy(
    state.fireworks.filter((entity) => entity.status === "active" && entity.visible),
    (entity) => entity.color,
  );
  const candidates = [...activeByColor.values()].find((entities) => entities.length >= 3);
  assert.ok(candidates, "the final active wave exposes a selectable trio");
  for (let index = 0; index < 3; index += 1) {
    advanceGame(state, 3_590 + index, DEFAULT_RULES);
    assert.ok(selectEntity(state, candidates[index].id, DEFAULT_RULES, {
      x: candidates[index].x,
      y: candidates[index].y,
    }));
  }

  advanceGame(state, 3_600, DEFAULT_RULES);

  assert.equal(state.simulationFault, null);
  assert.equal(state.status, "finished");
  assert.equal(state.stats.detonationCount, 1);
  assert.deepEqual(state.selectedIds, []);
  assert.deepEqual(state.chainQueue, []);
  assert.deepEqual(state.activeExplosions, []);
  assert.ok(state.resolutionTick >= 3_630 && state.resolutionTick <= 3_750);
  assert.equal(state.finalScore, state.score);
});

test("an explosion that survives beyond the final 150 ticks becomes a fault", () => {
  const state = createGame(654);
  state.activeExplosions.push({
    actionId: 0,
    eventId: 1,
    sourceId: 1,
    targetId: 1,
    fireTick: 3_600,
    endTick: 3_751,
    durationTicks: 151,
    radius: 1_800,
    kind: "chain",
  });
  advanceGame(state, 3_600, DEFAULT_RULES);
  assert.equal(state.status, "fault");
  assert.equal(state.simulationFault?.code, "CHAIN_TICK_LIMIT");
});
