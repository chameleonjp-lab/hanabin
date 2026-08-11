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

export const strategyIdle = () => null;

export const strategyIdleFirstHalf = (state) =>
  state.tick < 1_800 ? null : strategyFirstVisible(state);

export const strategyForecast = (state) => {
  const preferred = state.upcomingWaves?.[0]?.primaryColor;
  const preferredOptions = sameColorOptions(state).filter((entity) =>
    preferred === undefined || entity.color === preferred,
  );
  if (state.selectedIds.length >= 5) return releaseAction(state);
  return selectAction(
    state,
    bestBy(preferredOptions.length ? preferredOptions : sameColorOptions(state),
      (entity) => entity.depth * 10 - entity.id),
  );
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
  "wait-six",
  "full-sweep",
  "idle-first-half",
  "forecast",
  "dense-detonation",
]);

export const STRATEGIES = Object.freeze({
  random: strategyRandom,
  "shortest-three": strategyThreeThenDetonate,
  "wait-six": strategyTimed,
  "full-sweep": strategyFullSweep,
  "idle-first-half": strategyIdleFirstHalf,
  forecast: strategyForecast,
  "dense-detonation": strategyGreedyCluster,
});

export const getStrategy = (name = "random") => STRATEGIES[name] ?? STRATEGIES.random;

export const createStrategyContext = (seed, name) => ({
  strategySeed: hashSeed(`${seed}:strategy:${name}`),
  rng: createRng(hashSeed(`${seed}:strategy:${name}`)),
});

export default STRATEGIES;
