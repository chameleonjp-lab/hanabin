import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_RULES,
  WAVE_KINDS,
  createGame,
  applyInputFrame,
  advanceGame,
  snapshotGame,
  validateGame,
  generateWave,
  createRng,
  xorshift32,
  createReplayLog,
  validateReplayLog,
  replayGame,
  replayDeterministic,
  runSimulation,
  STRATEGY_NAMES,
} from "../../src/core/index.js";

test("M2 fixed-point rules are explicit and bounded", () => {
  assert.equal(DEFAULT_RULES.colorCount, 4);
  assert.equal(DEFAULT_RULES.boardWidth, 16_000);
  assert.equal(DEFAULT_RULES.boardHeight, 9_000);
  assert.equal(DEFAULT_RULES.tickRate, 60);
  assert.equal(DEFAULT_RULES.maxTicks, 3_600);
  assert.equal(DEFAULT_RULES.minimumSelection, 3);
  assert.equal(DEFAULT_RULES.selectionHoldTicks, 3);
  assert.equal(DEFAULT_RULES.selectionLinkDistance, 5_140);
  assert.equal(DEFAULT_RULES.selectionHitRadius, 520);
  assert.equal(DEFAULT_RULES.selectionTimeoutTicks, 150);
  assert.deepEqual([DEFAULT_RULES.lifetimeMinTicks, DEFAULT_RULES.lifetimeMaxTicks], [240, 420]);
  assert.deepEqual([DEFAULT_RULES.sameColorRadius, DEFAULT_RULES.differentColorRadius], [90, 78]);
});

test("xorshift32 and waves are deterministic", () => {
  assert.equal(xorshift32(1), xorshift32(1));
  const first = createRng(123).nextUint32();
  const second = createRng(123).nextUint32();
  assert.equal(first, second);
  const wave = generateWave(123, 0);
  assert.equal(wave.kind, WAVE_KINDS[0]);
  // M4 adds five forecast-bridge fireworks to the original five opening
  // targets so the next-wave preview is actionable.
  assert.equal(wave.entities.length, 10);
  for (const candidate of wave.entities) {
    assert.equal(Number.isInteger(candidate.x), true);
    assert.equal(Number.isInteger(candidate.y), true);
    assert.ok(candidate.lifetimeTicks >= 240 && candidate.lifetimeTicks <= 420);
  }
});

test("pointer input acquires one candidate after three consecutive holds", () => {
  const state = createGame(123);
  const candidate = state.fireworks[0];
  applyInputFrame(state, { tick: 0, actionId: 0, type: "pointer", pressed: true, x: candidate.x, y: candidate.y });
  applyInputFrame(state, { tick: 1, actionId: 1, type: "pointer", pressed: true, x: candidate.x, y: candidate.y });
  assert.equal(state.selectedIds.length, 0);
  applyInputFrame(state, { tick: 2, actionId: 2, type: "pointer", pressed: true, x: candidate.x, y: candidate.y });
  assert.deepEqual(state.selectedIds, [candidate.id]);
  assert.equal(state.lastAcquisitionX, candidate.x);
  assert.deepEqual(validateGame(state), []);
});

test("three acquisitions can detonate and target IDs cannot score twice", () => {
  const state = createGame(777);
  let actionId = 0;
  let tick = 0;
  for (const candidate of state.fireworks.slice(0, 3)) {
    for (let hold = 0; hold < 3; hold += 1) {
      applyInputFrame(state, {
        tick,
        actionId,
        type: "pointer",
        pressed: true,
        x: candidate.x,
        y: candidate.y,
      });
      tick += 1;
      actionId += 1;
    }
  }
  assert.equal(state.selectedIds.length, 3);
  applyInputFrame(state, { tick, actionId, type: "pointer", pressed: false, x: 0, y: 0 });
  const scoreAfterFirst = state.score;
  advanceGame(state, tick + 20);
  assert.equal(state.score, scoreAfterFirst);
  assert.equal(new Set(state.scoreEvents.map((event) => event.targetId)).size, state.scoreEvents.length);
  assert.deepEqual(validateGame(state), []);
});

test("replay metadata is strict and a complete replay is deterministic", () => {
  assert.throws(() => createReplayLog({ seed: 1, rules: DEFAULT_RULES, frames: [] }), /Invalid replay/);
  assert.ok(validateReplayLog({ seed: 1, ruleVersion: DEFAULT_RULES.ruleVersion, inputSchemaVersion: DEFAULT_RULES.inputSchemaVersion, maxTicks: 3_600, frames: [] }).length);
  const simulation = runSimulation(44, { strategy: "shortest-three" });
  assert.equal(simulation.replay.ruleVersion, "m4-gameplay-3");
  assert.equal(simulation.replay.frames.length, 3_600);
  const legacyReplay = replayGame({
    ...simulation.replay,
    ruleVersion: "m4-gameplay-1",
  });
  assert.equal(legacyReplay.simulationFault?.code, "INVALID_REPLAY");
  assert.ok(legacyReplay.validationErrors.includes("RULE_VERSION"));
  const replay = replayGame(simulation.replay);
  assert.equal(replay.simulationFault, null);
  assert.equal(replay.state.score, simulation.state.score);
  assert.equal(replay.state.tick, simulation.state.tick);
  assert.equal(replay.state.inputFrames.length, simulation.state.inputFrames.length);
  const deterministic = replayDeterministic(simulation.replay);
  assert.equal(deterministic.deterministic, true);
  assert.deepEqual(deterministic.first.validationErrors, []);
  assert.deepEqual(deterministic.first.state, simulation.state);
  assert.deepEqual(deterministic.second.state, simulation.state);
});

test("eight strategies remain bounded and fault-free for one seed", () => {
  assert.equal(STRATEGY_NAMES.length, 8);
  for (const strategy of STRATEGY_NAMES) {
    const result = runSimulation(5, { strategy, decisionLimit: 25 });
    assert.equal(result.simulationFault, null, strategy);
    assert.deepEqual(result.invariantErrors, [], strategy);
  }
});
