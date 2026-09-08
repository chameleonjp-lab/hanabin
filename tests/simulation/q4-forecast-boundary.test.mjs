import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES, getWaveDefinition } from "../../src/config/rules.js";
import { createGame, detonate } from "../../src/core/engine.js";
import { isWaveWithinSession } from "../../src/core/forecast-bounds.js";
import { generateUpcomingWaves, generateWave } from "../../src/core/wave-generator.js";
import { runSimulation } from "../../src/core/simulation.js";
import { forecastMarkup, forecastReadinessFor } from "../../src/ui/hud.js";

test("Q4 forecast bounds include the terminal spawn boundary but never a later wave", () => {
  for (const [fireTick, expected] of [[3599, true], [3600, true], [3601, false], [-1, false], [NaN, false]]) {
    assert.equal(isWaveWithinSession({ fireTick }), expected, String(fireTick));
  }
  assert.equal(isWaveWithinSession(null), false);
  const last = generateUpcomingWaves(1, 19);
  assert.deepEqual(last.map((wave) => [wave.waveIndex, wave.fireTick]), [[19, 3420]]);
  assert.deepEqual(generateUpcomingWaves(1, 20), []);
});

test("Q4 final wave keeps playable targets without a nonexistent forecast bridge", () => {
  for (const seed of [1, 7, 15, 17]) {
    const penultimate = generateWave(seed, 18);
    assert.equal(penultimate.entities.filter((entity) => entity.forecastForWaveIndex === 19).length, 5);
    const last = generateWave(seed, 19);
    assert.equal(last.entities.length, getWaveDefinition(last.kind).count + 5);
    assert.ok(last.entities.every((entity) => entity.forecastForWaveIndex === null));
  }
});

const preparedSelection = ({ tick, fireTick, waveIndex, count = 5, bridges = 3 }) => {
  const state = createGame(1);
  state.tick = tick;
  state.status = "running";
  state.fireworks = Array.from({ length: count }, (_, index) => ({
    id: index + 1, waveId: "wave-18", waveIndex: 18, color: 0,
    x: 4000 + index * 150, y: 4500, baseX: 4000 + index * 150, baseY: 4500,
    vx: 0, vy: 0, depth: 500, radius: DEFAULT_RULES.entityRadius,
    spawnTick: 3300, lifetimeTicks: 420, expiresTick: 3720,
    layout: "center", status: "active", visible: true, scored: false,
    forecastForWaveIndex: index < bridges ? waveIndex : null,
  }));
  state.selectedIds = state.fireworks.map((entity) => entity.id);
  state.selectionRecords = state.fireworks.map(({ id, color, x, y }) => ({ id, color, x, y }));
  state.selectedColor = 0;
  state.selectionSinceTick = tick - 10;
  state.selectionAgeTicks = 10;
  state.upcomingWaves = [{ waveId: `wave-${waveIndex}`, waveIndex, primaryColor: 0, position: "left", fireTick }];
  return state;
};

test("Q4 stale future metadata cannot invite or award an out-of-session forecast", () => {
  const state = preparedSelection({ tick: 3570, fireTick: 3630, waveIndex: 20 });
  assert.equal(forecastReadinessFor(state).ready, false);
  assert.equal(forecastMarkup(state.upcomingWaves, state.tick), "");
  assert.equal(detonate(state), true);
  assert.ok(state.score > 0, "ordinary direct/preparation score remains valid");
  assert.equal(state.bonusEvents.at(-1).forecastPlanAmount, 0);
  assert.equal(state.bonusEvents.at(-1).forecastWaveIndex, null);
});

test("Q4 last real wave retains exact count, bridge and lead-time requirements", () => {
  for (const [count, bridges, lead, qualifies] of [
    [4, 3, 30, false], [5, 2, 30, false], [5, 3, 60, true],
    [5, 3, 1, true], [5, 3, 61, false], [5, 3, 0, false], [6, 3, 30, false],
  ]) {
    const state = preparedSelection({ tick: 3420 - lead, fireTick: 3420, waveIndex: 19, count, bridges });
    const readiness = forecastReadinessFor(state);
    assert.equal(readiness.ready, qualifies, JSON.stringify({ count, bridges, lead }));
    if (count === 6) assert.match(forecastMarkup(state.upcomingWaves, state.tick, DEFAULT_RULES, readiness), /5個限定・今は通常起爆/);
    assert.equal(detonate(state), true);
    assert.equal(state.bonusEvents.at(-1).forecastPlanAmount, qualifies ? 1000 : 0);
  }
});

test("Q4 observed terminal exploit seeds finish deterministically without future-wave bonuses", () => {
  for (const seed of [1, 7, 15, 17]) {
    const run = runSimulation(seed, { strategy: "forecast" });
    assert.equal(run.simulationFault, null, `seed ${seed}`);
    assert.deepEqual(run.invariantErrors, [], `seed ${seed}`);
    assert.equal(run.replay.ruleVersion, "m4-gameplay-4");
    const spawned = new Set(run.state.waves.map((wave) => wave.waveIndex));
    assert.equal(spawned.has(19), true, `seed ${seed}: the final real wave is spawned`);
    assert.ok(run.state.scoreEvents.some((event) => event.fireTick >= 3420 &&
      event.forecastPlanAmount === 0), `seed ${seed}: forecast strategy keeps ordinary post-final-wave play`);
    assert.ok(run.state.bonusEvents.filter((event) => event.forecastPlanAmount > 0)
      .every((event) => spawned.has(event.forecastWaveIndex)), `seed ${seed}: every bonus references a spawned wave`);
    assert.deepEqual(run.state.upcomingWaves, []);
  }
});
