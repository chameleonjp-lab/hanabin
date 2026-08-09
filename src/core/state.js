import { DEFAULT_RULES, mergeRules, rulesFingerprint } from "../config/rules.js";
import { normalizeSeed } from "./rng.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const createInitialState = (seed = 1, rules = DEFAULT_RULES) => {
  const resolvedRules = mergeRules(rules);
  const normalizedSeed = normalizeSeed(seed);
  return {
    gameVersion: resolvedRules.gameVersion,
    ruleVersion: resolvedRules.ruleVersion,
    rulesFingerprint: rulesFingerprint(resolvedRules),
    seed: normalizedSeed,
    status: "ready",
    tick: 0,
    timeTick: 0,
    // Session input stops at maxTicks.  A terminal chain may still resolve
    // through maxTicks + maxChainTicks; keep that derived clock separate so
    // the replay/session tick remains exactly 3,600.
    resolutionTick: 0,
    score: 0,
    finalScore: null,
    combo: 0,
    maxCombo: 0,
    selectedIds: [],
    selectedColor: null,
    selectionSinceTick: null,
    selectionAgeTicks: 0,
    selectionRecords: [],
    lastAcquisitionX: null,
    lastAcquisitionY: null,
    lastAcquisitionTick: null,
    hoverCandidateId: null,
    hoverTicks: 0,
    pointerPressed: false,
    lastDetonationTick: null,
    cooldownUntilTick: 0,
    fireworks: [],
    waves: [],
    nextWaveIndex: 0,
    upcomingWaves: [],
    upcomingWaveIndex: null,
    pendingEntities: [],
    activeExplosions: [],
    chainQueue: [],
    queuedTargetIds: [],
    chainEvents: [],
    scoreEvents: [],
    scoredTargetIds: [],
    actionCaughtCounts: {},
    inputFrames: [],
    actionCount: 0,
    eventCount: 0,
    stats: {
      wavesSpawned: 0,
      entitiesSpawned: 0,
      entitiesExploded: 0,
      entitiesExpired: 0,
      detonationCount: 0,
      directTargets: 0,
      chainTargets: 0,
      maxChain: 0,
      maxChainDurationTicks: 0,
      maxConcurrentExplosions: 0,
      ignoredInputs: 0,
      selectionDrops: 0,
      maxActiveEntities: 0,
    },
    simulationFault: null,
    lastAction: null,
    // The game generator's state is represented by seed + wave index.  A
    // separate strategy RNG is never stored here.
    gameRngState: normalizedSeed,
  };
};

export const cloneState = (state) => clone(state);

export const snapshotState = (state) => {
  const result = clone(state);
  result.fireworks.sort((left, right) => String(left.id).localeCompare(String(right.id), "en", { numeric: true }));
  result.inputFrames.sort((left, right) => left.tick - right.tick || left.actionId - right.actionId);
  result.chainEvents.sort((left, right) =>
    left.fireTick - right.fireTick || left.actionId - right.actionId ||
    String(left.sourceId).localeCompare(String(right.sourceId), "en", { numeric: true }) ||
    left.eventId - right.eventId,
  );
  return result;
};

const isInteger = (value) => Number.isInteger(value);

export const validateState = (state, rules = DEFAULT_RULES) => {
  const resolvedRules = mergeRules(rules);
  const errors = [];
  if (!state || typeof state !== "object") return ["STATE_NOT_OBJECT"];
  for (const key of ["tick", "timeTick", "resolutionTick", "score"]) {
    if (!Number.isFinite(state[key])) errors.push(`${key.toUpperCase()}_NOT_FINITE`);
  }
  if (!isInteger(state.tick) || state.tick < 0 || state.tick > resolvedRules.maxTicks) {
    errors.push("TICK_OUT_OF_RANGE");
  }
  if (!isInteger(state.timeTick) || state.timeTick < 0 || state.timeTick > resolvedRules.maxTicks) {
    errors.push("TIME_TICK_OUT_OF_RANGE");
  }
  if (!isInteger(state.resolutionTick) || state.resolutionTick < 0 ||
      state.resolutionTick > resolvedRules.maxTicks + resolvedRules.maxChainTicks) {
    errors.push("RESOLUTION_TICK_OUT_OF_RANGE");
  }
  if (!Array.isArray(state.fireworks)) errors.push("FIREWORKS_NOT_ARRAY");
  else {
    const ids = new Set();
    let active = 0;
    for (const entity of state.fireworks) {
      if (ids.has(entity.id)) errors.push("ENTITY_ID_DUPLICATE");
      ids.add(entity.id);
      for (const key of ["x", "y", "spawnTick", "expiresTick", "depth"]) {
        if (!Number.isFinite(entity[key])) errors.push(`ENTITY_${key.toUpperCase()}_NOT_FINITE`);
      }
      if (!isInteger(entity.x) || !isInteger(entity.y)) errors.push("ENTITY_COORDINATE_NOT_INTEGER");
      if (entity.status === "active") active += 1;
    }
    if (active > resolvedRules.maxActiveEntities) errors.push("ACTIVE_ENTITY_LIMIT");
  }
  if (!Array.isArray(state.selectedIds)) errors.push("SELECTION_NOT_ARRAY");
  else {
    if (state.selectedIds.length > resolvedRules.maxSelection) errors.push("SELECTION_LIMIT");
    const selectedSet = new Set(state.selectedIds);
    if (selectedSet.size !== state.selectedIds.length) errors.push("SELECTION_DUPLICATE");
    const activeById = new Map((state.fireworks ?? []).map((entity) => [String(entity.id), entity]));
    for (const id of selectedSet) {
      const entity = activeById.get(String(id));
      if (!entity || entity.status !== "active") errors.push("SELECTION_NOT_ACTIVE");
      if (resolvedRules.selectionMustBeVisible && entity && !entity.visible) {
        errors.push("SELECTION_NOT_VISIBLE");
      }
    }
  }
  if (!state.actionCaughtCounts || typeof state.actionCaughtCounts !== "object" ||
      Array.isArray(state.actionCaughtCounts)) {
    errors.push("ACTION_CAUGHT_COUNTS_INVALID");
  } else if (Object.values(state.actionCaughtCounts).some((count) =>
    !isInteger(count) || count < 0)) {
    errors.push("ACTION_CAUGHT_COUNT_INVALID");
  }
  if (!Array.isArray(state.scoreEvents) || !Array.isArray(state.scoredTargetIds)) {
    errors.push("SCORE_EVENTS_INVALID");
  } else {
    const scored = state.scoreEvents.map((event) => String(event.targetId));
    if (new Set(scored).size !== scored.length) errors.push("SCORE_TARGET_DUPLICATE");
    if (state.scoreEvents.length > resolvedRules.maxScoreEvents) errors.push("SCORE_EVENT_LIMIT");
  }
  if (!Array.isArray(state.chainQueue) || state.chainQueue.length > resolvedRules.maxConcurrentExplosions) {
    errors.push("CHAIN_QUEUE_LIMIT");
  }
  if (!Array.isArray(state.chainEvents) || state.chainEvents.length > resolvedRules.maxChainEvents) {
    errors.push("CHAIN_EVENT_LIMIT");
  }
  if (!Array.isArray(state.activeExplosions) ||
      state.activeExplosions.length > resolvedRules.maxConcurrentExplosions) {
    errors.push("ACTIVE_EXPLOSION_LIMIT");
  }
  for (const key of [
    "directTargets",
    "chainTargets",
    "maxChain",
    "maxChainDurationTicks",
    "maxConcurrentExplosions",
    "maxActiveEntities",
  ]) {
    if (!isInteger(state.stats?.[key]) || state.stats[key] < 0) {
      errors.push(`STATS_${key.toUpperCase()}_INVALID`);
    }
  }
  if (state.simulationFault !== null && typeof state.simulationFault !== "object") {
    errors.push("FAULT_SHAPE");
  }
  return [...new Set(errors)];
};

export const stateFingerprint = (state) => JSON.stringify(snapshotState(state));

export default createInitialState;
