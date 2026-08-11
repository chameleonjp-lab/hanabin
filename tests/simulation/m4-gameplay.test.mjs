import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_RULES,
  compareStrategies,
  createGame,
  directExplosionRadiusForSelection,
  generateWave,
  runSimulation,
  waveTickAt,
} from "../../src/core/index.js";
import { forecastMarkup } from "../../src/ui/hud.js";

const countColor = (wave, color) => wave.entities.filter((entity) => entity.color === color).length;

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
  const waitSix = comparison.byStrategy["wait-six"];
  assert.ok(Number.isFinite(forecast.averageForecastMatches));
  assert.ok(Number.isFinite(forecast.forecastMatchRate));
  assert.ok(forecast.averageForecastMatches > 0);
  assert.equal(DEFAULT_RULES.forecastPlanSelectionCount, 5);
  assert.equal(DEFAULT_RULES.score.forecastPlanBonus, DEFAULT_RULES.forecastPlanBonus);
  assert.equal(
    DEFAULT_RULES.score.forecastPlanChainBonusPerTarget,
    DEFAULT_RULES.forecastPlanChainBonusPerTarget,
  );
  assert.ok(forecast.averageScore > waitSix.averageScore);
  assert.ok(forecast.medianScore > waitSix.medianScore);
  const sample = runSimulation(0, { strategy: "forecast" });
  assert.ok(sample.state.scoreEvents.some((event) => event.forecastPlanAmount > 0));
  assert.ok(sample.state.scoreEvents
    .filter((event) => event.forecastPlanAmount > 0)
    .every((event) => event.forecastPlanAmount === DEFAULT_RULES.forecastPlanChainBonusPerTarget));
  assert.deepEqual(sample.invariantErrors, []);
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
