import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES } from "../../src/config/rules.js";
import {
  advanceGame,
  createGame,
  consumePointerFrame,
  detonate,
  findCandidates,
  pointerFailureReasonFor,
  selectAt,
  selectEntity,
} from "../../src/core/engine.js";

const makeFirework = ({ id, color = 0, x, y, lifetimeTicks = 300, vx = 0, vy = 0, depth = 100 }) => ({
  id,
  waveId: "selection-fixture",
  waveIndex: 0,
  localIndex: Number(id),
  color,
  x,
  y,
  baseX: x,
  baseY: y,
  vx,
  vy,
  depth,
  radius: DEFAULT_RULES.entityRadius,
  spawnTick: 0,
  lifetimeTicks,
  expiresTick: lifetimeTicks,
  layout: "center",
  visible: true,
  status: "active",
  scored: false,
});

const fixture = (entities) => {
  const state = createGame(0, DEFAULT_RULES);
  state.fireworks = entities;
  state.pendingEntities = [];
  state.waves = [];
  state.upcomingWaves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  state.tick = 0;
  state.timeTick = 0;
  state.status = "ready";
  state.selectedIds = [];
  state.selectedColor = null;
  state.selectionSinceTick = null;
  state.selectionAgeTicks = 0;
  state.selectionRecords = [];
  state.cooldownUntilTick = 0;
  state.simulationFault = null;
  state.actionCount = 0;
  state.inputFrames = [];
  return state;
};

const cluster = () => fixture([
  makeFirework({ id: 1, x: 4_000, y: 4_500 }),
  makeFirework({ id: 2, x: 4_060, y: 4_500 }),
  makeFirework({ id: 3, x: 4_120, y: 4_500 }),
  makeFirework({ id: 4, color: 1, x: 9_000, y: 4_500 }),
  makeFirework({ id: 5, x: 9_060, y: 4_500 }),
  makeFirework({ id: 6, x: 9_120, y: 4_500 }),
]);

test("selection uses 3-tick hold, one acquisition per tick, link distance 5140, timeout 150", () => {
  assert.equal(DEFAULT_RULES.selectionHoldTicks, 3);
  assert.equal(DEFAULT_RULES.minHoldTicks, 3);
  assert.equal(DEFAULT_RULES.selectionLinkDistance, 5_140);
  assert.equal(DEFAULT_RULES.selectionTimeoutTicks, 150);

  const boundary = fixture([
    makeFirework({ id: 1, x: 8_000, y: 4_500 }),
    makeFirework({ id: 2, x: 13_140, y: 4_500 }),
    makeFirework({ id: 3, x: 13_141, y: 4_500 }),
  ]);
  selectEntity(boundary, 1, DEFAULT_RULES, { x: 8_000, y: 4_500 });
  boundary.tick = 1;
  boundary.timeTick = 1;
  const atBoundary = findCandidates(boundary, 13_140, 4_500, {}, DEFAULT_RULES);
  const beyondBoundary = findCandidates(boundary, 13_141, 4_500, {}, DEFAULT_RULES);
  assert.ok(atBoundary.some((candidate) => candidate.id === 2));
  assert.equal(beyondBoundary.some((candidate) => candidate.id === 3), false);

  const state = cluster();
  selectAt(state, 4_000, 4_500, {}, DEFAULT_RULES);
  selectAt(state, 4_000, 4_500, {}, DEFAULT_RULES);
  assert.equal(state.selectedIds.length, 1, "one tick may acquire at most one candidate");
  state.tick = 1;
  state.timeTick = 1;
  selectAt(state, 4_000, 4_500, {}, DEFAULT_RULES);
  state.tick = 2;
  state.timeTick = 2;
  selectAt(state, 4_000, 4_500, {}, DEFAULT_RULES);
  assert.equal(state.selectedIds.length, 3);
  assert.equal(state.selectionAgeTicks, 2);
  assert.equal(detonate(state, DEFAULT_RULES), false, "selection is not held for three ticks yet");
  advanceGame(state, 3, DEFAULT_RULES);
  assert.equal(state.selectionAgeTicks, 3);
  assert.equal(detonate(state, DEFAULT_RULES), true);

  const timeout = cluster();
  selectEntity(timeout, 1, DEFAULT_RULES, { x: 4_000, y: 4_500 });
  advanceGame(timeout, 150, DEFAULT_RULES);
  assert.deepEqual(timeout.selectedIds, [], "selection expires at the 150 tick boundary");
});

test("cooldown is nine ticks and duplicate selection cannot add score twice", () => {
  assert.equal(DEFAULT_RULES.cooldownTicks, 9);
  const state = cluster();
  selectEntity(state, 1, DEFAULT_RULES, { x: 4_000, y: 4_500 });
  selectEntity(state, 1, DEFAULT_RULES, { x: 4_000, y: 4_500 });
  state.tick = 1;
  state.timeTick = 1;
  selectEntity(state, 2, DEFAULT_RULES, { x: 4_060, y: 4_500 });
  state.tick = 2;
  state.timeTick = 2;
  selectEntity(state, 3, DEFAULT_RULES, { x: 4_120, y: 4_500 });
  assert.equal(state.selectedIds.length, 3);
  advanceGame(state, 3, DEFAULT_RULES);
  assert.equal(detonate(state, DEFAULT_RULES), true);
  const scoreAfterFirst = state.score;
  assert.equal(state.cooldownUntilTick, 12);
  assert.equal(detonate(state, DEFAULT_RULES), false);
  assert.equal(state.lastAction.reason, "cooldown");
  assert.equal(state.score, scoreAfterFirst);
  assert.equal(new Set(state.scoredTargetIds).size, state.scoredTargetIds.length);

  advanceGame(state, 4, DEFAULT_RULES);
  assert.equal(
    selectEntity(state, 5, DEFAULT_RULES, { x: 9_060, y: 4_500 }),
    null,
    "cooldown blocks the next selection, not only the next detonation",
  );
  assert.deepEqual(state.selectedIds, []);
  advanceGame(state, 12, DEFAULT_RULES);
  assert.ok(selectEntity(state, 5, DEFAULT_RULES, { x: 9_060, y: 4_500 }));
});

test("selection ties use distance then front depth then id, and offscreen selections drop", () => {
  const tied = fixture([
    makeFirework({ id: 3, x: 4_100, y: 4_500, depth: 200 }),
    makeFirework({ id: 2, x: 3_900, y: 4_500, depth: 300 }),
    makeFirework({ id: 1, x: 4_100, y: 4_500, depth: 300 }),
  ]);
  assert.deepEqual(
    findCandidates(tied, 4_000, 4_500, {}, DEFAULT_RULES).map((candidate) => candidate.id),
    [1, 2, 3],
  );

  const moving = fixture([
    makeFirework({ id: 1, x: 15_990, y: 4_500, vx: 20 }),
  ]);
  selectEntity(moving, 1, DEFAULT_RULES, { x: 15_990, y: 4_500 });
  advanceGame(moving, 1, DEFAULT_RULES);
  assert.deepEqual(moving.selectedIds, []);
  assert.equal(moving.stats.selectionDrops, 1);
});

test("pointer failure feedback follows hold, colour, link, and cooldown rules", () => {
  const state = cluster();
  const target = state.fireworks[0];
  state.fireworks.push(makeFirework({ id: 7, x: 10_200, y: 4_500 }));
  const frame = (actionId, x, y, pressed = true) => ({
    type: "pointer",
    actionId,
    tick: actionId,
    pressed,
    x,
    y,
  });

  assert.equal(pointerFailureReasonFor(state, frame(0, target.x, target.y)), "target-not-selectable");
  state.pointerPressed = false;
  assert.equal(consumePointerFrame(state, frame(0, target.x, target.y), DEFAULT_RULES), null);
  assert.equal(state.lastAction.reason, "selection-not-held");
  assert.equal(consumePointerFrame(state, frame(1, target.x, target.y), DEFAULT_RULES), null);
  assert.equal(state.lastAction.reason, "selection-not-held");

  assert.ok(selectEntity(state, 1, DEFAULT_RULES, { x: target.x, y: target.y }));
  state.tick = 1;
  state.timeTick = 1;
  assert.equal(
    pointerFailureReasonFor(state, frame(1, 9_000, 4_500)),
    "different-color",
  );
  assert.equal(
    pointerFailureReasonFor(state, frame(1, 10_200, 4_500)),
    "target-outside-selection-geometry",
  );

  state.cooldownUntilTick = 12;
  assert.equal(pointerFailureReasonFor(state, frame(1, target.x, target.y)), "cooldown");
});

test("an expired selected target reports a visible cancellation reason", () => {
  const state = fixture([
    makeFirework({ id: 1, x: 4_000, y: 4_500, lifetimeTicks: 1 }),
  ]);
  assert.ok(selectEntity(state, 1, DEFAULT_RULES, { x: 4_000, y: 4_500 }));
  advanceGame(state, 1, DEFAULT_RULES);
  assert.deepEqual(state.selectedIds, []);
  assert.deepEqual(state.lastAction, {
    type: "selection-cancelled",
    reason: "target-expired",
  });
});

test("selectEntity cannot bypass pointer hit and link geometry", () => {
  const state = fixture([
    makeFirework({ id: 1, x: 4_000, y: 4_500 }),
    makeFirework({ id: 2, x: 9_500, y: 4_500 }),
  ]);
  assert.equal(selectEntity(state, 2, DEFAULT_RULES), null, "coordinates are mandatory");
  assert.equal(
    selectEntity(state, 2, DEFAULT_RULES, { x: 4_000, y: 4_500 }),
    null,
    "an arbitrary ID cannot replace the geometric winner",
  );
  assert.deepEqual(state.selectedIds, []);
  assert.ok(selectEntity(state, 1, DEFAULT_RULES, { x: 4_000, y: 4_500 }));
  state.tick = 1;
  state.timeTick = 1;
  assert.equal(
    selectEntity(state, 2, DEFAULT_RULES, { x: 9_500, y: 4_500 }),
    null,
    "a hit outside the selection-link distance is rejected",
  );
});

test("selection link distance follows the moving selected firework", () => {
  const state = fixture([
    makeFirework({ id: 1, x: 4_000, y: 4_500, vx: 100 }),
    makeFirework({ id: 2, x: 10_100, y: 4_500 }),
  ]);
  assert.ok(selectEntity(state, 1, DEFAULT_RULES, { x: 4_000, y: 4_500 }));
  advanceGame(state, 10, DEFAULT_RULES);
  assert.equal(state.fireworks.find((entity) => entity.id === 1).x, 5_000);
  assert.ok(
    selectEntity(state, 2, DEFAULT_RULES, { x: 10_100, y: 4_500 }),
    "the current 5,100-unit link is valid even though the acquisition point is 6,100 units away",
  );
});
