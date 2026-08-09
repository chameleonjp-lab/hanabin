import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INPUT_SCHEMA_VERSION,
  canonicalInputFrame,
  createPointerSampler,
  createReplayLog,
  makeInputFrame,
  parseReplayLog,
  readPointerFrame,
  sampleLatestPointerPerTick,
  serializeReplayLog,
  updatePointerSampler,
  validateInputFrames,
  validateReplayLog,
} from "../../src/core/input-frame.js";
import { applyInputFrame, createGame, replayFrames, snapshotGame } from "../../src/core/engine.js";
import { DEFAULT_RULES, mergeRules, rulesFingerprint } from "../../src/config/rules.js";

const TOTAL_TICKS = 3_600;

const makeStrictFrames = () => {
  const frames = Array.from({ length: TOTAL_TICKS }, (_, tick) =>
    makeInputFrame(tick, tick, "noop", {
      pressed: false,
      x: 8_000,
      y: 4_500,
    }));
  frames[0] = makeInputFrame(0, 0, "pointer", {
    pressed: true,
    x: 8_000,
    y: 4_500,
  });
  return frames;
};

test("pressed+x+y survive canonicalization and a strict 3600 tick replay", () => {
  const frames = makeStrictFrames();
  const canonical = canonicalInputFrame(frames[0]);
  assert.equal(canonical.pressed, true, "pressed is part of the replay contract");
  assert.equal(canonical.x, 8_000);
  assert.equal(canonical.y, 4_500);
  assert.deepEqual(validateInputFrames(frames, { maxTicks: TOTAL_TICKS, requireAllTicks: true }), []);
  const replay = {
    gameVersion: DEFAULT_RULES.gameVersion,
    ruleVersion: DEFAULT_RULES.ruleVersion,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    rulesFingerprint: rulesFingerprint(DEFAULT_RULES),
    seed: 0,
    maxTicks: TOTAL_TICKS,
    frames,
  };
  assert.deepEqual(validateReplayLog(replay, DEFAULT_RULES), []);
  const roundTrip = parseReplayLog(serializeReplayLog(replay));
  assert.deepEqual(validateReplayLog(roundTrip, DEFAULT_RULES), []);
  const first = replayFrames(createGame(0, DEFAULT_RULES), frames, DEFAULT_RULES);
  const second = replayFrames(createGame(0, DEFAULT_RULES), roundTrip.frames, DEFAULT_RULES);
  assert.deepEqual(snapshotGame(first), snapshotGame(second));
});

test("a second pointer cannot replace or move the first active pointer", () => {
  const sampler = createPointerSampler();
  assert.equal(updatePointerSampler(sampler, {
    type: "pointerdown", pointerId: 11, x: 100, y: 200,
  }), true);
  assert.equal(updatePointerSampler(sampler, {
    type: "pointermove", pointerId: 11, x: 120, y: 220,
  }), true);
  const beforeSecond = { ...sampler };
  assert.equal(updatePointerSampler(sampler, {
    type: "pointerdown", pointerId: 22, x: 9_000, y: 8_000,
  }), false);
  assert.equal(updatePointerSampler(sampler, {
    type: "pointermove", pointerId: 22, x: 10_000, y: 7_000,
  }), false);
  assert.deepEqual(sampler, beforeSecond);
  assert.deepEqual(readPointerFrame(sampler, 0, 0), makeInputFrame(0, 0, "pointer", {
    pressed: true,
    x: 120,
    y: 220,
  }));
  assert.equal(updatePointerSampler(sampler, {
    type: "pointercancel", pointerId: 11, x: 130, y: 230,
  }), true);
  assert.deepEqual(readPointerFrame(sampler, 1, 1), makeInputFrame(1, 1, "pointer", {
    pressed: false,
    x: 130,
    y: 230,
    cancelled: true,
  }));
});

test("fixed-tick sampling depends on the latest position, not move-event count", () => {
  const oneMove = [makeInputFrame(8, 8, "pointer", { pressed: true, x: 800, y: 900 })];
  const manyMoves = Array.from({ length: 64 }, (_, index) =>
    makeInputFrame(8, index, "pointer", {
      pressed: true,
      x: index === 63 ? 800 : index,
      y: index === 63 ? 900 : index,
    }));
  assert.deepEqual(
    sampleLatestPointerPerTick(manyMoves).map(({ pressed, x, y, tick }) => ({ pressed, x, y, tick })),
    sampleLatestPointerPerTick(oneMove).map(({ pressed, x, y, tick }) => ({ pressed, x, y, tick })),
  );
});

test("replay rejects a missing tick and createReplayLog never pads it", () => {
  const frames = makeStrictFrames();
  const missing = frames.slice();
  missing.splice(1_234, 1);
  const replay = {
    gameVersion: DEFAULT_RULES.gameVersion,
    ruleVersion: DEFAULT_RULES.ruleVersion,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    rulesFingerprint: rulesFingerprint(DEFAULT_RULES),
    seed: 0,
    maxTicks: TOTAL_TICKS,
    frames: missing,
  };
  const errors = validateReplayLog(replay, DEFAULT_RULES);
  assert.ok(errors.some((entry) =>
    entry === "TICK_COUNT_NOT_EXACT" || entry?.codes?.includes("TICK_MISSING")));
  assert.throws(
    () => createReplayLog({ seed: 0, ruleVersion: DEFAULT_RULES.ruleVersion, rules: DEFAULT_RULES, frames: missing }),
    (error) => error?.code === "INVALID_REPLAY",
  );
});

test("createReplayLog rejects raw schema gaps and forbidden fields before canonicalization", () => {
  const missingSchema = makeStrictFrames();
  delete missingSchema[100].schemaVersion;
  assert.throws(
    () => createReplayLog({ seed: 0, rules: DEFAULT_RULES, frames: missingSchema }),
    (error) => error?.code === "INVALID_REPLAY" && error.details.some((entry) =>
      entry?.codes?.includes("INPUT_SCHEMA_VERSION")),
  );

  const forbiddenField = makeStrictFrames();
  forbiddenField[100].targetId = 42;
  assert.throws(
    () => createReplayLog({ seed: 0, rules: DEFAULT_RULES, frames: forbiddenField }),
    (error) => error?.code === "INVALID_REPLAY" && error.details.some((entry) =>
      entry?.codes?.includes("UNKNOWN_INPUT_FIELD") || entry?.codes?.includes("TARGET_ID_FORBIDDEN")),
  );
});

test("replay metadata and fixed-tick pointer-only input cannot be weakened", () => {
  const frames = makeStrictFrames();
  const base = {
    gameVersion: DEFAULT_RULES.gameVersion,
    ruleVersion: DEFAULT_RULES.ruleVersion,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    rulesFingerprint: rulesFingerprint(DEFAULT_RULES),
    seed: 1,
    maxTicks: TOTAL_TICKS,
    frames,
  };
  assert.ok(validateReplayLog({ ...base, gameVersion: "wrong" }, DEFAULT_RULES).includes("GAME_VERSION"));
  assert.ok(validateReplayLog({ ...base, maxTicks: 1 }, DEFAULT_RULES).includes("MAX_TICKS"));
  const missingFrameSchema = structuredClone(base);
  delete missingFrameSchema.frames[100].schemaVersion;
  assert.ok(validateReplayLog(missingFrameSchema, DEFAULT_RULES).some((entry) =>
    entry?.codes?.includes("INPUT_SCHEMA_VERSION")));
  const pressedNoop = structuredClone(base);
  pressedNoop.frames[100].pressed = true;
  assert.ok(validateReplayLog(pressedNoop, DEFAULT_RULES).some((entry) =>
    entry?.codes?.includes("NOOP_PRESSED")));
  const alteredRules = mergeRules({ baseExplosionRadius: DEFAULT_RULES.baseExplosionRadius + 1 });
  assert.ok(validateReplayLog(base, alteredRules).includes("RULES_FINGERPRINT"));
  const direct = structuredClone(base);
  direct.frames[0] = makeInputFrame(0, 0, "select", { targetId: 1 });
  assert.ok(validateReplayLog(direct, DEFAULT_RULES).includes("REPLAY_INPUT_TYPE_FORBIDDEN"));

  const state = createGame(1, DEFAULT_RULES);
  applyInputFrame(state, { tick: 0, actionId: 0, type: "select", targetId: 1 });
  assert.equal(state.simulationFault?.code, "INPUT_TYPE_INVALID");
  assert.deepEqual(state.selectedIds, []);
});
