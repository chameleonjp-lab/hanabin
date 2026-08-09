import {
  DEFAULT_RULES,
  GAME_VERSION,
  INPUT_SCHEMA_VERSION,
  RULE_VERSION,
  TOTAL_TICKS,
  mergeRules,
  rulesFingerprint,
} from "../config/rules.js";

export { INPUT_SCHEMA_VERSION } from "../config/rules.js";

export const INPUT_TYPES = Object.freeze([
  "noop",
  "pointer",
]);

const TYPE_SET = new Set(INPUT_TYPES);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const makeInputFrame = (tick, actionId, type = "pointer", payload = {}) => ({
  schemaVersion: INPUT_SCHEMA_VERSION,
  tick,
  actionId,
  type,
  pressed: payload.pressed ?? type === "pointer",
  x: payload.x ?? 0,
  y: payload.y ?? 0,
  ...payload,
});

/** Keep fields as supplied so callers can receive a fault instead of a silent repair. */
export const normalizeInputFrame = (frame = {}) => {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return frame;
  return { ...frame };
};

export const validateInputFrame = (frame, {
  expectedTick = null,
  expectedActionId = null,
  maxTicks = 3_600,
  requireSchemaVersion = false,
} = {}) => {
  const source = normalizeInputFrame(frame);
  const errors = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return ["FRAME_NOT_OBJECT"];
  }
  if ((requireSchemaVersion || source.schemaVersion !== undefined) &&
      source.schemaVersion !== INPUT_SCHEMA_VERSION) {
    errors.push("INPUT_SCHEMA_VERSION");
  }
  if (!Number.isInteger(source.tick) || source.tick < 0 || source.tick >= maxTicks) {
    errors.push("TICK_OUT_OF_RANGE");
  }
  if (expectedTick !== null && source.tick !== expectedTick) errors.push("TICK_MISSING_OR_REORDERED");
  if (!Number.isInteger(source.actionId) || source.actionId < 0) errors.push("ACTION_ID_INVALID");
  if (expectedActionId !== null && source.actionId !== expectedActionId) {
    errors.push("ACTION_ID_MISSING_OR_REORDERED");
  }
  if (!TYPE_SET.has(source.type)) errors.push("INPUT_TYPE_INVALID");
  const allowedFields = new Set([
    "schemaVersion",
    "tick",
    "actionId",
    "type",
    "pressed",
    "x",
    "y",
    "reason",
    "cancelled",
    "interrupted",
  ]);
  if (Object.keys(source).some((key) => !allowedFields.has(key))) {
    errors.push("UNKNOWN_INPUT_FIELD");
  }
  if (source.type === "pointer" || source.type === "noop") {
    if (typeof source.pressed !== "boolean") errors.push("PRESSED_INVALID");
    if (source.type === "noop" && source.pressed !== false) errors.push("NOOP_PRESSED");
    for (const key of ["x", "y"]) {
      if (!Number.isInteger(source[key]) || !Number.isFinite(source[key])) {
        errors.push("POINTER_COORDINATE_INVALID");
      }
    }
    for (const key of ["cancelled", "interrupted"]) {
      if (source[key] !== undefined && typeof source[key] !== "boolean") {
        errors.push("INPUT_MARKER_INVALID");
      }
    }
    if (source.cancelled === true && source.interrupted === true) {
      errors.push("INPUT_MARKER_CONFLICT");
    }
    if ((source.cancelled === true || source.interrupted === true) && source.pressed !== false) {
      errors.push("INPUT_MARKER_PRESSED");
    }
    if (source.type === "noop" && (source.cancelled === true || source.interrupted === true)) {
      errors.push("NOOP_INPUT_MARKER");
    }
  }
  for (const key of ["tick", "actionId", "x", "y", "radius"]) {
    if (hasOwn(source, key) && typeof source[key] === "number" && !Number.isFinite(source[key])) {
      errors.push("NAN_OR_INFINITY");
    }
  }
  if (source.targetId !== undefined) {
    errors.push("TARGET_ID_FORBIDDEN");
  }
  return [...new Set(errors)];
};

export const validateInputFrames = (frames, {
  maxTicks = 3_600,
  requireAllTicks = false,
  requireSchemaVersion = false,
} = {}) => {
  const errors = [];
  if (!Array.isArray(frames)) return ["FRAMES_NOT_ARRAY"];
  const seenTicks = new Set();
  const seenActionIds = new Set();
  let previousTick = -1;
  let previousActionId = -1;
  frames.forEach((frame, index) => {
    const normalized = normalizeInputFrame(frame);
    const frameErrors = validateInputFrame(normalized, { maxTicks, requireSchemaVersion });
    if (frameErrors.length) errors.push({ index, codes: frameErrors });
    if (normalized && typeof normalized === "object") {
      if (seenTicks.has(normalized.tick)) errors.push({ index, codes: ["TICK_DUPLICATE"] });
      if (seenActionIds.has(normalized.actionId)) errors.push({ index, codes: ["ACTION_ID_DUPLICATE"] });
      seenTicks.add(normalized.tick);
      seenActionIds.add(normalized.actionId);
      if (normalized.tick <= previousTick) errors.push({ index, codes: ["TICK_REVERSED"] });
      if (normalized.actionId <= previousActionId) {
        errors.push({ index, codes: ["ACTION_ID_REVERSED"] });
      }
      previousTick = normalized.tick;
      previousActionId = normalized.actionId;
      if (requireAllTicks && normalized.tick !== index) {
        errors.push({ index, codes: ["TICK_MISSING_OR_REORDERED"] });
      }
      if (requireAllTicks && normalized.actionId !== index) {
        errors.push({ index, codes: ["ACTION_ID_MISSING_OR_REORDERED"] });
      }
    }
  });
  if (requireAllTicks) {
    for (let tick = 0; tick < maxTicks; tick += 1) {
      if (!seenTicks.has(tick)) errors.push({ tick, codes: ["TICK_MISSING"] });
    }
  }
  return errors;
};

/** Keep the latest owned-pointer position for each fixed tick. */
export const sampleLatestPointerPerTick = (frames = []) => {
  const latestByTick = new Map();
  for (const frame of frames) {
    const normalized = normalizeInputFrame(frame);
    if (!normalized || normalized.type !== "pointer" || !Number.isInteger(normalized.tick)) continue;
    latestByTick.set(normalized.tick, normalized);
  }
  return [...latestByTick.values()].sort((left, right) => left.tick - right.tick);
};

export const samplePointerFrames = sampleLatestPointerPerTick;

/**
 * Small browser-independent pointer sampler used by the M3 adapter later.
 * The first pointer-down owns the sampler until it is released or cancelled;
 * events from every other pointer are ignored without changing sampler state.
 */
export const createPointerSampler = () => ({
  activePointerId: null,
  pressed: false,
  x: 0,
  y: 0,
  marker: null,
});

const validPointerCoordinate = (value) => Number.isInteger(value) && Number.isFinite(value);

export const updatePointerSampler = (sampler, event = {}) => {
  if (!sampler || typeof sampler !== "object" || !event || typeof event !== "object") return false;
  const type = event.type;
  const pointerId = event.pointerId;
  if (type === "pointerdown") {
    if (!Number.isInteger(pointerId) || pointerId < 0 ||
        !validPointerCoordinate(event.x) || !validPointerCoordinate(event.y)) return false;
    if (sampler.activePointerId !== null && sampler.activePointerId !== pointerId) return false;
    if (sampler.activePointerId === null) sampler.activePointerId = pointerId;
    sampler.pressed = true;
    sampler.x = event.x;
    sampler.y = event.y;
    sampler.marker = null;
    return true;
  }
  if (type === "interrupt") {
    if (sampler.activePointerId === null) return false;
    sampler.activePointerId = null;
    sampler.pressed = false;
    sampler.marker = "interrupted";
    return true;
  }
  if (sampler.activePointerId === null || sampler.activePointerId !== pointerId) return false;
  if (!["pointermove", "pointerup", "pointercancel"].includes(type)) return false;
  if (!validPointerCoordinate(event.x) || !validPointerCoordinate(event.y)) return false;
  sampler.x = event.x;
  sampler.y = event.y;
  if (type === "pointerup" || type === "pointercancel") {
    sampler.activePointerId = null;
    sampler.pressed = false;
    sampler.marker = type === "pointercancel" ? "cancelled" : null;
  }
  return true;
};

/** Capture the latest owned-pointer position exactly once for a fixed tick. */
export const readPointerFrame = (sampler, tick, actionId) => {
  const marker = sampler?.marker ?? null;
  const frame = makeInputFrame(tick, actionId, "pointer", {
    pressed: sampler?.pressed === true,
    x: sampler?.x ?? 0,
    y: sampler?.y ?? 0,
    ...(marker === "cancelled" ? { cancelled: true } : {}),
    ...(marker === "interrupted" ? { interrupted: true } : {}),
  });
  if (sampler && typeof sampler === "object") sampler.marker = null;
  return frame;
};

export const canonicalInputFrame = (frame) => {
  const normalized = normalizeInputFrame(frame);
  if (!normalized || typeof normalized !== "object") return normalized;
  const result = {
    schemaVersion: INPUT_SCHEMA_VERSION,
    tick: normalized.tick,
    actionId: normalized.actionId,
    type: normalized.type,
  };
  for (const key of [
    "x",
    "y",
    "reason",
    "pressed",
    "cancelled",
    "interrupted",
  ]) {
    if (normalized[key] !== undefined) result[key] = normalized[key];
  }
  return result;
};

export const createInputLog = (frames = []) => frames.map(canonicalInputFrame);

export const fillInputTicks = (frames = [], maxTicks = 3_600) => {
  const byTick = new Map();
  for (const frame of frames) {
    const normalized = canonicalInputFrame(frame);
    if (normalized && Number.isInteger(normalized.tick) && !byTick.has(normalized.tick)) {
      byTick.set(normalized.tick, normalized);
    }
  }
  const result = [];
  let actionId = 0;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const existing = byTick.get(tick);
    if (existing) {
      result.push({ ...existing, actionId });
    } else {
      result.push(makeInputFrame(tick, actionId, "noop", { pressed: false, x: 0, y: 0 }));
    }
    actionId += 1;
  }
  return result;
};

export const createReplayLog = ({ seed, ruleVersion, rules, frames = [] } = {}) => {
  const resolvedRules = mergeRules(rules ?? DEFAULT_RULES);
  const maxTicks = resolvedRules.maxTicks;
  const rawFrameErrors = validateInputFrames(frames, {
    maxTicks,
    requireAllTicks: true,
    requireSchemaVersion: true,
  });
  if (rawFrameErrors.length) {
    const error = new Error("Invalid replay log");
    error.code = "INVALID_REPLAY";
    error.details = rawFrameErrors;
    throw error;
  }
  const replay = {
    gameVersion: resolvedRules.gameVersion,
    ruleVersion: ruleVersion ?? resolvedRules.ruleVersion,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    rulesFingerprint: rulesFingerprint(resolvedRules),
    seed,
    maxTicks,
    // A received replay is never padded.  Strategy code can use
    // `createStrategyReplayLog` when it intentionally creates no-op frames.
    frames: createInputLog(frames),
  };
  const errors = validateReplayLog(replay, resolvedRules);
  if (errors.length) {
    const error = new Error("Invalid replay log");
    error.code = "INVALID_REPLAY";
    error.details = errors;
    throw error;
  }
  return replay;
};

export const createStrategyReplayLog = ({ seed, ruleVersion, rules, frames = [] } = {}) =>
  createReplayLog({ seed, ruleVersion, rules, frames: fillInputTicks(frames, rules?.maxTicks ?? 3_600) });

export const validateReplayLog = (replay, rules = {}) => {
  const maxTicks = TOTAL_TICKS;
  const resolvedRules = mergeRules(rules);
  const errors = [];
  if (!replay || typeof replay !== "object") return ["REPLAY_NOT_OBJECT"];
  if (!Number.isInteger(replay.seed) || replay.seed < 0 || replay.seed > 0xffff_ffff) {
    errors.push("SEED_INVALID");
  }
  if (replay.gameVersion !== resolvedRules.gameVersion) errors.push("GAME_VERSION");
  if (replay.ruleVersion !== resolvedRules.ruleVersion) errors.push("RULE_VERSION");
  if (replay.inputSchemaVersion !== INPUT_SCHEMA_VERSION) errors.push("INPUT_SCHEMA_VERSION");
  if (replay.rulesFingerprint !== rulesFingerprint(resolvedRules)) errors.push("RULES_FINGERPRINT");
  if (replay.maxTicks !== maxTicks || resolvedRules.maxTicks !== maxTicks) {
    errors.push("MAX_TICKS");
  }
  if (!Array.isArray(replay.frames)) errors.push("FRAMES_NOT_ARRAY");
  else if (replay.frames.length !== maxTicks) errors.push("TICK_COUNT_NOT_EXACT");
  if (Array.isArray(replay.frames) && replay.frames.some((frame) =>
    frame?.type !== "pointer" && frame?.type !== "noop")) {
    errors.push("REPLAY_INPUT_TYPE_FORBIDDEN");
  }
  errors.push(...validateInputFrames(replay.frames, {
    maxTicks,
    requireAllTicks: true,
    requireSchemaVersion: true,
  }));
  return errors;
};

export const serializeReplayLog = (replay) => JSON.stringify(replay);

export const parseReplayLog = (serialized) => {
  if (typeof serialized !== "string") return serialized;
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
};

export default makeInputFrame;
