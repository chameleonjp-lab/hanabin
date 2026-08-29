/**
 * M4's single source of truth for gameplay constants.
 *
 * The core uses an integer board and integer ticks.  This keeps outcomes
 * independent of display size and avoids making a renderer part of a replay.
 * Values that were intentionally left open in the design notes have a safe,
 * deterministic default here rather than being chosen at call sites.
 */

export const GAME_VERSION = "M4";
// Choice guarantees are part of the deterministic gameplay contract. Keep a
// new rule fingerprint so old replays and cached best scores cannot be mixed
// with runs that can receive a runtime choice reserve.
export const RULE_VERSION = "m4-gameplay-3";
export const INPUT_SCHEMA_VERSION = "m2-input-1";

export const COLORS = Object.freeze(["red", "blue", "green", "yellow"]);
export const COLOR_COUNT = COLORS.length;
export const BOARD_WIDTH = 16_000;
export const BOARD_HEIGHT = 9_000;
export const TICKS_PER_SECOND = 60;
export const TOTAL_TICKS = 3_600;
export const GAME_TICKS = TOTAL_TICKS;
export const DIRECT_SCORE = 100;
export const PREPARATION_SCORE_PER_EXTRA_SELECTION = 120;
export const PREPARATION_SCORE_CAP = 600;
export const CHAIN_SCORE_BASE = 150;
export const CHAIN_SCORE_GROWTH_PERCENT = 12;
export const CHAIN_SCORE_CAP = 600;
export const INCLUSION_SCORE_PER_EXTRA_TARGET = 40;
export const INCLUSION_SCORE_CAP = 800;
export const FORECAST_PLAN_SELECTION_COUNT = 5;
export const FORECAST_PLAN_BONUS = 1_000;
export const FORECAST_PLAN_LEAD_TICKS = 60;
export const FORECAST_CHAIN_PER_TARGET = 150;
export const SELECTION_HIT_RADIUS = 520;
// A run must always expose at least one complete extra choice beyond the
// three targets required for a detonation. The generator and runtime reserve
// use the same value so a disappearing wave cannot make the session stall.
export const MINIMUM_PLAYABLE_CHOICES = 4;
// Compatibility name retained for the existing score/event surface.
export const FORECAST_PLAN_CHAIN_BONUS_PER_TARGET = FORECAST_CHAIN_PER_TARGET;

export const WAVE_KINDS = Object.freeze([
  "intro",
  "fork",
  "bridge",
  "cross",
  "pressure",
  "finale",
]);

export const POSITIONS = Object.freeze(["left", "center", "right"]);

// Every interval is deliberately within the 120–240 tick review range.
// The sequence repeats by wave kind and therefore does not depend on render
// cadence.
export const WAVE_INTERVAL_TICKS = Object.freeze([180, 210, 150, 240, 120, 180]);

export const WAVE_DEFINITIONS = Object.freeze([
  Object.freeze({ kind: "intro", count: 5, primaryCount: 3, secondaryCount: 2 }),
  Object.freeze({ kind: "fork", count: 8, primaryCount: 3, secondaryCount: 5 }),
  Object.freeze({ kind: "bridge", count: 7, primaryCount: 7, secondaryCount: 0 }),
  Object.freeze({ kind: "cross", count: 6, primaryCount: 3, secondaryCount: 3 }),
  Object.freeze({ kind: "pressure", count: 4, primaryCount: 4, secondaryCount: 0 }),
  Object.freeze({ kind: "finale", count: 9, primaryCount: 7, secondaryCount: 2 }),
]);

const BASE_RULES = {
  gameVersion: GAME_VERSION,
  ruleVersion: RULE_VERSION,
  inputSchemaVersion: INPUT_SCHEMA_VERSION,

  // Fixed-point board coordinates used by every pure game operation.
  boardWidth: BOARD_WIDTH,
  boardHeight: BOARD_HEIGHT,
  board: {
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    minX: 0,
    maxX: 16_000,
    minY: 0,
    maxY: 9_000,
  },

  // 60 seconds at 60 Hz.  A replay records all frame inputs; it is not
  // allowed to silently skip or interpolate a tick.
  tickRate: TICKS_PER_SECOND,
  tickMs: 1000 / 60,
  maxTicks: TOTAL_TICKS,
  durationTicks: TOTAL_TICKS,
  sessionTicks: TOTAL_TICKS,
  waveIntervalTicks: WAVE_INTERVAL_TICKS,

  colorCount: COLOR_COUNT,
  colors: COLORS,

  // Selection requires three candidates and must remain held for three ticks
  // before a detonation is accepted.
  minimumSelection: 3,
  minSelection: 3,
  minimumPlayableChoices: MINIMUM_PLAYABLE_CHOICES,
  maximumSelection: 12,
  maxSelection: 12,
  selectionHoldTicks: 3,
  minHoldTicks: 3,
  selectionTimeoutTicks: 150,
  selectionMustBeVisible: true,
  selectionSameColor: true,

  // Chain propagation and queue bounds.  The 150 tick limit prevents an
  // accidental or adversarial chain from surviving beyond its limit.
  chainDistance: 1_800,
  explosionDistance: 1_800,
  selectionHitRadius: SELECTION_HIT_RADIUS,
  selectionLinkDistance: 5_140,
  baseExplosionRadius: 1_800,
  // Rendering is attached in M3, but duration is already deterministic so
  // the 3/4/5/6+ selection multiplier has a concrete core value.
  baseExplosionDurationTicks: 30,
  cooldownTicks: 9,
  sameColorRadius: 90,
  differentColorRadius: 78,
  minimumRadius: 55,
  sameColorRadiusRatio: 0.9,
  differentColorRadiusRatio: 0.78,
  minimumRadiusRatio: 0.55,
  selectionCountRadiusMultiplier: 1,
  selectionHoldRadiusMultiplier: 1,
  chainMaxTicks: 150,
  maxChainTicks: 150,
  maxActiveEntities: 128,
  activeEntityLimit: 128,
  maxPendingEntities: 256,
  pendingEntityLimit: 256,
  maxConcurrentExplosions: 256,
  concurrentExplosionLimit: 256,
  maxWaves: 32,
  maxPerWave: 16,
  maxRetries: 32,
  retryLimit: 32,
  maxInputFrames: 3_600,

  // Each generated candidate has a deterministic lifetime in this interval.
  lifetimeMinTicks: 240,
  lifetimeMaxTicks: 420,
  entityRadius: 140,
  visibleMargin: 0,

  // Provisional M2 score events. Radius attenuation is deliberately separate
  // from these values.
  directScore: DIRECT_SCORE,
  preparationScorePerExtraSelection: PREPARATION_SCORE_PER_EXTRA_SELECTION,
  preparationScoreCap: PREPARATION_SCORE_CAP,
  chainScoreBase: CHAIN_SCORE_BASE,
  chainScoreGrowthPercent: CHAIN_SCORE_GROWTH_PERCENT,
  chainScoreCap: CHAIN_SCORE_CAP,
  inclusionScorePerExtraTarget: INCLUSION_SCORE_PER_EXTRA_TARGET,
  inclusionScoreCap: INCLUSION_SCORE_CAP,
  forecastPlanSelectionCount: FORECAST_PLAN_SELECTION_COUNT,
  forecastPlanBonus: FORECAST_PLAN_BONUS,
  forecastPlanLeadTicks: FORECAST_PLAN_LEAD_TICKS,
  forecastChainPerTarget: FORECAST_CHAIN_PER_TARGET,
  forecastPlanChainBonusPerTarget: FORECAST_PLAN_CHAIN_BONUS_PER_TARGET,
  score: {
    direct: DIRECT_SCORE,
    preparationPerExtraSelection: PREPARATION_SCORE_PER_EXTRA_SELECTION,
    preparationCap: PREPARATION_SCORE_CAP,
    chainBase: CHAIN_SCORE_BASE,
    chainGrowthPercent: CHAIN_SCORE_GROWTH_PERCENT,
    chainCap: CHAIN_SCORE_CAP,
    inclusionPerExtraTarget: INCLUSION_SCORE_PER_EXTRA_TARGET,
    inclusionCap: INCLUSION_SCORE_CAP,
    forecastPlanSelectionCount: FORECAST_PLAN_SELECTION_COUNT,
    forecastPlanBonus: FORECAST_PLAN_BONUS,
    forecastPlanLeadTicks: FORECAST_PLAN_LEAD_TICKS,
    forecastChainPerTarget: FORECAST_CHAIN_PER_TARGET,
    forecastPlanChainBonusPerTarget: FORECAST_PLAN_CHAIN_BONUS_PER_TARGET,
  },
  scoreSameColor: 100,
  scoreDifferentColor: 100,
  sameColorScore: 100,
  differentColorScore: 100,
  detonationBonus: 0,
  comboBonus: 0,
  missPenalty: 0,

  // These are conservative queue safeguards, not visual limits.
  maxChainEvents: 1_024,
  maxScoreEvents: 1_024,
};

export const DEFAULT_RULES = Object.freeze({
  ...BASE_RULES,
  board: Object.freeze({ ...BASE_RULES.board }),
  colors: Object.freeze([...BASE_RULES.colors]),
  score: Object.freeze({ ...BASE_RULES.score }),
});
const RESOLVED_RULES = new WeakSet([DEFAULT_RULES]);

const finiteInteger = (value, fallback, { min = -Infinity, max = Infinity } = {}) => {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

/** Return a defensive, deterministic rules object for a game or simulation. */
export const mergeRules = (overrides = {}) => {
  if (overrides && typeof overrides === "object" && RESOLVED_RULES.has(overrides)) return overrides;
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const boardSource = source.board && typeof source.board === "object" ? source.board : {};
  // M2 replays have a fixed competitive coordinate/time contract. Balance
  // values may be overridden for simulations, but these fields may not.
  const boardWidth = BOARD_WIDTH;
  const boardHeight = BOARD_HEIGHT;
  const minSelection = finiteInteger(
    source.minimumSelection ?? source.minSelection,
    DEFAULT_RULES.minimumSelection,
    { min: 3, max: 32 },
  );
  const maxSelection = Math.max(
    minSelection,
    finiteInteger(source.maximumSelection ?? source.maxSelection, DEFAULT_RULES.maximumSelection, {
      min: 3,
      max: 64,
    }),
  );
  const maxPerWave = Math.max(
    minSelection,
    finiteInteger(source.maxPerWave, DEFAULT_RULES.maxPerWave, { min: 1, max: 16 }),
  );
  const minimumPlayableChoices = Math.max(
    minSelection,
    Math.min(
      maxPerWave,
      finiteInteger(
        source.minimumPlayableChoices,
        DEFAULT_RULES.minimumPlayableChoices,
        { min: 1, max: 16 },
      ),
    ),
  );
  const result = {
    ...DEFAULT_RULES,
    ...source,
    gameVersion: GAME_VERSION,
    ruleVersion: RULE_VERSION,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    boardWidth,
    boardHeight,
    board: {
      ...DEFAULT_RULES.board,
      ...boardSource,
      width: boardWidth,
      height: boardHeight,
      minX: 0,
      minY: 0,
      maxX: boardWidth,
      maxY: boardHeight,
    },
    colors: [...DEFAULT_RULES.colors],
    colorCount: COLOR_COUNT,
    minimumSelection: minSelection,
    minSelection,
    minimumPlayableChoices,
    maximumSelection: maxSelection,
    maxSelection,
    tickRate: 60,
    tickMs: 1000 / 60,
    maxTicks: TOTAL_TICKS,
    durationTicks: TOTAL_TICKS,
    sessionTicks: TOTAL_TICKS,
    waveIntervalTicks: Object.freeze([...WAVE_INTERVAL_TICKS]),
    selectionHoldTicks: finiteInteger(
      source.selectionHoldTicks ?? source.minHoldTicks,
      DEFAULT_RULES.selectionHoldTicks,
      { min: 3, max: 150 },
    ),
    minHoldTicks: finiteInteger(
      source.minHoldTicks ?? source.selectionHoldTicks,
      DEFAULT_RULES.minHoldTicks,
      { min: 3, max: 150 },
    ),
    selectionTimeoutTicks: finiteInteger(source.selectionTimeoutTicks, DEFAULT_RULES.selectionTimeoutTicks, {
      min: 3,
      max: 3_600,
    }),
    // 5,140 is the selection-link radius.  Explosion radius is a separate,
    // smaller value so choosing an object cannot silently become a chain hit.
    selectionLinkDistance: finiteInteger(
      source.selectionLinkDistance,
      DEFAULT_RULES.selectionLinkDistance,
      { min: 1, max: 16_000 },
    ),
    selectionHitRadius: finiteInteger(
      source.selectionHitRadius,
      DEFAULT_RULES.selectionHitRadius,
      { min: 1, max: 2_000 },
    ),
    baseExplosionRadius: finiteInteger(
      source.baseExplosionRadius,
      DEFAULT_RULES.baseExplosionRadius,
      { min: 1, max: 16_000 },
    ),
    baseExplosionDurationTicks: finiteInteger(
      source.baseExplosionDurationTicks,
      DEFAULT_RULES.baseExplosionDurationTicks,
      { min: 1, max: 150 },
    ),
    chainDistance: finiteInteger(source.chainDistance, DEFAULT_RULES.chainDistance, {
      min: 1,
      max: 16_000,
    }),
    explosionDistance: finiteInteger(source.explosionDistance, DEFAULT_RULES.explosionDistance, {
      min: 1,
      max: 16_000,
    }),
    cooldownTicks: finiteInteger(source.cooldownTicks, DEFAULT_RULES.cooldownTicks, { min: 0, max: 150 }),
    sameColorRadius: finiteInteger(source.sameColorRadius, DEFAULT_RULES.sameColorRadius, {
      min: 1,
      max: 100,
    }),
    differentColorRadius: finiteInteger(
      source.differentColorRadius,
      DEFAULT_RULES.differentColorRadius,
      { min: 1, max: 100 },
    ),
    minimumRadius: finiteInteger(source.minimumRadius, DEFAULT_RULES.minimumRadius, { min: 1, max: 100 }),
    selectionCountRadiusMultiplier: Number.isFinite(source.selectionCountRadiusMultiplier)
      ? source.selectionCountRadiusMultiplier
      : DEFAULT_RULES.selectionCountRadiusMultiplier,
    selectionHoldRadiusMultiplier: Number.isFinite(source.selectionHoldRadiusMultiplier)
      ? source.selectionHoldRadiusMultiplier
      : DEFAULT_RULES.selectionHoldRadiusMultiplier,
    chainMaxTicks: finiteInteger(source.chainMaxTicks ?? source.maxChainTicks, DEFAULT_RULES.chainMaxTicks, {
      min: 1,
      max: 150,
    }),
    maxChainTicks: finiteInteger(source.maxChainTicks ?? source.chainMaxTicks, DEFAULT_RULES.maxChainTicks, {
      min: 1,
      max: 150,
    }),
    maxActiveEntities: finiteInteger(source.maxActiveEntities, DEFAULT_RULES.maxActiveEntities, {
      min: 1,
      max: 128,
    }),
    maxPendingEntities: finiteInteger(source.maxPendingEntities, DEFAULT_RULES.maxPendingEntities, {
      min: 1,
      max: 256,
    }),
    maxConcurrentExplosions: finiteInteger(
      source.maxConcurrentExplosions,
      DEFAULT_RULES.maxConcurrentExplosions,
      { min: 1, max: 256 },
    ),
    maxWaves: finiteInteger(source.maxWaves, DEFAULT_RULES.maxWaves, { min: 1, max: 32 }),
    maxPerWave,
    maxRetries: finiteInteger(source.maxRetries, DEFAULT_RULES.maxRetries, { min: 1, max: 32 }),
    maxInputFrames: finiteInteger(source.maxInputFrames, DEFAULT_RULES.maxInputFrames, {
      min: 1,
      max: 3_600,
    }),
    lifetimeMinTicks: finiteInteger(source.lifetimeMinTicks, DEFAULT_RULES.lifetimeMinTicks, {
      min: 1,
      max: 420,
    }),
    lifetimeMaxTicks: finiteInteger(source.lifetimeMaxTicks, DEFAULT_RULES.lifetimeMaxTicks, {
      min: 1,
      max: 420,
    }),
    entityRadius: finiteInteger(source.entityRadius, DEFAULT_RULES.entityRadius, {
      min: 1,
      max: 2_000,
    }),
    scoreSameColor: finiteInteger(source.scoreSameColor ?? source.sameColorScore, DEFAULT_RULES.scoreSameColor, {
      min: 0,
      max: 1_000,
    }),
    sameColorScore: finiteInteger(source.sameColorScore ?? source.scoreSameColor, DEFAULT_RULES.sameColorScore, {
      min: 0,
      max: 1_000,
    }),
    scoreDifferentColor: finiteInteger(
      source.scoreDifferentColor ?? source.differentColorScore,
      DEFAULT_RULES.scoreDifferentColor,
      { min: 0, max: 1_000 },
    ),
    differentColorScore: finiteInteger(
      source.differentColorScore ?? source.scoreDifferentColor,
      DEFAULT_RULES.differentColorScore,
      { min: 0, max: 1_000 },
    ),
    detonationBonus: finiteInteger(source.detonationBonus, DEFAULT_RULES.detonationBonus, {
      min: 0,
      max: 1_000,
    }),
    comboBonus: finiteInteger(source.comboBonus, DEFAULT_RULES.comboBonus, { min: 0, max: 1_000 }),
    missPenalty: finiteInteger(source.missPenalty, DEFAULT_RULES.missPenalty, { min: 0, max: 1_000 }),
    forecastPlanSelectionCount: finiteInteger(
      source.forecastPlanSelectionCount,
      DEFAULT_RULES.forecastPlanSelectionCount,
      { min: DEFAULT_RULES.minimumSelection, max: DEFAULT_RULES.maximumSelection },
    ),
    forecastPlanBonus: finiteInteger(source.forecastPlanBonus, DEFAULT_RULES.forecastPlanBonus, {
      min: 0,
      max: 10_000,
    }),
    forecastPlanLeadTicks: finiteInteger(
      source.forecastPlanLeadTicks,
      DEFAULT_RULES.forecastPlanLeadTicks,
      { min: 1, max: 150 },
    ),
    forecastChainPerTarget: finiteInteger(
      source.forecastChainPerTarget ?? source.forecastPlanChainBonusPerTarget,
      DEFAULT_RULES.forecastChainPerTarget,
      { min: 0, max: 10_000 },
    ),
    forecastPlanChainBonusPerTarget: finiteInteger(
      source.forecastPlanChainBonusPerTarget ?? source.forecastChainPerTarget,
      DEFAULT_RULES.forecastPlanChainBonusPerTarget,
      { min: 0, max: 10_000 },
    ),
  };
  result.activeEntityLimit = result.maxActiveEntities;
  result.pendingEntityLimit = result.maxPendingEntities;
  result.concurrentExplosionLimit = result.maxConcurrentExplosions;
  result.retryLimit = result.maxRetries;
  result.forecastPlanChainBonusPerTarget = result.forecastChainPerTarget;
  result.score = Object.freeze({
    direct: result.directScore,
    preparationPerExtraSelection: result.preparationScorePerExtraSelection,
    preparationCap: result.preparationScoreCap,
    chainBase: result.chainScoreBase,
    chainGrowthPercent: result.chainScoreGrowthPercent,
    chainCap: result.chainScoreCap,
    inclusionPerExtraTarget: result.inclusionScorePerExtraTarget,
    inclusionCap: result.inclusionScoreCap,
    forecastPlanSelectionCount: result.forecastPlanSelectionCount,
    forecastPlanBonus: result.forecastPlanBonus,
    forecastPlanLeadTicks: result.forecastPlanLeadTicks,
    forecastChainPerTarget: result.forecastChainPerTarget,
    forecastPlanChainBonusPerTarget: result.forecastPlanChainBonusPerTarget,
  });
  if (result.lifetimeMaxTicks < result.lifetimeMinTicks) {
    result.lifetimeMaxTicks = result.lifetimeMinTicks;
  }
  result.board = Object.freeze({ ...result.board });
  result.colors = Object.freeze([...result.colors]);
  const resolved = Object.freeze(result);
  RESOLVED_RULES.add(resolved);
  return resolved;
};

export const getWaveDefinition = (indexOrKind) => {
  const index = typeof indexOrKind === "number"
    ? ((indexOrKind % WAVE_DEFINITIONS.length) + WAVE_DEFINITIONS.length) % WAVE_DEFINITIONS.length
    : -1;
  return (index >= 0
    ? WAVE_DEFINITIONS[index]
    : WAVE_DEFINITIONS.find((definition) => definition.kind === indexOrKind)) ?? WAVE_DEFINITIONS[0];
};

export const waveKindAt = (waveIndex) => WAVE_KINDS[
  ((waveIndex % WAVE_KINDS.length) + WAVE_KINDS.length) % WAVE_KINDS.length
];

export const wavePositionAt = (waveIndex) => POSITIONS[
  ((waveIndex % POSITIONS.length) + POSITIONS.length) % POSITIONS.length
];

export const waveTickAt = (waveIndex, rules = DEFAULT_RULES) =>
  (() => {
    const index = Math.max(0, Math.trunc(waveIndex));
    const intervals = rules.waveIntervalTicks ?? WAVE_INTERVAL_TICKS;
    let tick = 0;
    for (let offset = 0; offset < index; offset += 1) {
      tick += intervals[offset % intervals.length];
    }
    return tick;
  })();

export const selectionRadiusMultiplierPercent = (count) => {
  const value = Number.isFinite(count) ? Math.trunc(count) : 0;
  return Math.min(140, 100 + Math.max(0, value - 3) * 15);
};

export const selectionDurationMultiplierPercent = (count) => {
  const value = Number.isFinite(count) ? Math.trunc(count) : 0;
  if (value <= 4) return 100;
  return Math.min(115, 100 + (value - 3) * 5);
};

export const directExplosionRadiusForSelection = (count, rules = DEFAULT_RULES) =>
  Math.round(
    rules.baseExplosionRadius * selectionRadiusMultiplierPercent(count) / 100,
  );

export const scoreForColor = (sourceColor, targetColor, rules = DEFAULT_RULES) =>
  sourceColor === targetColor ? rules.sameColorScore : rules.differentColorScore;

const canonicalRuleValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalRuleValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalRuleValue(value[key])]),
    );
  }
  return value;
};

/**
 * Exact replay identity for every enumerable gameplay rule. Sorting keys
 * keeps the representation stable even when callers supply overrides in a
 * different property order.
 */
export const rulesFingerprint = (rules = DEFAULT_RULES) =>
  JSON.stringify(canonicalRuleValue(mergeRules(rules)));

export default DEFAULT_RULES;
