import {
  DEFAULT_RULES,
  getWaveDefinition,
  mergeRules,
  POSITIONS,
  WAVE_KINDS,
  waveKindAt,
  wavePositionAt,
  waveTickAt,
} from "../config/rules.js";
import { createRng, hashSeed } from "./rng.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundInt = (value) => Math.round(Number.isFinite(value) ? value : 0);

const layoutAnchor = (position, rules) => {
  const third = Math.round(rules.boardWidth / 3);
  if (position === "left") return third;
  if (position === "right") return third * 2;
  return Math.round(rules.boardWidth / 2);
};

const randomLifetime = (rng, rules) => rng.intInclusive(rules.lifetimeMinTicks, rules.lifetimeMaxTicks);

const entity = ({
  waveId,
  waveIndex,
  localIndex,
  color,
  x,
  y,
  vx = 0,
  vy = 0,
  depth,
  lifetime,
  layout,
  rules,
}) => {
  const safeX = clamp(roundInt(x), 0, rules.boardWidth);
  const safeY = clamp(roundInt(y), 0, rules.boardHeight);
  return {
    id: waveIndex * 100 + localIndex + 1,
    waveId,
    waveIndex,
    localIndex,
    color,
    x: safeX,
    y: safeY,
    baseX: safeX,
    baseY: safeY,
    vx: roundInt(vx),
    vy: roundInt(vy),
    depth: roundInt(depth),
    radius: rules.entityRadius,
    spawnTick: waveTickAt(waveIndex, rules),
    lifetimeTicks: lifetime,
    expiresTick: waveTickAt(waveIndex, rules) + lifetime,
    layout,
    visible: true,
    status: "active",
    scored: false,
  };
};

const makePlan = (seed, waveIndex, rules) => {
  const normalizedRules = mergeRules(rules);
  const safeWaveIndex = Math.max(0, Math.trunc(waveIndex));
  const kind = waveKindAt(safeWaveIndex);
  const definition = getWaveDefinition(kind);
  const rng = createRng(hashSeed(`${seed}:wave:${safeWaveIndex}`));
  const primaryColor = rng.int(0, normalizedRules.colorCount);
  let secondaryColor = rng.int(0, normalizedRules.colorCount - 1);
  if (secondaryColor >= primaryColor) secondaryColor += 1;
  const layout = wavePositionAt(safeWaveIndex);
  const waveId = `wave-${safeWaveIndex}`;
  return {
    waveId,
    waveIndex: safeWaveIndex,
    kind,
    primaryColor,
    mainColor: primaryColor,
    secondaryColor,
    order: safeWaveIndex + 1,
    sequence: safeWaveIndex + 1,
    position: layout,
    layout,
    fireTick: waveTickAt(safeWaveIndex, normalizedRules),
    count: Math.min(definition.count, normalizedRules.maxPerWave),
    definition,
    rng,
  };
};

export const createWavePlan = (seed, waveIndex, rules = DEFAULT_RULES) => {
  const plan = makePlan(seed, waveIndex, rules);
  const { rng, ...serializable } = plan;
  return serializable;
};

export const generateWave = (seedOrOptions, waveIndexArg, rulesArg) => {
  let seed = seedOrOptions;
  let waveIndex = waveIndexArg;
  let rules = rulesArg;
  if (seedOrOptions && typeof seedOrOptions === "object") {
    seed = seedOrOptions.seed;
    waveIndex = seedOrOptions.waveIndex ?? seedOrOptions.index ?? 0;
    rules = seedOrOptions.rules;
  }
  const normalizedRules = mergeRules(rules ?? DEFAULT_RULES);
  const plan = makePlan(seed ?? 1, waveIndex ?? 0, normalizedRules);
  const { rng } = plan;
  const anchorX = layoutAnchor(plan.layout, normalizedRules);
  const anchorY = Math.round(normalizedRules.boardHeight / 2);
  const spreadX = Math.round(normalizedRules.boardWidth * 0.055);
  const spreadY = Math.round(normalizedRules.boardHeight * 0.07);
  const fast = Math.round(normalizedRules.boardWidth / 110);
  const entities = [];
  const add = (args) => {
    if (entities.length >= normalizedRules.maxPerWave) return;
    entities.push(entity({
      ...args,
      waveId: plan.waveId,
      waveIndex: plan.waveIndex,
      localIndex: entities.length,
      layout: plan.layout,
      rules: normalizedRules,
      lifetime: randomLifetime(rng, normalizedRules),
    }));
  };

  switch (plan.kind) {
    case "intro": {
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX + (index - 1) * spreadX,
          y: anchorY + (index % 2 === 0 ? -spreadY : spreadY),
          depth: 600 + index * 20,
        });
      }
      for (let index = 0; index < 2; index += 1) {
        add({
          color: plan.secondaryColor,
          x: anchorX + (index === 0 ? -spreadX * 3 : spreadX * 3),
          y: anchorY + (index === 0 ? spreadY * 2 : -spreadY * 2),
          depth: 450 + index * 40,
        });
      }
      break;
    }
    case "fork": {
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX - spreadX * 2 + index * spreadX,
          y: anchorY - spreadY + index * Math.round(spreadY / 2),
          depth: 650 + index * 10,
        });
      }
      for (let index = 0; index < 5; index += 1) {
        add({
          color: plan.secondaryColor,
          x: anchorX + spreadX * 6 + index * spreadX,
          y: anchorY - spreadY * 3 + index * spreadY,
          depth: 300 + index * 15,
        });
      }
      break;
    }
    case "bridge": {
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX - spreadX * 5 + index * spreadX,
          y: anchorY - spreadY + (index % 2) * spreadY,
          depth: 600 + index * 12,
        });
      }
      add({
        color: plan.primaryColor,
        x: anchorX,
        y: anchorY + Math.round(spreadY / 4),
        depth: 900,
      });
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX + spreadX * 3 + index * spreadX,
          y: anchorY + spreadY - (index % 2) * spreadY,
          depth: 620 + index * 12,
        });
      }
      break;
    }
    case "cross": {
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX - spreadX * 5 - index * spreadX,
          y: anchorY - spreadY + index * spreadY,
          vx: fast,
          vy: Math.round(fast / 4),
          depth: 650 + index * 10,
        });
      }
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.secondaryColor,
          x: anchorX + spreadX * 5 + index * spreadX,
          y: anchorY + spreadY - index * spreadY,
          vx: -fast,
          vy: -Math.round(fast / 4),
          depth: 640 + index * 10,
        });
      }
      break;
    }
    case "pressure": {
      for (let index = 0; index < 4; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX + (index - 1.5) * spreadX,
          y: anchorY + (index % 2 === 0 ? -spreadY : spreadY),
          vx: (index % 2 === 0 ? 1 : -1) * fast * 2,
          vy: (index % 2 === 0 ? -1 : 1) * Math.round(fast / 2),
          depth: 700 + index * 20,
        });
      }
      break;
    }
    case "finale": {
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX - spreadX * 6 + index * spreadX,
          y: anchorY - spreadY + (index % 2) * spreadY,
          depth: 700 + index * 12,
        });
      }
      add({ color: plan.primaryColor, x: anchorX, y: anchorY, depth: 950 });
      for (let index = 0; index < 3; index += 1) {
        add({
          color: plan.primaryColor,
          x: anchorX + spreadX * 3 + index * spreadX,
          y: anchorY + spreadY - (index % 2) * spreadY,
          depth: 710 + index * 12,
        });
      }
      add({
        color: plan.secondaryColor,
        x: anchorX - spreadX * 4,
        y: anchorY + spreadY * 3,
        depth: 420,
      });
      add({
        color: plan.secondaryColor,
        x: anchorX + spreadX * 4,
        y: anchorY - spreadY * 3,
        depth: 430,
      });
      break;
    }
    default:
      break;
  }

  return {
    ...createWavePlan(seed ?? 1, plan.waveIndex, normalizedRules),
    entities,
  };
};

export const generateUpcomingWaves = (seed, nextWaveIndex, rules = DEFAULT_RULES, count = 2) => {
  const normalizedRules = mergeRules(rules);
  const limit = Math.min(normalizedRules.maxWaves, Math.max(0, Math.trunc(count)));
  const result = [];
  for (let offset = 0; offset < limit; offset += 1) {
    const waveIndex = Math.max(0, Math.trunc(nextWaveIndex) + offset);
    if (waveIndex >= normalizedRules.maxWaves) break;
    result.push(createWavePlan(seed, waveIndex, normalizedRules));
  }
  return result.map((plan) => ({
    waveId: plan.waveId,
    waveIndex: plan.waveIndex,
    kind: plan.kind,
    primaryColor: plan.primaryColor,
    mainColor: plan.primaryColor,
    order: plan.order,
    sequence: plan.sequence,
    position: plan.position,
    layout: plan.layout,
    fireTick: plan.fireTick,
  }));
};

export const waveKinds = () => [...WAVE_KINDS];
export const wavePositions = () => [...POSITIONS];

export default generateWave;
