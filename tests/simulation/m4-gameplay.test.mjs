import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_RULES,
  advanceGame,
  compareStrategies,
  createGame,
  detonate,
  directExplosionRadiusForSelection,
  generateWave,
  runSimulation,
  selectEntity,
  validateGame,
  waveTickAt,
} from "../../src/core/index.js";
import { forecastMarkup } from "../../src/ui/hud.js";
import { scoreBreakdownFor } from "../../src/ui/result.js";

const countColor = (wave, color) => wave.entities.filter((entity) => entity.color === color).length;

const fixtureFirework = ({
  id,
  x,
  waveIndex = 0,
  forecastForWaveIndex = 1,
}) => ({
  id,
  waveId: `wave-${waveIndex}`,
  waveIndex,
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
  lifetimeTicks: 4_000,
  expiresTick: 4_000,
  layout: "center",
  forecastForWaveIndex,
  visible: true,
  status: "active",
  scored: false,
});

const forecastFixture = (leadTicks, { chainTargets = false } = {}) => {
  const state = createGame(404, DEFAULT_RULES);
  state.fireworks = Array.from({ length: 5 }, (_, index) => fixtureFirework({
    id: index + 1,
    x: 1_000 + index * 100,
  }));
  if (chainTargets) {
    state.fireworks.push(
      fixtureFirework({ id: 6, x: 3_600, waveIndex: 1, forecastForWaveIndex: null }),
      fixtureFirework({ id: 7, x: 5_500, waveIndex: 2, forecastForWaveIndex: null }),
    );
  }
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  state.upcomingWaveIndex = DEFAULT_RULES.maxWaves;
  state.upcomingWaves = [];
  advanceGame(state, 100, DEFAULT_RULES);
  for (let index = 0; index < 5; index += 1) {
    advanceGame(state, 100 + index, DEFAULT_RULES);
    assert.ok(selectEntity(state, index + 1, DEFAULT_RULES, {
      x: 1_000 + index * 100,
      y: 4_500,
    }));
  }
  state.upcomingWaves = [{
    waveId: "wave-1",
    waveIndex: 1,
    primaryColor: 0,
    fireTick: state.tick + leadTicks,
  }];
  assert.equal(detonate(state, DEFAULT_RULES, 77), true);
  return state;
};

test("M4 waves expose a deliberate five-firework setup for the next forecast color", () => {
  for (const seed of [0, 1, 7, 42, 987]) {
    for (let waveIndex = 0; waveIndex < 12; waveIndex += 1) {
      const wave = generateWave(seed, waveIndex, DEFAULT_RULES);
      const next = generateWave(seed, waveIndex + 1, DEFAULT_RULES);
      assert.ok(
        countColor(wave, next.primaryColor) >= DEFAULT_RULES.minSelection,
        `seed ${seed}, wave ${waveIndex} must offer the next forecast color`,
      );
      assert.ok(wave.entities.every((entity) => entity.x >= 0 && entity.x <= DEFAULT_RULES.boardWidth));
      assert.ok(wave.entities.every((entity) => entity.y >= 0 && entity.y <= DEFAULT_RULES.boardHeight));
      assert.equal(wave.fireTick, waveTickAt(waveIndex, DEFAULT_RULES));
    }
  }
});

test("the M4 comparison keeps preview and timing evidence in the public result", () => {
  const comparison = compareStrategies({ seedCount: 100 });
  const forecast = comparison.byStrategy.forecast;
  const shortestFive = comparison.byStrategy["shortest-five"];
  const waitSix = comparison.byStrategy["wait-six"];
  const fullSweep = comparison.byStrategy["full-sweep"];
  assert.ok(Number.isFinite(forecast.averageForecastMatches));
  assert.ok(Number.isFinite(forecast.forecastMatchRate));
  assert.ok(forecast.averageForecastMatches > 0);
  assert.equal(DEFAULT_RULES.forecastPlanSelectionCount, 5);
  assert.equal(DEFAULT_RULES.forecastPlanLeadTicks, 60);
  assert.equal(DEFAULT_RULES.forecastChainPerTarget, 150);
  assert.equal(DEFAULT_RULES.score.forecastPlanBonus, DEFAULT_RULES.forecastPlanBonus);
  assert.equal(DEFAULT_RULES.score.forecastChainPerTarget, DEFAULT_RULES.forecastChainPerTarget);
  assert.equal(
    DEFAULT_RULES.score.forecastPlanChainBonusPerTarget,
    DEFAULT_RULES.forecastPlanChainBonusPerTarget,
  );
  assert.ok(forecast.averageScore > waitSix.averageScore);
  assert.ok(forecast.medianScore > waitSix.medianScore);
  assert.ok(forecast.averageScore > shortestFive.averageScore);
  assert.ok(forecast.medianScore > shortestFive.medianScore);
  assert.equal(comparison.winner, "forecast");
  assert.ok(fullSweep.averageScore < forecast.averageScore * 0.6);
  assert.ok(forecast.averageScore < shortestFive.averageScore * 2);
  assert.ok(forecast.averageForecastPlanCount > 0);
  assert.ok(forecast.forecastScoreRatio >= 0.25 && forecast.forecastScoreRatio <= 0.4);
  const sample = runSimulation(0, { strategy: "forecast" });
  assert.ok(sample.state.scoreEvents.some((event) => event.forecastPlanAmount > 0));
  assert.ok(sample.state.scoreEvents
    .filter((event) => event.forecastPlanAmount > 0)
    .every((event) => {
      const target = sample.state.fireworks.find((entity) => entity.id === event.targetId);
      return event.forecastPlanAmount === DEFAULT_RULES.forecastChainPerTarget &&
        target?.waveIndex === event.forecastWaveIndex;
    }));
  assert.deepEqual(sample.invariantErrors, []);
});

test("result score ledgers reconcile with real simulation scores across strategies", () => {
  for (const strategy of [
    "random",
    "shortest-three",
    "shortest-five",
    "wait-six",
    "full-sweep",
    "idle-first-half",
    "forecast",
    "dense-detonation",
  ]) {
    const { state } = runSimulation(123, { strategy });
    const breakdown = scoreBreakdownFor(state);
    assert.equal(breakdown.total, state.score, `${strategy} live score`);
    assert.equal(breakdown.total, state.finalScore, `${strategy} final score`);
  }
});

test("forecast plans only qualify in the inclusive 1..60 tick lead window", () => {
  for (const [leadTicks, expected] of [[61, false], [60, true], [1, true], [0, false]]) {
    const state = forecastFixture(leadTicks);
    const bonus = state.bonusEvents.at(-1);
    assert.equal(bonus.forecastPlanAmount > 0, expected, `lead=${leadTicks}`);
    assert.equal(bonus.forecastWaveIndex, expected ? 1 : null, `lead=${leadTicks}`);
    assert.equal(bonus.forecastLeadTicks, leadTicks, `lead=${leadTicks}`);
    assert.equal(bonus.forecastBridgeCount, 5, `lead=${leadTicks}`);
  }
});

test("forecast chain metadata propagates but only the forecast wave earns 150 points", () => {
  const state = forecastFixture(60, { chainTargets: true });
  advanceGame(state, 106, DEFAULT_RULES);
  const forecastTarget = state.scoreEvents.find((event) => event.targetId === 6);
  const laterTarget = state.scoreEvents.find((event) => event.targetId === 7);
  assert.deepEqual({
    kind: forecastTarget.kind,
    generation: forecastTarget.generation,
    forecastWaveIndex: forecastTarget.forecastWaveIndex,
    forecastPlanAmount: forecastTarget.forecastPlanAmount,
  }, {
    kind: "chain",
    generation: 1,
    forecastWaveIndex: 1,
    forecastPlanAmount: 150,
  });
  assert.deepEqual({
    kind: laterTarget.kind,
    generation: laterTarget.generation,
    forecastWaveIndex: laterTarget.forecastWaveIndex,
    forecastPlanAmount: laterTarget.forecastPlanAmount,
  }, {
    kind: "chain",
    generation: 2,
    forecastWaveIndex: 1,
    forecastPlanAmount: 0,
  });
  assert.equal(state.chainEvents.find((event) => event.targetId === 7)?.forecastWaveIndex, 1);
  assert.equal(state.activeExplosions.find((event) => event.targetId === 7)?.forecastWaveIndex, 1);
  assert.deepEqual(validateGame(state, DEFAULT_RULES), []);
});

test("M4 HUD preview exposes color, position, order, and arrival progress", () => {
  const markup = forecastMarkup([
    { waveId: "wave-1", primaryColor: "blue", position: "left", fireTick: 180 },
    { waveId: "wave-2", primaryColor: "yellow", position: "right", fireTick: 330 },
  ], 60, DEFAULT_RULES);
  assert.match(markup, /data-wave-color="blue"/);
  assert.match(markup, /data-wave-position="left">左/);
  assert.match(markup, /data-wave-fire-tick="180">あと2\.0s/);
  assert.match(markup, /2波/);
  assert.equal(directExplosionRadiusForSelection(5, DEFAULT_RULES), 2_340);
});

test("the next-wave forecast remains deterministic in a fresh game", () => {
  const left = createGame(1234, DEFAULT_RULES);
  const right = createGame(1234, DEFAULT_RULES);
  assert.deepEqual(left.upcomingWaves, right.upcomingWaves);
  assert.deepEqual(left.waves, right.waves);
});
