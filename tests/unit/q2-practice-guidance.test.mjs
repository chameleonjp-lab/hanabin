import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES } from "../../src/config/rules.js";
import {
  chainTargetsWithinDirectRadius,
  isChainSourceEligible,
  isChainTargetEligible,
} from "../../src/core/chain-eligibility.js";
import { createGame, detonate, stepGame } from "../../src/core/engine.js";
import { selectionBlastCueFor } from "../../src/ui/hud.js";
import {
  PRACTICE_TARGETS,
  TutorialController,
  practiceGestureStateAfterBoundary,
  practiceTargetBoardPoint,
} from "../../src/ui/tutorial.js";

const makeEventTarget = ({ width = 160, height = 90 } = {}) => {
  const listeners = new Map();
  const captures = new Set();
  return {
    style: {},
    dataset: {},
    width,
    height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    setPointerCapture(pointerId) { captures.add(pointerId); },
    releasePointerCapture(pointerId) { captures.delete(pointerId); },
    hasPointerCapture(pointerId) { return captures.has(pointerId); },
    contains() { return false; },
    dispatch(type, event = {}) {
      const source = {
        type,
        target: this,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...event,
      };
      for (const handler of listeners.get(type) ?? []) handler(source);
      return source;
    },
  };
};

const withBrowserGlobals = (callback) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentStub = {
    visibilityState: "visible",
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { documentListeners.get(type)?.delete(handler); },
  };
  const windowStub = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { windowListeners.get(type)?.delete(handler); },
  };
  globalThis.document = documentStub;
  globalThis.window = windowStub;
  try {
    return callback();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
};

const makeTutorialFixture = () => {
  const canvas = makeEventTarget();
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    setTransform() {},
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "createLinearGradient") return () => gradient;
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  canvas.width = 1_600;
  canvas.height = 900;
  canvas.getContext = () => context;
  const elements = new Map([
    ["#practice-board", makeEventTarget()],
    ["#practice-canvas", canvas],
    ["#practice-value", makeEventTarget()],
    ["#practice-message", makeEventTarget()],
    ["#practice-progress", makeEventTarget()],
    ["#practice-feedback", makeEventTarget()],
    ["#practice-stage", makeEventTarget()],
    ["#practice-start", makeEventTarget()],
    ["#practice-skip", makeEventTarget()],
    ["#practice-continue", makeEventTarget()],
  ]);
  return {
    canvas,
    element: { querySelector: (selector) => elements.get(selector) ?? null },
  };
};

const activeEntity = ({
  id,
  x,
  y,
  layout = "center",
  status = "active",
  visible = true,
  chainReserved = false,
  chainQueued = false,
} = {}) => ({
  id,
  color: 0,
  x,
  y,
  layout,
  status,
  visible,
  chainReserved,
  chainQueued,
  depth: 0,
});

test("practice gesture boundaries clear a failed release and clone successful presentation state", () => {
  const record = { id: "old", x: 1_000, y: 2_000, acquiredTick: 4 };
  const state = {
    gesturePressed: true,
    hoverCandidateId: "old",
    hoverTicks: 2,
    selectionSinceTick: 4,
    tracePoint: { x: 10, y: 20 },
    traceDistanceCarry: 99,
    selectedIds: ["old"],
    selectedRecords: [record],
  };
  const failed = practiceGestureStateAfterBoundary(state);
  assert.deepEqual(failed.selectedIds, []);
  assert.deepEqual(failed.selectedRecords, []);
  assert.equal(failed.selectionSinceTick, null);
  assert.equal(failed.hoverCandidateId, null);
  assert.equal(failed.tracePoint, null);

  const successful = practiceGestureStateAfterBoundary(state, { preserveSelection: true });
  assert.deepEqual(successful.selectedIds, ["old"]);
  assert.deepEqual(successful.selectedRecords, [record]);
  assert.notEqual(successful.selectedIds, state.selectedIds);
  assert.notEqual(successful.selectedRecords, state.selectedRecords);
  assert.notEqual(successful.selectedRecords[0], record);
  assert.equal(successful.selectionSinceTick, null);
  successful.selectedRecords[0].x = 9_999;
  assert.equal(record.x, 1_000);
});

test("failed practice release leaves the next sampled gesture independent", () => {
  withBrowserGlobals(() => {
    const { canvas, element } = makeTutorialFixture();
    const tutorial = new TutorialController(element);
    tutorial.state = "running";
    const first = practiceTargetBoardPoint(PRACTICE_TARGETS[0]);
    for (let tick = 0; tick < 3; tick += 1) {
      tutorial.consumeInputFrame({ type: "pointer", pressed: true, x: first.x, y: first.y, tick });
    }
    assert.deepEqual(tutorial.selectedIds, [PRACTICE_TARGETS[0].id]);
    assert.equal(tutorial.selectedRecords.length, 1);
    assert.equal(tutorial.selectionSinceTick, 2);

    tutorial.consumeInputFrame({ type: "pointer", pressed: false, x: first.x, y: first.y, tick: 3 });
    assert.deepEqual(tutorial.selectedIds, []);
    assert.deepEqual(tutorial.selectedRecords, []);
    assert.equal(tutorial.selectionSinceTick, null);
    assert.equal(tutorial.lastFailureReason, "release-below-minimum");

    const second = practiceTargetBoardPoint(PRACTICE_TARGETS[1]);
    for (let tick = 10; tick < 13; tick += 1) {
      tutorial.consumeInputFrame({ type: "pointer", pressed: true, x: second.x, y: second.y, tick });
    }
    assert.deepEqual(tutorial.selectedIds, [PRACTICE_TARGETS[1].id]);
    assert.equal(tutorial.selectedRecords.length, 1);
    assert.equal(tutorial.selectionSinceTick, 12);
    tutorial.destroy();
  });
});

test("chain eligibility excludes reserves, unavailable states, and radius misses for HUD and core", () => {
  const selected = [
    activeEntity({ id: "normal-source", x: 1_000, y: 1_000 }),
    activeEntity({ id: "reserve-source", x: 1_100, y: 1_000, layout: "choice-reserve" }),
    activeEntity({ id: "normal-source-2", x: 1_200, y: 1_000 }),
    activeEntity({ id: "expired-source", x: 1_200, y: 1_000, status: "expired", visible: false }),
  ];
  const candidates = [
    activeEntity({ id: "normal-edge", x: 2_800, y: 1_000 }),
    activeEntity({ id: "normal-outside", x: 3_001, y: 1_000 }),
    activeEntity({ id: "reserve-near", x: 1_010, y: 1_000, layout: "choice-reserve" }),
    activeEntity({ id: "expired-near", x: 1_020, y: 1_000, status: "expired", visible: false }),
    activeEntity({ id: "queued-near", x: 1_030, y: 1_000, chainQueued: true }),
  ];
  const before = JSON.parse(JSON.stringify({ selected, candidates }));
  assert.equal(isChainSourceEligible(selected[0]), true);
  assert.equal(isChainSourceEligible(selected[1]), false);
  assert.equal(isChainTargetEligible(candidates[0]), true);
  assert.equal(isChainTargetEligible(candidates[2]), false);
  assert.deepEqual(
    chainTargetsWithinDirectRadius({ selectedEntities: selected, candidateEntities: candidates, selectionCount: 3 })
      .map((entity) => entity.id),
    ["normal-edge"],
  );
  assert.deepEqual({ selected, candidates }, before);

  const state = {
    selectedIds: selected.slice(0, 3).map((entity) => entity.id),
    fireworks: [...selected, ...candidates],
  };
  assert.equal(selectionBlastCueFor(state), "この位置なら3個でも近くの花火に届きます");
  state.fireworks = state.fireworks.map((entity) => entity.id === "normal-edge"
    ? { ...entity, layout: "choice-reserve" }
    : entity);
  assert.equal(selectionBlastCueFor(state), "");
});

test("engine keeps reserve direct points while preventing reserve and disappearing chain targets", () => {
  const state = createGame(404, DEFAULT_RULES);
  state.status = "running";
  state.fireworks = [
    activeEntity({ id: 1, x: 1_000, y: 4_500 }),
    activeEntity({ id: 2, x: 1_150, y: 4_500 }),
    activeEntity({ id: 3, x: 1_300, y: 4_500, layout: "choice-reserve" }),
    activeEntity({ id: 4, x: 2_800, y: 4_500 }),
    activeEntity({ id: 5, x: 1_020, y: 4_500, layout: "choice-reserve" }),
    activeEntity({ id: 6, x: 1_030, y: 4_500, status: "expired", visible: false }),
    activeEntity({ id: 7, x: 3_001, y: 4_500 }),
  ].map((entity) => ({
    ...entity,
    waveId: "fixture-wave",
    waveIndex: 0,
    localIndex: Number(entity.id),
    baseX: entity.x,
    baseY: entity.y,
    vx: 0,
    vy: 0,
    depth: Number(entity.id),
    radius: DEFAULT_RULES.entityRadius,
    spawnTick: 0,
    lifetimeTicks: DEFAULT_RULES.lifetimeMaxTicks,
    expiresTick: DEFAULT_RULES.lifetimeMaxTicks,
    forecastForWaveIndex: null,
    scored: false,
  }));
  state.pendingEntities = [];
  state.waves = [];
  state.nextWaveIndex = DEFAULT_RULES.maxWaves;
  state.upcomingWaves = [];
  state.upcomingWaveIndex = DEFAULT_RULES.maxWaves;
  state.selectedIds = [1, 2, 3];
  state.selectedColor = 0;
  state.selectionSinceTick = 0;
  state.selectionAgeTicks = DEFAULT_RULES.minHoldTicks;
  state.selectionRecords = state.selectedIds.map((id) => {
    const entity = state.fireworks.find((candidate) => candidate.id === id);
    return { id, x: entity.x, y: entity.y, acquiredTick: 0 };
  });

  assert.equal(detonate(state, DEFAULT_RULES, 0), true);
  stepGame(state, 1, DEFAULT_RULES);
  assert.deepEqual(state.scoreEvents.map((event) => event.targetId).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(state.chainEvents.some((event) => event.kind === "chain" && [3, 5, 6].includes(event.targetId)), false);
  assert.equal(state.chainEvents.some((event) => event.kind === "chain" && event.targetId === 7), false);
});
