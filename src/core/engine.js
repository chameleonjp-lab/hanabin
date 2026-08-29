import {
  DEFAULT_RULES,
  directExplosionRadiusForSelection,
  mergeRules,
  scoreForColor,
  selectionDurationMultiplierPercent,
  selectionRadiusMultiplierPercent,
  waveTickAt,
} from "../config/rules.js";
import {
  canonicalInputFrame,
  normalizeInputFrame,
  validateInputFrame,
} from "./input-frame.js";
import { createInitialState, snapshotState, validateState } from "./state.js";
import { generateUpcomingWaves, generateWave } from "./wave-generator.js";
import {
  scoreForChain,
  scoreForDirect,
  scoreForPreparation,
} from "./scoring.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const finiteInteger = (value) => Number.isInteger(value) && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const idKey = (value) => String(value);
const numericId = (value) => (Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER);
const distanceSquared = (leftX, leftY, rightX, rightY) => {
  const dx = leftX - rightX;
  const dy = leftY - rightY;
  return dx * dx + dy * dy;
};

const compareIds = (left, right) => {
  const leftNumber = numericId(left);
  const rightNumber = numericId(right);
  if (leftNumber !== Number.MAX_SAFE_INTEGER || rightNumber !== Number.MAX_SAFE_INTEGER) {
    return leftNumber - rightNumber;
  }
  return idKey(left).localeCompare(idKey(right), "en");
};

const compareCollisionEvents = (left, right) =>
  left.fireTick - right.fireTick ||
  left.actionId - right.actionId ||
  compareIds(left.sourceId, right.sourceId) ||
  left.eventId - right.eventId;

const activeEntities = (state) => state.fireworks.filter((entity) => entity.status === "active");
const queuedGameplayEntityCount = (state) =>
  state.fireworks.filter((entity) => entity.layout !== "choice-reserve").length +
  state.pendingEntities.length;

const playableGroup = (state, rules, { stopAt = 0 } = {}) => {
  const candidates = activeEntities(state).filter((entity) =>
    !rules.selectionMustBeVisible || entity.visible,
  );
  const linkRadiusSquared = rules.selectionLinkDistance * rules.selectionLinkDistance;
  const byColor = new Map();
  for (const candidate of candidates) {
    const group = byColor.get(candidate.color) ?? [];
    group.push(candidate);
    byColor.set(candidate.color, group);
  }
  const groups = [];
  for (const [color, colorCandidates] of [...byColor.entries()].sort((left, right) => left[0] - right[0])) {
    colorCandidates.sort((left, right) => compareIds(left.id, right.id));
    const visited = new Set();
    for (const start of colorCandidates) {
      const startKey = idKey(start.id);
      if (visited.has(startKey)) continue;
      const queue = [start];
      let queueIndex = 0;
      visited.add(startKey);
      const members = [];
      while (queueIndex < queue.length) {
        const current = queue[queueIndex++];
        members.push(current);
        for (const candidate of colorCandidates) {
          const candidateKey = idKey(candidate.id);
          if (visited.has(candidateKey)) continue;
          if (distanceSquared(current.x, current.y, candidate.x, candidate.y) > linkRadiusSquared) continue;
          visited.add(candidateKey);
          queue.push(candidate);
        }
      }
      const group = { color, members };
      if (stopAt > 0 && members.length >= stopAt) return group;
      groups.push(group);
    }
  }
  return groups.sort((left, right) =>
    right.members.length - left.members.length ||
    left.color - right.color ||
    compareIds(left.members[0]?.id, right.members[0]?.id),
  )[0] ?? null;
};

/** Return the largest currently visible same-colour selection group. */
export const playableChoiceCount = (state, rulesArg = DEFAULT_RULES) => {
  const rules = mergeRules(rulesArg);
  return playableGroup(state, rules)?.members.length ?? 0;
};

const choiceReservePosition = (state, group, index, count, rules) => {
  const first = group?.members?.[0];
  const sequence = state.choiceGuaranteeSequence + 1;
  const defaultX = rules.boardWidth * (0.25 + (sequence % 3) * 0.25);
  const defaultY = rules.boardHeight * (0.28 + (sequence % 2) * 0.32);
  const anchorX = first?.x ?? Math.round(defaultX);
  const anchorY = first?.y ?? Math.round(defaultY);
  const stepX = Math.max(1, Math.min(
    Math.round(rules.selectionLinkDistance * 0.24),
    Math.round(rules.boardWidth * 0.06),
  ));
  const stepY = Math.max(1, Math.min(
    Math.round(rules.selectionLinkDistance * 0.12),
    Math.round(rules.boardHeight * 0.05),
  ));
  const centeredIndex = index - (count - 1) / 2;
  const x = clamp(
    Math.round(anchorX + (centeredIndex + 1.1) * stepX),
    0,
    rules.boardWidth,
  );
  const y = clamp(
    Math.round(anchorY + (index % 2 === 0 ? -stepY : stepY)),
    0,
    rules.boardHeight,
  );
  return { x, y };
};

// Runtime fail-safe for expiry, visibility changes, and a chain that clears
// the only group. It adds only non-forecast targets, so it never manufactures
// forecast score bonuses or changes the wave schedule.
const ensurePlayableChoices = (state, rules) => {
  if (!state || state.simulationFault || state.status !== "running" || state.tick >= rules.maxTicks) return;
  // Let an active chain finish before adding a reserve. Otherwise the newly
  // created targets could be pulled into the same explosion and turn a
  // recovery mechanism into an unintended chain multiplier.
  if (state.activeExplosions.length || state.chainQueue.length) return;
  // Pending entities are future choices, not choices visible right now. They
  // do not exempt the current board from the guarantee; the active-capacity
  // calculation below still prevents the reserve from exceeding the bound.
  const current = playableGroup(state, rules, { stopAt: rules.minimumPlayableChoices });
  if ((current?.members.length ?? 0) >= rules.minimumPlayableChoices) return;
  if (state.choiceGuaranteeTick === state.tick) return;
  const capacity = Math.max(0, rules.maxActiveEntities - activeEntities(state).length);
  const needed = Math.min(
    rules.minimumPlayableChoices - (current?.members.length ?? 0),
    capacity,
  );
  if (needed <= 0) return;
  const color = current?.color ?? state.upcomingWaves?.[0]?.primaryColor ?? state.waves.at(-1)?.primaryColor ?? 0;
  const waveIndex = Number.isInteger(state.nextWaveIndex) ? state.nextWaveIndex : 0;
  const reserveSequence = state.choiceGuaranteeSequence + 1;
  const anchor = current?.members?.[0] ?? null;
  for (let index = 0; index < needed; index += 1) {
    const position = choiceReservePosition(state, current, index, needed, rules);
    const entity = {
      id: 1_000_000 + reserveSequence * 100 + index,
      waveId: `choice-reserve-${reserveSequence}`,
      waveIndex,
      localIndex: index,
      color,
      x: position.x,
      y: position.y,
      baseX: position.x,
      baseY: position.y,
      vx: 0,
      vy: 0,
      depth: 1_050 + index,
      radius: rules.entityRadius,
      spawnTick: state.tick,
      lifetimeTicks: rules.lifetimeMaxTicks,
      expiresTick: state.tick + rules.lifetimeMaxTicks,
      layout: "choice-reserve",
      forecastForWaveIndex: null,
      visible: true,
      status: "active",
      scored: false,
    };
    state.fireworks.push(entity);
    state.stats.entitiesSpawned += 1;
    state.stats.choiceGuaranteeEntities += 1;
  }
  state.choiceGuaranteeSequence = reserveSequence;
  state.choiceGuaranteeTick = state.tick;
  state.stats.choiceGuaranteeGroups += 1;
  state.lastAction = { type: "choice-guarantee", count: needed, color };
  if (anchor) state.lastAction.anchorId = anchor.id;
};

const setFault = (state, code, message, details = {}) => {
  if (!state.simulationFault) {
    state.simulationFault = {
      code,
      message,
      tick: state.tick,
      details: clone(details),
    };
  }
  state.status = "fault";
  state.lastAction = { type: "simulationFault", code };
  return state;
};

const ignore = (state, reason, details = {}) => {
  state.stats.ignoredInputs += 1;
  state.lastAction = { type: "ignored", reason, ...details };
  return false;
};

const getEntity = (state, id) => state.fireworks.find((entity) => idKey(entity.id) === idKey(id));

const isInsideBoard = (entity, rules) => {
  const margin = rules.visibleMargin;
  return entity.x >= -margin && entity.x <= rules.boardWidth + margin &&
    entity.y >= -margin && entity.y <= rules.boardHeight + margin;
};

const updateEntityPosition = (entity, tick, rules) => {
  const elapsed = Math.max(0, tick - entity.spawnTick);
  entity.x = Math.round(entity.baseX + entity.vx * elapsed);
  entity.y = Math.round(entity.baseY + entity.vy * elapsed);
  entity.visible = isInsideBoard(entity, rules);
};

const clearSelectionState = (state, reason = "clear") => {
  if (state.selectedIds.length && reason !== "detonate") state.stats.selectionDrops += 1;
  state.selectedIds = [];
  state.selectedColor = null;
  state.selectionSinceTick = null;
  state.selectionAgeTicks = 0;
  state.selectionRecords = [];
  state.lastAcquisitionX = null;
  state.lastAcquisitionY = null;
  state.lastAcquisitionTick = null;
};

const dropInvisibleSelections = (state, rules) => {
  if (!state.selectedIds.length) return;
  const kept = [];
  const records = [];
  for (const id of state.selectedIds) {
    const entity = getEntity(state, id);
    if (!entity || entity.status !== "active" || (rules.selectionMustBeVisible && !entity.visible)) {
      state.stats.selectionDrops += 1;
      continue;
    }
    kept.push(entity.id);
    const record = state.selectionRecords.find((item) => idKey(item.id) === idKey(entity.id));
    if (record) records.push(record);
  }
  state.selectedIds = kept;
  state.selectionRecords = records;
  state.selectedColor = kept.length ? getEntity(state, kept[0]).color : null;
  if (!kept.length) {
    state.selectionSinceTick = null;
    state.selectionAgeTicks = 0;
  } else {
    state.selectionAgeTicks = Math.max(0, state.tick - state.selectionSinceTick);
  }
};

const promotePending = (state, rules) => {
  if (!state.pendingEntities.length) return;
  while (state.pendingEntities.length && activeEntities(state).length < rules.maxActiveEntities) {
    const pending = state.pendingEntities.shift();
    pending.status = "active";
    pending.visible = isInsideBoard(pending, rules);
    state.fireworks.push(pending);
  }
};

const refreshAt = (state, tick, rules) => {
  state.tick = tick;
  state.timeTick = tick;
  state.resolutionTick = tick;
  for (const entity of state.fireworks) {
    if (entity.status !== "active") continue;
    updateEntityPosition(entity, tick, rules);
    if (tick >= entity.expiresTick) {
      entity.status = "expired";
      entity.visible = false;
      state.stats.entitiesExpired += 1;
    }
  }
  promotePending(state, rules);
  dropInvisibleSelections(state, rules);
  if (state.selectedIds.length && state.selectionSinceTick !== null) {
    state.selectionAgeTicks = Math.max(0, tick - state.selectionSinceTick);
    if (state.selectionAgeTicks >= rules.selectionTimeoutTicks) {
      if (state.selectedIds.length >= rules.minSelection) {
        detonate(state, rules, state.actionCount);
      } else {
        clearSelectionState(state, "timeout");
      }
    }
  }
  state.stats.maxActiveEntities = Math.max(state.stats.maxActiveEntities, activeEntities(state).length);
  ensurePlayableChoices(state, rules);
  state.stats.maxActiveEntities = Math.max(state.stats.maxActiveEntities, activeEntities(state).length);
};

const appendWave = (state, wave, rules) => {
  const metadata = {
    waveId: wave.waveId,
    waveIndex: wave.waveIndex,
    kind: wave.kind,
    primaryColor: wave.primaryColor,
    mainColor: wave.primaryColor,
    secondaryColor: wave.secondaryColor,
    nextPrimaryColor: wave.nextPrimaryColor,
    order: wave.order,
    sequence: wave.sequence,
    position: wave.position,
    layout: wave.layout,
    fireTick: wave.fireTick,
  };
  state.waves.push(metadata);
  for (const candidate of wave.entities) {
    // Choice reserves are a recovery surface, not part of the bounded wave
    // queue. They must not make an otherwise valid no-input run fault merely
    // because the player allowed several waves to accumulate.
    if (queuedGameplayEntityCount(state) >= rules.maxPendingEntities + rules.maxActiveEntities) {
      setFault(state, "ENTITY_QUEUE_LIMIT", "entity queue limit exceeded", {
        waveId: wave.waveId,
      });
      break;
    }
    if (activeEntities(state).length < rules.maxActiveEntities) {
      state.fireworks.push(candidate);
    } else {
      candidate.status = "pending";
      candidate.visible = false;
      state.pendingEntities.push(candidate);
    }
    state.stats.entitiesSpawned += 1;
  }
  state.stats.wavesSpawned += 1;
};

const refreshUpcoming = (state, rules) => {
  if (state.upcomingWaveIndex === state.nextWaveIndex && state.upcomingWaves.length) return;
  state.upcomingWaves = generateUpcomingWaves(
    state.seed,
    state.nextWaveIndex,
    rules,
    2,
  );
  state.upcomingWaveIndex = state.nextWaveIndex;
};

export const createGame = (seedOrOptions = 1, rulesArg = DEFAULT_RULES) => {
  let seed = seedOrOptions;
  let rules = rulesArg;
  if (seedOrOptions && typeof seedOrOptions === "object") {
    seed = seedOrOptions.seed ?? 1;
    rules = seedOrOptions.rules ?? rulesArg;
  }
  const resolvedRules = mergeRules(rules);
  const state = createInitialState(seed, resolvedRules);
  const firstWave = generateWave(state.seed, 0, resolvedRules);
  appendWave(state, firstWave, resolvedRules);
  state.nextWaveIndex = 1;
  refreshUpcoming(state, resolvedRules);
  state.lastAction = { type: "created" };
  return state;
};

export const startGame = (state, rulesArg = DEFAULT_RULES) => {
  if (!state || typeof state !== "object") return state;
  if (state.simulationFault) return state;
  if (state.status === "ready") {
    state.status = "running";
    ensurePlayableChoices(state, mergeRules(rulesArg));
  }
  return state;
};

/** Advance directly to a tick; positions are derived from tick, not elapsed calls. */
export const advanceGame = (state, targetTick, rulesArg = DEFAULT_RULES) => {
  if (!state || typeof state !== "object") return state;
  const rules = mergeRules(rulesArg);
  if (state.simulationFault) return state;
  if (!finiteInteger(targetTick) || targetTick < state.tick || targetTick > rules.maxTicks) {
    return setFault(state, "INVALID_TICK", "tick must be an integer within the replay range", {
      targetTick,
      currentTick: state.tick,
      maxTicks: rules.maxTicks,
    });
  }
  startGame(state, rules);
  while (!state.simulationFault) {
    const waveFireTick = state.nextWaveIndex < rules.maxWaves
      ? waveTickAt(state.nextWaveIndex, rules)
      : Number.POSITIVE_INFINITY;
    const timeoutTick = state.selectionSinceTick === null
      ? Number.POSITIVE_INFINITY
      : state.selectionSinceTick + rules.selectionTimeoutTicks;
    const chainFireTick = state.chainQueue[0]?.fireTick ?? Number.POSITIVE_INFINITY;
    const activeExplosionTick = state.activeExplosions.length
      ? state.tick + 1
      : Number.POSITIVE_INFINITY;
    const nextTick = Math.min(waveFireTick, timeoutTick, chainFireTick, activeExplosionTick);
    if (nextTick > targetTick || nextTick > rules.maxTicks || nextTick <= state.tick) break;
    refreshAt(state, nextTick, rules);
    processChainQueue(state, nextTick, rules);
    if (waveFireTick === nextTick && !state.simulationFault) {
      appendWave(state, generateWave(state.seed, state.nextWaveIndex, rules), rules);
      state.nextWaveIndex += 1;
    }
  }
  refreshAt(state, targetTick, rules);
  if (targetTick === rules.maxTicks) {
    processChainQueue(state, targetTick, rules);
  } else {
    processChainQueue(state, targetTick, rules);
    refreshUpcoming(state, rules);
  }
  if (state.tick >= rules.maxTicks && state.status === "running" && !state.simulationFault) {
    finishGame(state, rules, false);
  }
  return state;
};

export const stepGame = (state, ticks = 1, rules = DEFAULT_RULES) => {
  if (!finiteInteger(ticks) || ticks < 0) {
    return setFault(state, "INVALID_STEP", "step must be a non-negative integer", { ticks });
  }
  return advanceGame(state, state.tick + ticks, rules);
};

const candidateList = (state, x, y, color, rules) => {
  if (!finiteInteger(x) || !finiteInteger(y)) return [];
  if (state.tick < state.cooldownUntilTick) return [];
  const hitRadiusSquared = rules.selectionHitRadius * rules.selectionHitRadius;
  const linkRadiusSquared = rules.selectionLinkDistance * rules.selectionLinkDistance;
  const lockedColor = state.selectedColor !== null && rules.selectionSameColor
    ? state.selectedColor
    : color;
  const lastSelected = state.selectedIds.length
    ? getEntity(state, state.selectedIds[state.selectedIds.length - 1])
    : null;
  const linkX = lastSelected?.x ?? state.lastAcquisitionX;
  const linkY = lastSelected?.y ?? state.lastAcquisitionY;
  const hasLinkOrigin = finiteInteger(linkX) && finiteInteger(linkY);
  return activeEntities(state)
    .filter((entity) => entity.visible)
    .filter((entity) => lockedColor === undefined || entity.color === lockedColor)
    .filter((entity) => !state.selectedIds.some((id) => idKey(id) === idKey(entity.id)))
    .map((entity) => ({
      entity,
      distanceSquared: distanceSquared(x, y, entity.x, entity.y),
      linkDistanceSquared: hasLinkOrigin
        ? distanceSquared(linkX, linkY, entity.x, entity.y)
        : 0,
    }))
    .filter((item) => item.distanceSquared <= hitRadiusSquared)
    .filter((item) => !hasLinkOrigin || item.linkDistanceSquared <= linkRadiusSquared)
    .sort((left, right) =>
      left.distanceSquared - right.distanceSquared ||
      right.entity.depth - left.entity.depth ||
      compareIds(left.entity.id, right.entity.id),
    );
};

export const findCandidates = (state, x, y, options = {}, rulesArg = DEFAULT_RULES) => {
  const rules = mergeRules(rulesArg);
  return candidateList(state, x, y, options.color, rules).map((item) => ({
    ...item.entity,
    distanceSquared: item.distanceSquared,
  }));
};

export const selectAt = (state, x, y, options = {}, rulesArg = DEFAULT_RULES) => {
  const rules = mergeRules(rulesArg);
  const candidates = candidateList(state, x, y, options.color, rules);
  const candidate = candidates.find((item) => !state.selectedIds.some((id) => idKey(id) === idKey(item.entity.id)))?.entity;
  return candidate ? selectEntity(state, candidate.id, rules, { x, y }) : null;
};

export const selectEntity = (state, id, rulesArg = DEFAULT_RULES, acquisition = {}) => {
  const rules = mergeRules(rulesArg);
  if (state.simulationFault) return null;
  startGame(state, rules);
  if (state.tick < state.cooldownUntilTick) {
    ignore(state, "cooldown", { id });
    return null;
  }
  const entity = getEntity(state, id);
  if (!entity || entity.status !== "active") {
    ignore(state, "target-not-active", { id });
    return null;
  }
  if (rules.selectionMustBeVisible && !entity.visible) {
    ignore(state, "target-offscreen", { id });
    return null;
  }
  if (!finiteInteger(acquisition.x) || !finiteInteger(acquisition.y)) {
    ignore(state, "selection-coordinate-required", { id });
    return null;
  }
  const geometryWinner = candidateList(state, acquisition.x, acquisition.y, undefined, rules)[0]?.entity;
  if (!geometryWinner || idKey(geometryWinner.id) !== idKey(entity.id)) {
    ignore(state, "target-outside-selection-geometry", { id });
    return null;
  }
  if (state.selectedIds.some((selectedId) => idKey(selectedId) === idKey(entity.id))) {
    ignore(state, "target-already-selected", { id: entity.id });
    return entity;
  }
  if (state.lastAcquisitionTick === state.tick) {
    ignore(state, "one-acquisition-per-tick", { id: entity.id });
    return null;
  }
  if (state.selectedColor !== null && rules.selectionSameColor && state.selectedColor !== entity.color) {
    ignore(state, "different-color", { id: entity.id });
    return null;
  }
  if (state.selectedIds.length >= rules.maxSelection) {
    ignore(state, "selection-limit", { id: entity.id });
    return null;
  }
  if (state.selectionSinceTick === null) state.selectionSinceTick = state.tick;
  state.selectedColor = entity.color;
  state.selectedIds.push(entity.id);
  state.selectionRecords.push({
    id: entity.id,
    x: entity.x,
    y: entity.y,
    pointerX: acquisition.x,
    pointerY: acquisition.y,
    acquiredTick: state.tick,
  });
  state.lastAcquisitionX = state.selectionRecords[state.selectionRecords.length - 1].x;
  state.lastAcquisitionY = state.selectionRecords[state.selectionRecords.length - 1].y;
  state.lastAcquisitionTick = state.tick;
  state.selectionAgeTicks = Math.max(0, state.tick - state.selectionSinceTick);
  state.lastAction = { type: "select", id: entity.id };
  return entity;
};

/**
 * Consume one pressed+x+y frame. A candidate is acquired only after it has
 * remained the deterministic top candidate for three consecutive ticks. The
 * function performs at most one acquisition, and never accepts a direct id
 * from the input protocol.
 */
export const consumePointerFrame = (state, frame, rulesArg = DEFAULT_RULES) => {
  const rules = mergeRules(rulesArg);
  const cancellationReason = frame.cancelled === true
    ? "pointer-cancelled"
    : (frame.interrupted === true ? "pointer-interrupted" : null);
  if (cancellationReason) {
    state.pointerPressed = false;
    state.hoverCandidateId = null;
    state.hoverTicks = 0;
    clearSelectionState(state, cancellationReason);
    state.lastAction = { type: "selection-cancelled", reason: cancellationReason };
    return null;
  }
  if (frame.pressed !== true) {
    const wasPressed = state.pointerPressed;
    state.pointerPressed = false;
    state.hoverCandidateId = null;
    state.hoverTicks = 0;
    if (wasPressed && state.selectedIds.length) {
      if (state.selectedIds.length >= rules.minSelection) {
        const detonated = detonate(state, rules, frame.actionId);
        if (!detonated && state.selectedIds.length) {
          clearSelectionState(state, "release-rejected");
        }
      } else {
        clearSelectionState(state, "release-below-minimum");
        state.lastAction = { type: "selection-cleared", reason: "release-below-minimum" };
      }
    }
    return null;
  }
  state.pointerPressed = true;
  const candidates = candidateList(state, frame.x, frame.y, undefined, rules);
  const candidate = candidates[0]?.entity ?? null;
  if (!candidate) {
    state.hoverCandidateId = null;
    state.hoverTicks = 0;
    return null;
  }
  if (idKey(state.hoverCandidateId) === idKey(candidate.id)) {
    state.hoverTicks += 1;
  } else {
    state.hoverCandidateId = candidate.id;
    state.hoverTicks = 1;
  }
  if (state.hoverTicks < rules.minHoldTicks) return null;
  const acquired = selectEntity(state, candidate.id, rules, { x: frame.x, y: frame.y });
  state.hoverCandidateId = null;
  state.hoverTicks = 0;
  return acquired;
};

export const deselectEntity = (state, id, rulesArg = DEFAULT_RULES) => {
  if (!state || state.simulationFault) return state;
  const index = state.selectedIds.findIndex((selectedId) => idKey(selectedId) === idKey(id));
  if (index < 0) {
    ignore(state, "target-not-selected", { id });
    return state;
  }
  state.selectedIds.splice(index, 1);
  state.selectionRecords = state.selectionRecords.filter((record) => idKey(record.id) !== idKey(id));
  state.selectedColor = state.selectedIds.length ? getEntity(state, state.selectedIds[0])?.color ?? null : null;
  if (!state.selectedIds.length) {
    state.selectionSinceTick = null;
    state.selectionAgeTicks = 0;
  }
  state.lastAction = { type: "deselect", id };
  return state;
};

const scoreTarget = (state, target, sourceColor, event, rules) => {
  if (!target || target.status !== "active" || state.scoredTargetIds.some((id) => idKey(id) === idKey(target.id))) {
    return false;
  }
  if (state.scoreEvents.length + state.bonusEvents.length >= rules.maxScoreEvents) {
    setFault(state, "SCORE_EVENT_LIMIT", "score event limit exceeded", {
      actionId: event.actionId,
    });
    return false;
  }
  if (state.activeExplosions.length >= rules.maxConcurrentExplosions) {
    setFault(state, "EXPLOSION_ACTIVE_LIMIT", "active explosion limit exceeded", {
      actionId: event.actionId,
    });
    return false;
  }
  const baseAmount = event.kind === "direct"
    ? scoreForDirect(1, rules)
    : scoreForChain(event.depth, rules);
  const actionKey = idKey(event.actionId);
  const caughtBefore = state.actionCaughtCounts[actionKey] ?? 0;
  const inclusionAlready = Math.max(0, caughtBefore - rules.minimumSelection) *
    rules.inclusionScorePerExtraTarget;
  const inclusionAmount = caughtBefore >= rules.minimumSelection
    ? Math.min(
      rules.inclusionScorePerExtraTarget,
      Math.max(0, rules.inclusionScoreCap - inclusionAlready),
    )
    : 0;
  const forecastWaveIndex = Number.isInteger(event.forecastWaveIndex)
    ? event.forecastWaveIndex
    : null;
  const forecastPlanAmount = event.kind === "chain" &&
      event.forecastPlan === true &&
      forecastWaveIndex !== null &&
      target.waveIndex === forecastWaveIndex
    ? rules.forecastChainPerTarget
    : 0;
  const amount = baseAmount + inclusionAmount + forecastPlanAmount;
  target.status = "exploded";
  target.visible = false;
  target.scored = true;
  state.scoredTargetIds.push(target.id);
  state.actionCaughtCounts[actionKey] = caughtBefore + 1;
  state.scoreEvents.push({
    targetId: target.id,
    sourceId: event.sourceId,
    actionId: event.actionId,
    eventId: event.eventId,
    fireTick: event.fireTick,
    kind: event.kind,
    generation: event.depth,
    baseAmount,
    inclusionAmount,
    forecastPlanAmount,
    forecastWaveIndex,
    amount,
    sourceColor,
    targetColor: target.color,
  });
  const explosionDurationTicks = event.explosionDurationTicks ?? rules.baseExplosionDurationTicks;
  state.activeExplosions.push({
    actionId: event.actionId,
    eventId: event.eventId,
    sourceId: event.sourceId,
    targetId: target.id,
    originX: target.x,
    originY: target.y,
    sourceColor: target.color,
    fireTick: event.fireTick,
    endTick: event.fireTick + explosionDurationTicks,
    durationTicks: explosionDurationTicks,
    radius: event.radius,
    directRadius: event.directRadius ?? event.radius,
    depth: event.depth,
    chainStartTick: event.chainStartTick,
    forecastPlan: event.forecastPlan === true,
    forecastWaveIndex,
    radiusMultiplierPercent: event.radiusMultiplierPercent,
    durationMultiplierPercent: event.durationMultiplierPercent,
    kind: event.kind,
    chainable: target.layout !== "choice-reserve",
  });
  state.score += amount;
  state.stats.entitiesExploded += 1;
  if (event.kind === "direct") state.stats.directTargets += 1;
  else state.stats.chainTargets += 1;
  state.stats.maxChain = Math.max(state.stats.maxChain, caughtBefore + 1);
  state.stats.maxChainDurationTicks = Math.max(
    state.stats.maxChainDurationTicks,
    Math.max(0, event.fireTick + explosionDurationTicks - event.chainStartTick),
  );
  state.stats.maxConcurrentExplosions = Math.max(
    state.stats.maxConcurrentExplosions,
    state.activeExplosions.length,
  );
  return true;
};

const enqueueChainEvent = (state, event, rules) => {
  if (state.chainQueue.length >= rules.maxConcurrentExplosions) {
    setFault(state, "EXPLOSION_QUEUE_LIMIT", "explosion queue limit exceeded", {
      actionId: event.actionId,
    });
    return false;
  }
  const targetKey = idKey(event.targetId);
  if (state.queuedTargetIds.some((id) => idKey(id) === targetKey) ||
      state.scoredTargetIds.some((id) => idKey(id) === targetKey)) return false;
  state.chainQueue.push(event);
  state.queuedTargetIds.push(event.targetId);
  state.chainQueue.sort(compareCollisionEvents);
  return true;
};

const collectActiveExplosionHits = (state, tick, rules) => {
  if (!state.activeExplosions.length || state.simulationFault) return;
  const snapshot = activeEntities(state)
    .map((entity) => ({
      id: entity.id,
      color: entity.color,
      x: entity.x,
      y: entity.y,
      depth: entity.depth,
      layout: entity.layout,
    }))
    .sort((left, right) => compareIds(left.id, right.id));
  const unavailable = new Set([
    ...state.scoredTargetIds.map(idKey),
    ...state.queuedTargetIds.map(idKey),
  ]);
  const proposals = [];
  const explosions = [...state.activeExplosions].sort((left, right) =>
    left.fireTick - right.fireTick ||
    left.actionId - right.actionId ||
    compareIds(left.targetId, right.targetId) ||
    left.eventId - right.eventId,
  );
  for (const explosion of explosions) {
    // Emergency choice reserves are selectable recovery targets, but their
    // direct points must not become a farmable chain source while a board is
    // waiting for the next normal wave.
    if (explosion.chainable === false) continue;
    for (const candidate of snapshot) {
      const candidateKey = idKey(candidate.id);
      if (candidate.layout === "choice-reserve") continue;
      if (candidateKey === idKey(explosion.targetId) || unavailable.has(candidateKey)) continue;
      const ratio = candidate.color === explosion.sourceColor
        ? rules.sameColorRadius / 100
        : rules.differentColorRadius / 100;
      const nextRadius = Math.max(
        Math.round(explosion.directRadius * (rules.minimumRadius / 100)),
        Math.round(explosion.radius * ratio),
      );
      const candidateDistance = distanceSquared(
        explosion.originX,
        explosion.originY,
        candidate.x,
        candidate.y,
      );
      if (candidateDistance > explosion.radius * explosion.radius) continue;
      proposals.push({ explosion, candidate, nextRadius, candidateDistance });
    }
  }
  proposals.sort((left, right) =>
    left.explosion.fireTick - right.explosion.fireTick ||
    left.explosion.actionId - right.explosion.actionId ||
    compareIds(left.explosion.targetId, right.explosion.targetId) ||
    left.explosion.eventId - right.explosion.eventId ||
    left.candidateDistance - right.candidateDistance ||
    right.candidate.depth - left.candidate.depth ||
    compareIds(left.candidate.id, right.candidate.id),
  );
  const proposedTargets = new Set();
  for (const proposal of proposals) {
    const candidateKey = idKey(proposal.candidate.id);
    if (proposedTargets.has(candidateKey) || unavailable.has(candidateKey)) continue;
    proposedTargets.add(candidateKey);
    const childEventId = state.eventCount + 1;
    state.eventCount = childEventId;
    enqueueChainEvent(state, {
      fireTick: tick + 1,
      actionId: proposal.explosion.actionId,
      sourceId: proposal.explosion.targetId,
      eventId: childEventId,
      targetId: proposal.candidate.id,
      originX: proposal.candidate.x,
      originY: proposal.candidate.y,
      sourceColor: proposal.candidate.color,
      scoreSourceColor: proposal.explosion.sourceColor,
      depth: proposal.explosion.depth + 1,
      kind: "chain",
      radius: proposal.nextRadius,
      directRadius: proposal.explosion.directRadius,
      radiusMultiplierPercent: proposal.explosion.radiusMultiplierPercent,
      durationMultiplierPercent: proposal.explosion.durationMultiplierPercent,
      explosionDurationTicks: proposal.explosion.durationTicks,
      chainStartTick: proposal.explosion.chainStartTick,
      forecastPlan: proposal.explosion.forecastPlan === true,
      forecastWaveIndex: proposal.explosion.forecastWaveIndex,
    }, rules);
    if (state.simulationFault) return;
  }
};

/**
 * Process due explosions in collect/commit batches. Every batch reads one
 * immutable start-of-tick snapshot, resolves competing claims in a stable
 * order, and only then mutates targets and queues the next generation.
 */
const processChainQueue = (state, tick, rules) => {
  state.activeExplosions = state.activeExplosions.filter((explosion) => explosion.endTick > tick);
  while (state.chainQueue.length) {
    state.chainQueue.sort(compareCollisionEvents);
    const fireTick = state.chainQueue[0].fireTick;
    if (fireTick > tick) break;
    state.activeExplosions = state.activeExplosions.filter((explosion) => explosion.endTick > fireTick);
    const due = [];
    while (state.chainQueue.length && state.chainQueue[0].fireTick === fireTick) {
      due.push(state.chainQueue.shift());
    }
    const dueTargetKeys = new Set(due.map((event) => idKey(event.targetId)));
    state.queuedTargetIds = state.queuedTargetIds.filter((id) => !dueTargetKeys.has(idKey(id)));
    for (const moving of state.fireworks) {
      if (moving.status === "active") updateEntityPosition(moving, fireTick, rules);
    }
    const snapshot = activeEntities(state)
      .map((entity) => ({
        id: entity.id,
        color: entity.color,
        x: entity.x,
        y: entity.y,
        depth: entity.depth,
      }))
      .sort((left, right) => compareIds(left.id, right.id));
    const snapshotById = new Map(snapshot.map((entity) => [idKey(entity.id), entity]));
    const claimed = new Set();
    const confirmed = [];
    for (const event of due.sort(compareCollisionEvents)) {
      if (event.fireTick > event.chainStartTick + rules.maxChainTicks) {
        setFault(state, "CHAIN_TICK_LIMIT", "chain exceeded its 150 tick resolution limit", {
          fireTick: event.fireTick,
          chainStartTick: event.chainStartTick,
        });
        return;
      }
      const targetKey = idKey(event.targetId);
      if (!snapshotById.has(targetKey) || claimed.has(targetKey) ||
          state.scoredTargetIds.some((id) => idKey(id) === targetKey)) continue;
      claimed.add(targetKey);
      confirmed.push({ event, target: snapshotById.get(targetKey) });
    }
    if (state.chainEvents.length + confirmed.length > rules.maxChainEvents) {
      setFault(state, "CHAIN_EVENT_LIMIT", "chain event limit exceeded", { fireTick });
      return;
    }

    // Commit the winning hit for each target only after every claim is known.
    for (const { event, target: targetSnapshot } of confirmed) {
      const target = getEntity(state, targetSnapshot.id);
      if (!scoreTarget(state, target, event.scoreSourceColor, event, rules)) {
        if (state.simulationFault) return;
        continue;
      }
      state.chainEvents.push({ ...event });
    }

  }
  for (const moving of state.fireworks) {
    if (moving.status === "active") updateEntityPosition(moving, tick, rules);
  }
  dropInvisibleSelections(state, rules);
  state.activeExplosions = state.activeExplosions.filter((explosion) => explosion.endTick > tick);
  collectActiveExplosionHits(state, tick, rules);
  ensurePlayableChoices(state, rules);
};

/**
 * Resolve the input boundary without opening another wave interval.  Session
 * input ends at maxTicks, but events already scheduled by a terminal
 * detonation are allowed to run for the bounded chain horizon.
 */
const resolveTerminalChain = (state, rules) => {
  const startTick = rules.maxTicks;
  const limitTick = startTick + rules.maxChainTicks;
  if (!state.chainQueue.length && !state.activeExplosions.length) {
    state.resolutionTick = startTick;
    state.activeExplosions = [];
    return;
  }
  for (let resolutionTick = startTick + 1;
    resolutionTick <= limitTick && !state.simulationFault;
    resolutionTick += 1) {
    if (!state.chainQueue.length && !state.activeExplosions.length) break;
    state.resolutionTick = resolutionTick;
    for (const entity of state.fireworks) {
      if (entity.status !== "active") continue;
      updateEntityPosition(entity, resolutionTick, rules);
      if (resolutionTick >= entity.expiresTick) {
        entity.status = "expired";
        entity.visible = false;
        state.stats.entitiesExpired += 1;
      }
    }
    processChainQueue(state, resolutionTick, rules);
  }
  if (!state.simulationFault && (state.chainQueue.length || state.activeExplosions.length)) {
    const next = state.chainQueue[0];
    setFault(state, "CHAIN_TICK_LIMIT", "terminal chain did not resolve within its 150 tick limit", {
      fireTick: next?.fireTick,
      chainStartTick: next?.chainStartTick,
      activeExplosions: state.activeExplosions.length,
      resolutionTick: state.resolutionTick,
    });
  }
};

/** At the fixed session boundary, synthesize the pointer release. */
const finalizeTerminalInput = (state, rules) => {
  state.pointerPressed = false;
  state.hoverCandidateId = null;
  state.hoverTicks = 0;
  if (!state.selectedIds.length) return;
  if (state.selectedIds.length >= rules.minSelection) {
    // A final frame is a release boundary.  A set acquired immediately
    // before it still receives the same minimum hold opportunity as a normal
    // release; the boundary must not leave a valid selection stranded.
    state.selectionAgeTicks = Math.max(state.selectionAgeTicks, rules.minHoldTicks);
    state.cooldownUntilTick = Math.min(state.cooldownUntilTick, state.tick);
    detonate(state, rules, state.actionCount);
  } else {
    clearSelectionState(state, "terminal-release");
  }
};

const triggerChain = (state, selectedRecords, actionId, rules, {
  forecastPlan = false,
  forecastWaveIndex = null,
} = {}) => {
  let eventId = state.eventCount;
  const selected = [...selectedRecords].sort((left, right) => compareIds(left.id, right.id));
  const radiusMultiplierPercent = selectionRadiusMultiplierPercent(selected.length);
  const durationMultiplierPercent = selectionDurationMultiplierPercent(selected.length);
  const directRadius = directExplosionRadiusForSelection(selected.length, rules);
  const explosionDurationTicks = Math.round(
    rules.baseExplosionDurationTicks * durationMultiplierPercent / 100,
  );
  for (const record of selected) {
    const source = getEntity(state, record.id);
    if (!source || source.status !== "active") continue;
    eventId += 1;
    enqueueChainEvent(state, {
      fireTick: state.tick,
      actionId,
      sourceId: source.id,
      eventId,
      targetId: source.id,
      originX: source.x,
      originY: source.y,
      sourceColor: source.color,
      scoreSourceColor: source.color,
      depth: 0,
      kind: "direct",
      radius: directRadius,
      directRadius,
      radiusMultiplierPercent,
      durationMultiplierPercent,
      explosionDurationTicks,
      chainStartTick: state.tick,
      forecastPlan,
      forecastWaveIndex,
    }, rules);
  }
  state.eventCount = eventId;
  processChainQueue(state, state.tick, rules);
  return selected.length;
};

export const detonate = (state, rulesArg = DEFAULT_RULES, actionId = state.actionCount) => {
  const rules = mergeRules(rulesArg);
  if (state.simulationFault) return false;
  if (state.tick < state.cooldownUntilTick) return ignore(state, "cooldown");
  if (state.selectedIds.length < rules.minSelection) return ignore(state, "minimum-selection");
  if (state.selectionAgeTicks < rules.minHoldTicks) return ignore(state, "selection-not-held");
  const selectedRecords = clone(state.selectionRecords);
  const nextWave = state.upcomingWaves?.[0];
  const selectedEntities = selectedRecords.map((record) => getEntity(state, record.id)).filter(Boolean);
  const forecastBridgeCount = selectedEntities.filter((entity) =>
    Number.isInteger(entity.forecastForWaveIndex) &&
    nextWave && entity.forecastForWaveIndex === nextWave.waveIndex,
  ).length;
  const forecastLeadTicks = nextWave ? nextWave.fireTick - state.tick : null;
  const isForecastPlan = Boolean(nextWave &&
    Number.isInteger(forecastLeadTicks) &&
    forecastLeadTicks >= 1 &&
    forecastLeadTicks <= rules.forecastPlanLeadTicks &&
    selectedRecords.length === rules.forecastPlanSelectionCount &&
    selectedEntities.length === selectedRecords.length &&
    selectedEntities[0]?.color === nextWave.primaryColor &&
    forecastBridgeCount >= rules.minimumSelection);
  const forecastWaveIndex = isForecastPlan ? nextWave.waveIndex : null;
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.stats.detonationCount += 1;
  const exploded = triggerChain(state, selectedRecords, actionId, rules, {
    forecastPlan: isForecastPlan,
    forecastWaveIndex,
  });
  const preparationAmount = scoreForPreparation(selectedRecords.length, rules);
  const detonationAmount = rules.detonationBonus;
  const comboAmount = Math.max(0, state.combo - 1) * rules.comboBonus;
  const forecastPlanAmount = isForecastPlan ? rules.forecastPlanBonus : 0;
  const bonusAmount = preparationAmount + detonationAmount + comboAmount + forecastPlanAmount;
  if (bonusAmount > 0) {
    if (state.scoreEvents.length + state.bonusEvents.length >= rules.maxScoreEvents) {
      setFault(state, "SCORE_EVENT_LIMIT", "score event limit exceeded", { actionId });
      return false;
    }
    state.eventCount += 1;
    state.bonusEvents.push({
      actionId,
      eventId: state.eventCount,
      fireTick: state.tick,
      kind: "action-bonus",
      selectedCount: selectedRecords.length,
      preparationAmount,
      detonationAmount,
      comboAmount,
      forecastPlanAmount,
      forecastWaveId: forecastPlanAmount > 0 ? nextWave.waveId : null,
      forecastWaveIndex,
      forecastLeadTicks,
      forecastBridgeCount,
      amount: bonusAmount,
    });
    state.score += bonusAmount;
  }
  state.lastDetonationTick = state.tick;
  state.cooldownUntilTick = state.tick + rules.cooldownTicks;
  clearSelectionState(state, "detonate");
  state.lastAction = { type: "detonate", count: exploded, actionId };
  return exploded > 0;
};

export const finishGame = (state, rulesArg = DEFAULT_RULES, advance = true) => {
  const rules = mergeRules(rulesArg);
  if (!state || state.simulationFault) return state;
  if (state.status === "finished") return state;
  if (advance && state.tick < rules.maxTicks) {
    advanceGame(state, rules.maxTicks, rules);
    return state;
  }
  if (!state.simulationFault) {
    if (state.tick >= rules.maxTicks) {
      state.resolutionTick = rules.maxTicks;
      finalizeTerminalInput(state, rules);
      if (!state.simulationFault && (state.chainQueue.length || state.activeExplosions.length)) {
        resolveTerminalChain(state, rules);
      }
    }
  }
  if (!state.simulationFault) {
    clearSelectionState(state, "finish");
    state.status = "finished";
    state.finalScore = state.score;
    state.lastAction = { type: "finish" };
  }
  return state;
};

export const applyInputFrame = (state, frame, {
  rules: rulesArg = DEFAULT_RULES,
  record = true,
  trusted = false,
} = {}) => {
  const rules = mergeRules(rulesArg);
  const normalized = trusted ? frame : normalizeInputFrame(frame);
  if (!normalized || !["pointer", "noop"].includes(normalized.type)) {
    return setFault(state, "INPUT_TYPE_INVALID", "only fixed-tick pointer input is accepted", {
      type: normalized?.type,
    });
  }
  if (!trusted) {
    const frameErrors = validateInputFrame(normalized, { maxTicks: rules.maxTicks });
    if (frameErrors.length) {
      return setFault(state, "INVALID_INPUT_FRAME", "input frame rejected", { codes: frameErrors, frame });
    }
  }
  if (normalized.actionId !== state.actionCount) {
    return setFault(state, "ACTION_ORDER", "action id is missing, duplicated, or reversed", {
      expected: state.actionCount,
      received: normalized.actionId,
    });
  }
  if (normalized.tick !== state.actionCount) {
    return setFault(state, "TICK_ORDER", "input ticks must be exact, unique, and contiguous", {
      expected: state.actionCount,
      received: normalized.tick,
    });
  }
  if (normalized.tick < state.tick) {
    return setFault(state, "TICK_ORDER", "input tick is reversed", {
      current: state.tick,
      received: normalized.tick,
    });
  }
  if (normalized.tick > state.tick) advanceGame(state, normalized.tick, rules);
  if (state.simulationFault) return state;
  if ((normalized.type === "pointer" || normalized.type === "noop") &&
      (normalized.x < 0 || normalized.x > rules.boardWidth || normalized.y < 0 || normalized.y > rules.boardHeight)) {
    return setFault(state, "POINTER_OUT_OF_RANGE", "pointer coordinates are outside the internal board", {
      x: normalized.x,
      y: normalized.y,
    });
  }
  if (record) state.inputFrames.push(trusted ? { ...normalized } : canonicalInputFrame(normalized));
  state.actionCount += 1;
  switch (normalized.type) {
    case "noop":
      if (normalized.pressed) consumePointerFrame(state, normalized, rules);
      else consumePointerFrame(state, normalized, rules);
      break;
    case "pointer":
      consumePointerFrame(state, normalized, rules);
      break;
    default:
      return setFault(state, "INPUT_TYPE_INVALID", "unknown input type", { type: normalized.type });
  }
  return state;
};

export const applyAction = (state, type, payload = {}, rules = DEFAULT_RULES) => {
  const frame = {
    schemaVersion: undefined,
    tick: payload.tick ?? state.tick,
    actionId: state.actionCount,
    type,
    ...payload,
  };
  delete frame.schemaVersion;
  return applyInputFrame(state, frame, { rules });
};

export const replayFrames = (state, frames, rules = DEFAULT_RULES) => {
  for (const frame of frames) {
    applyInputFrame(state, frame, { rules });
    if (state.simulationFault) break;
  }
  return state;
};

export const snapshotGame = (state) => snapshotState(state);
export const validateGame = (state, rules = DEFAULT_RULES) => validateState(state, rules);
export const distanceBetween = (left, right) => distanceSquared(left.x, left.y, right.x, right.y);

export default createGame;
