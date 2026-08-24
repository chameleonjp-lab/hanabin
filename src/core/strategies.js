import {
  DEFAULT_RULES,
  mergeRules,
  selectionDurationMultiplierPercent,
} from "../config/rules.js";
import { createRng, hashSeed } from "./rng.js";

const idKey = (id) => String(id);

const visible = (state) => state.fireworks.filter((entity) =>
  entity.status === "active" && entity.visible && !state.selectedIds.some((id) => idKey(id) === idKey(entity.id))
);

const selectedColor = (state) => state.selectedColor;

const bestBy = (entities, score) => [...entities].sort((left, right) =>
  score(right) - score(left) || Number(left.id) - Number(right.id),
)[0];

const selectAction = (state, entity) => entity
  ? { type: "pointer", pressed: true, x: entity.x, y: entity.y }
  : { type: "pointer", pressed: false, x: 0, y: 0 };

const releaseAction = (state) => ({
  type: "pointer",
  pressed: false,
  x: state.lastAcquisitionX ?? 0,
  y: state.lastAcquisitionY ?? 0,
});

const holdAction = () => ({
  type: "pointer",
  pressed: true,
  x: 0,
  y: 0,
});

const sameColorOptions = (state) => visible(state).filter((entity) =>
  selectedColor(state) === null || entity.color === selectedColor(state),
);

const chooseClusterCandidate = (state) => {
  const options = sameColorOptions(state);
  return bestBy(options, (entity) => {
    const neighborCount = state.fireworks.filter((other) =>
      other.status === "active" && other.color === entity.color && other.id !== entity.id &&
      (other.x - entity.x) ** 2 + (other.y - entity.y) ** 2 <= 1_800 ** 2,
    ).length;
    return neighborCount * 10_000 + entity.depth * 10 - entity.id;
  });
};

const chooseShortestCandidate = (state) => {
  const options = sameColorOptions(state);
  const lastSelectedId = state.selectedIds.at(-1);
  const lastSelected = state.fireworks.find((entity) => idKey(entity.id) === idKey(lastSelectedId));
  const originX = lastSelected?.x ?? state.lastAcquisitionX ?? 8_000;
  const originY = lastSelected?.y ?? state.lastAcquisitionY ?? 4_500;
  return [...options].sort((left, right) =>
    ((left.x - originX) ** 2 + (left.y - originY) ** 2) -
      ((right.x - originX) ** 2 + (right.y - originY) ** 2) ||
    right.depth - left.depth ||
    Number(left.id) - Number(right.id),
  )[0];
};

const nearestLinkedOptions = (state, rules, color = state.selectedColor) => {
  const lastSelectedId = state.selectedIds.at(-1);
  const lastSelected = state.fireworks.find((entity) =>
    idKey(entity.id) === idKey(lastSelectedId)
  );
  const originX = lastSelected?.x ?? state.lastAcquisitionX ?? Math.round(rules.boardWidth / 2);
  const originY = lastSelected?.y ?? state.lastAcquisitionY ?? Math.round(rules.boardHeight / 2);
  const linkDistanceSquared = rules.selectionLinkDistance ** 2;
  return visible(state)
    .filter((entity) => color === null || color === undefined || entity.color === color)
    .filter((entity) => !lastSelected ||
      (entity.x - originX) ** 2 + (entity.y - originY) ** 2 <= linkDistanceSquared)
    .sort((left, right) =>
      ((left.x - originX) ** 2 + (left.y - originY) ** 2) -
        ((right.x - originX) ** 2 + (right.y - originY) ** 2) ||
      right.depth - left.depth ||
      Number(left.id) - Number(right.id),
    );
};

const fallbackColorForFive = (state, rules) => {
  const counts = new Map();
  for (const entity of visible(state)) {
    counts.set(entity.color, (counts.get(entity.color) ?? 0) + 1);
  }
  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= rules.forecastPlanSelectionCount)
    .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  return candidates[0]?.[0] ?? null;
};

export const strategyIdle = () => null;

export const strategyIdleFirstHalf = (state) =>
  state.tick < 1_800 ? null : strategyFirstVisible(state);

export const strategyForecast = (state, context = {}) => {
  const rules = context.rules ?? DEFAULT_RULES;
  const nextWave = state.upcomingWaves?.[0];
  const leadTicks = nextWave ? nextWave.fireTick - state.tick : null;
  if (!nextWave || !Number.isInteger(leadTicks)) return releaseAction(state);

  const explosionDurationTicks = Math.round(
    rules.baseExplosionDurationTicks *
      selectionDurationMultiplierPercent(rules.forecastPlanSelectionCount) / 100,
  );
  // The wave is appended after explosion processing on its fire tick. Leave
  // enough lifetime for the next tick's collision pass, with one hold-sized
  // safety margin for deterministic integer-tick ordering.
  const releaseLeadTicks = Math.min(
    rules.forecastPlanLeadTicks,
    Math.max(1, explosionDurationTicks - rules.minHoldTicks),
  );
  const planningLeadTicks = Math.min(
    rules.selectionTimeoutTicks - 1,
    rules.forecastPlanLeadTicks +
      rules.forecastPlanSelectionCount * rules.minHoldTicks * 2,
  );

  if (leadTicks < 1) return releaseAction(state);
  if (state.selectedIds.length >= rules.forecastPlanSelectionCount) {
    const selectedEntities = state.selectedIds.map((id) => state.fireworks.find((entity) =>
      idKey(entity.id) === idKey(id)
    ));
    const bridgeCount = selectedEntities.filter((entity) =>
      entity?.forecastForWaveIndex === nextWave.waveIndex
    ).length;
    const alignedWithForecast = state.selectedIds.length === rules.forecastPlanSelectionCount &&
      state.selectedColor === nextWave.primaryColor &&
      bridgeCount >= rules.minSelection;
    if (!alignedWithForecast) return releaseAction(state);
    return leadTicks >= 1 && leadTicks <= releaseLeadTicks
      ? releaseAction(state)
      : holdAction();
  }
  if (state.selectedIds.length === 0 && leadTicks > planningLeadTicks) return null;

  let targetColor = state.selectedColor;
  if (targetColor === null) {
    const preferredCount = visible(state)
      .filter((entity) => entity.color === nextWave.primaryColor).length;
    targetColor = preferredCount >= rules.forecastPlanSelectionCount
      ? nextWave.primaryColor
      : fallbackColorForFive(state, rules);
  }
  const options = nearestLinkedOptions(state, rules, targetColor);
  const bridgeOptions = options.filter((entity) =>
    entity.forecastForWaveIndex === nextWave.waveIndex
  );
  return selectAction(state, bridgeOptions[0] ?? options[0]);
};

export const strategyFirstVisible = (state) => {
  if (state.selectedIds.length >= 3) return releaseAction(state);
  return selectAction(state, bestBy(sameColorOptions(state), (entity) => -entity.id));
};

export const strategyFullSweep = (state) => {
  const sweepTicks = 240;
  const phase = state.tick % sweepTicks;
  const forward = Math.floor(state.tick / sweepTicks) % 2 === 0;
  const x = Math.round((forward ? phase : sweepTicks - 1 - phase) * 16_000 / (sweepTicks - 1));
  const lane = Math.floor(state.tick / sweepTicks) % 3;
  const y = Math.round((lane * 2 + 1) * 9_000 / 6);
  return { type: "pointer", pressed: true, x, y };
};

export const strategyGreedyCluster = (state) => {
  if (state.selectedIds.length >= 3) return releaseAction(state);
  return selectAction(state, chooseClusterCandidate(state));
};

export const strategyThreeThenDetonate = (state) => {
  if (state.selectedIds.length >= 3) {
    return releaseAction(state);
  }
  return selectAction(state, chooseShortestCandidate(state));
};

export const strategyFiveThenDetonate = (state, context = {}) => {
  const rules = context.rules ?? DEFAULT_RULES;
  if (state.selectedIds.length >= rules.forecastPlanSelectionCount) {
    return releaseAction(state);
  }
  return selectAction(state, nearestLinkedOptions(state, rules)[0]);
};

export const strategyBridge = (state) => {
  if (state.selectedIds.length >= 3) return releaseAction(state);
  const options = sameColorOptions(state);
  return selectAction(state, bestBy(options, (entity) => {
    const left = state.fireworks.filter((other) => other.status === "active" && other.color === entity.color && other.x < entity.x).length;
    const right = state.fireworks.filter((other) => other.status === "active" && other.color === entity.color && other.x > entity.x).length;
    return Math.min(left, right) * 20_000 + entity.depth * 10 - entity.id;
  }));
};

export const strategyTimed = (state) => {
  if (state.selectedIds.length >= 6) {
    return releaseAction(state);
  }
  return selectAction(state, chooseClusterCandidate(state));
};

export const strategyRandom = (state, context = {}) => {
  if (state.selectedIds.length >= 3) {
    return releaseAction(state);
  }
  const options = sameColorOptions(state);
  const rng = context.rng;
  if (!options.length) return null;
  const index = rng ? rng.int(0, options.length) : 0;
  return selectAction(state, options[index]);
};

export const STRATEGY_NAMES = Object.freeze([
  "random",
  "shortest-three",
  "shortest-five",
  "wait-six",
  "full-sweep",
  "idle-first-half",
  "forecast",
  "dense-detonation",
]);

export const STRATEGIES = Object.freeze({
  random: strategyRandom,
  "shortest-three": strategyThreeThenDetonate,
  "shortest-five": strategyFiveThenDetonate,
  "wait-six": strategyTimed,
  "full-sweep": strategyFullSweep,
  "idle-first-half": strategyIdleFirstHalf,
  forecast: strategyForecast,
  "dense-detonation": strategyGreedyCluster,
});

export const getStrategy = (name = "random") => STRATEGIES[name] ?? STRATEGIES.random;

export const createStrategyContext = (seed, name, rules = DEFAULT_RULES) => {
  const resolvedRules = mergeRules(rules);
  return {
    strategySeed: hashSeed(`${seed}:strategy:${name}`),
    rng: createRng(hashSeed(`${seed}:strategy:${name}`)),
    rules: resolvedRules,
  };
};

export default STRATEGIES;
