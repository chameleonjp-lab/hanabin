import { DEFAULT_RULES, mergeRules, waveTickAt } from "../config/rules.js";
import { createStrategyReplayLog } from "./input-frame.js";
import {
  advanceGame,
  applyAction,
  applyInputFrame,
  createGame,
  snapshotGame,
  validateGame,
} from "./engine.js";
import { normalizeSeed } from "./rng.js";
import {
  createStrategyContext,
  getStrategy,
  STRATEGY_NAMES,
} from "./strategies.js";
import { generateUpcomingWaves, generateWave } from "./wave-generator.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const distanceSquared = (left, right) =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2;

const forecastEvidence = (state) => {
  const directByAction = new Map();
  for (const event of state.scoreEvents ?? []) {
    if (event.kind !== "direct") continue;
    const key = String(event.actionId);
    if (!directByAction.has(key)) {
      directByAction.set(key, {
        tick: event.fireTick,
        color: event.sourceColor,
      });
    }
  }
  let matches = 0;
  for (const action of directByAction.values()) {
    const nextWave = (state.waves ?? []).find((wave) => wave.fireTick > action.tick);
    if (nextWave && nextWave.primaryColor === action.color) matches += 1;
  }
  const opportunities = directByAction.size;
  return {
    matches,
    opportunities,
    rate: opportunities ? matches / opportunities : 0,
  };
};

const waveHasSelectableGroup = (wave, rules) => {
  const byColor = Map.groupBy(wave.entities, (entity) => entity.color);
  const linkSquared = rules.selectionLinkDistance ** 2;
  for (const entities of byColor.values()) {
    if (entities.length < rules.minSelection) continue;
    const remaining = new Set(entities.map((entity) => entity.id));
    for (const start of entities) {
      if (!remaining.has(start.id)) continue;
      const queue = [start];
      remaining.delete(start.id);
      let componentSize = 0;
      while (queue.length) {
        const current = queue.shift();
        componentSize += 1;
        if (componentSize >= rules.minSelection) return true;
        for (const candidate of entities) {
          if (!remaining.has(candidate.id)) continue;
          if (distanceSquared(current, candidate) <= linkSquared) {
            remaining.delete(candidate.id);
            queue.push(candidate);
          }
        }
      }
    }
  }
  return false;
};

const inspectGeneratedSeed = (seed, rules) => {
  let unselectableWaves = 0;
  let exactOverlaps = 0;
  let forecastMismatches = 0;
  let generationRuleViolations = 0;
  let maxSelectableWaveGapTicks = 0;
  let lastSelectableTick = 0;
  let generatedWaves = 0;
  for (let waveIndex = 0;
    waveIndex < rules.maxWaves && waveTickAt(waveIndex, rules) < rules.maxTicks;
    waveIndex += 1) {
    const wave = generateWave(seed, waveIndex, rules);
    generatedWaves += 1;
    const ids = new Set();
    const positions = new Set();
    for (const entity of wave.entities) {
      if (ids.has(entity.id)) generationRuleViolations += 1;
      ids.add(entity.id);
      const positionKey = `${entity.x}:${entity.y}`;
      if (positions.has(positionKey)) exactOverlaps += 1;
      positions.add(positionKey);
      if (!Number.isInteger(entity.x) || !Number.isInteger(entity.y) ||
          entity.x < 0 || entity.x > rules.boardWidth ||
          entity.y < 0 || entity.y > rules.boardHeight ||
          entity.color < 0 || entity.color >= rules.colorCount ||
          entity.lifetimeTicks < rules.lifetimeMinTicks ||
          entity.lifetimeTicks > rules.lifetimeMaxTicks) {
        generationRuleViolations += 1;
      }
    }
    if (!wave.entities.length || wave.entities.length > rules.maxPerWave) {
      generationRuleViolations += 1;
    }
    const selectable = waveHasSelectableGroup(wave, rules);
    if (!selectable) {
      unselectableWaves += 1;
    } else {
      maxSelectableWaveGapTicks = Math.max(
        maxSelectableWaveGapTicks,
        wave.fireTick - lastSelectableTick,
      );
      lastSelectableTick = wave.fireTick;
    }
    const forecast = generateUpcomingWaves(seed, waveIndex, rules, 1)[0];
    if (!forecast || forecast.waveId !== wave.waveId ||
        forecast.primaryColor !== wave.primaryColor ||
        forecast.position !== wave.position || forecast.fireTick !== wave.fireTick) {
      forecastMismatches += 1;
    }
  }
  maxSelectableWaveGapTicks = Math.max(
    maxSelectableWaveGapTicks,
    rules.maxTicks - lastSelectableTick,
  );
  const before = JSON.stringify(generateWave(seed, 0, rules));
  const strategyContext = createStrategyContext(seed, "random");
  for (let index = 0; index < 32; index += 1) strategyContext.rng.nextUint32();
  const after = JSON.stringify(generateWave(seed, 0, rules));
  return {
    generatedWaves,
    unselectableWaves,
    exactOverlaps,
    forecastMismatches,
    generationRuleViolations,
    maxSelectableWaveGapTicks,
    strategyRngLeak: before === after ? 0 : 1,
  };
};

/** Run one deterministic strategy with at most one pointer acquisition frame per decision tick. */
export const runSimulation = (seedOrOptions = 1, optionsArg = {}) => {
  const options = seedOrOptions && typeof seedOrOptions === "object"
    ? seedOrOptions
    : { ...optionsArg, seed: seedOrOptions };
  const rules = mergeRules(options.rules ?? DEFAULT_RULES);
  const seed = normalizeSeed(options.seed ?? 1);
  const customStrategy = typeof options.strategy === "function";
  const strategyName = customStrategy
    ? (options.strategyName ?? "custom")
    : (typeof options.strategy === "string" ? options.strategy : "random");
  if (!customStrategy && !STRATEGY_NAMES.includes(strategyName)) {
    throw new RangeError(`unknown strategy: ${strategyName}`);
  }
  const strategy = customStrategy ? options.strategy : getStrategy(strategyName);
  const summaryOnly = options.summaryOnly === true;
  const decisionLimit = clamp(
    Number.isInteger(options.decisionLimit) ? options.decisionLimit : rules.maxTicks,
    0,
    rules.maxTicks,
  );
  const context = createStrategyContext(seed, strategyName, rules);
  const decisions = [];
  let decisionCount = 0;
  let frontHalfActionCount = 0;
  let continuationActionCount = 0;

  const state = createGame(seed, rules);

  // A replay has exactly one pressed+x+y frame for every session tick. The
  // first `decisionLimit` ticks are strategy-controlled; the remaining ticks
  // are explicit release/no-op frames rather than omitted input.
  for (let tick = 0; tick < rules.maxTicks; tick += 1) {
    if (state.simulationFault) break;
    if (state.tick < tick) advanceGame(state, tick, rules);
    if (state.simulationFault) break;
    let action = null;
    if (tick < decisionLimit) action = strategy(state, context);
    const frame = action
      ? { ...action, tick, actionId: state.actionCount }
      : { type: "noop", pressed: false, x: 0, y: 0, tick, actionId: state.actionCount };
    if (summaryOnly) {
      applyInputFrame(state, frame, { rules, record: false, trusted: !customStrategy });
    } else {
      applyAction(state, frame.type, frame, rules);
    }
    if (action) {
      decisionCount += 1;
      if (tick < Math.floor(rules.maxTicks / 2)) frontHalfActionCount += 1;
      else continuationActionCount += 1;
      if (!summaryOnly) decisions.push({ tick, type: frame.type, pressed: frame.pressed ?? false });
    }
  }

  if (!state.simulationFault && state.tick < rules.maxTicks) advanceGame(state, rules.maxTicks, rules);
  const snapshot = summaryOnly
    ? { stats: { ...state.stats }, tick: state.tick, score: state.score }
    : snapshotGame(state);
  const directScoreSum = (state.scoreEvents ?? [])
    .filter((event) => event.kind === "direct")
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const chainScoreSum = (state.scoreEvents ?? [])
    .filter((event) => event.kind === "chain")
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const forecastPlanBonusSum = (state.bonusEvents ?? [])
    .reduce((sum, event) => sum + (event.forecastPlanAmount ?? 0), 0);
  const forecastPlanCount = (state.bonusEvents ?? [])
    .filter((event) => (event.forecastPlanAmount ?? 0) > 0).length;
  const forecastChainBonusSum = (state.scoreEvents ?? [])
    .reduce((sum, event) => sum + (event.forecastPlanAmount ?? 0), 0);
  const forecastQualifiedTargets = (state.scoreEvents ?? [])
    .filter((event) => (event.forecastPlanAmount ?? 0) > 0).length;
  const forecast = forecastEvidence(state);
  const replay = summaryOnly || state.simulationFault
    ? null
    : createStrategyReplayLog({ seed, rules, frames: state.inputFrames });
  return {
    seed,
    strategy: strategyName,
    score: state.score,
    finalScore: state.finalScore ?? state.score,
    simulationFault: state.simulationFault,
    processedTicks: state.tick,
    decisionTicks: summaryOnly ? decisionCount : decisions.length,
    decisionLimit,
    strategyDecisionTicks: rules.maxTicks,
    inputFrames: state.inputFrames,
    decisions,
    replay,
    state: snapshot,
    invariantErrors: validateGame(state, rules),
    waveCounts: state.waves.reduce((counts, wave) => {
      counts[wave.kind] = (counts[wave.kind] ?? 0) + 1;
      return counts;
    }, {}),
    frontHalfIdleRatio: decisionLimit
      ? Math.max(0, 1 - frontHalfActionCount /
        Math.min(decisionLimit, Math.floor(rules.maxTicks / 2)))
      : 1,
    continuationRatio: decisionLimit
      ? continuationActionCount /
        Math.max(1, decisionLimit - Math.floor(rules.maxTicks / 2))
      : 0,
    forecastMatches: forecast.matches,
    forecastOpportunities: forecast.opportunities,
    forecastMatchRate: forecast.rate,
    directScoreSum,
    chainScoreSum,
    forecastPlanBonusSum,
    forecastPlanCount,
    forecastChainBonusSum,
    forecastQualifiedTargets,
    forecastScoreSum: forecastPlanBonusSum + forecastChainBonusSum,
  };
};

const addSummary = (summary, result) => {
  summary.processedSeeds += 1;
  summary.processedTicks += result.processedTicks;
  if (result.simulationFault) summary.faults += 1;
  if (result.invariantErrors.length) summary.invalidStates += 1;
  summary.scoreSum += result.score;
  summary.maxScore = Math.max(summary.maxScore, result.score);
  summary.minScore = Math.min(summary.minScore, result.score);
  summary.maxEntities = Math.max(summary.maxEntities, result.state.stats.maxActiveEntities);
  summary.maxChain = Math.max(summary.maxChain ?? 0, result.state.stats.maxChain ?? 0);
  summary.maxChainDurationTicks = Math.max(
    summary.maxChainDurationTicks ?? 0,
    result.state.stats.maxChainDurationTicks ?? 0,
  );
  summary.maxChainSum = (summary.maxChainSum ?? 0) + (result.state.stats.maxChain ?? 0);
  summary.directTargetsSum = (summary.directTargetsSum ?? 0) + (result.state.stats.directTargets ?? 0);
  summary.chainTargetsSum = (summary.chainTargetsSum ?? 0) + (result.state.stats.chainTargets ?? 0);
  summary.forecastMatchesSum = (summary.forecastMatchesSum ?? 0) + (result.forecastMatches ?? 0);
  summary.forecastOpportunitiesSum =
    (summary.forecastOpportunitiesSum ?? 0) + (result.forecastOpportunities ?? 0);
  summary.directScoreSum = (summary.directScoreSum ?? 0) + (result.directScoreSum ?? 0);
  summary.chainScoreSum = (summary.chainScoreSum ?? 0) + (result.chainScoreSum ?? 0);
  summary.forecastPlanBonusSum =
    (summary.forecastPlanBonusSum ?? 0) + (result.forecastPlanBonusSum ?? 0);
  summary.forecastPlanCountSum =
    (summary.forecastPlanCountSum ?? 0) + (result.forecastPlanCount ?? 0);
  summary.forecastChainBonusSum =
    (summary.forecastChainBonusSum ?? 0) + (result.forecastChainBonusSum ?? 0);
  summary.forecastQualifiedTargetsSum =
    (summary.forecastQualifiedTargetsSum ?? 0) + (result.forecastQualifiedTargets ?? 0);
  summary.forecastScoreSum =
    (summary.forecastScoreSum ?? 0) + (result.forecastScoreSum ?? 0);
  summary.detonationCountSum =
    (summary.detonationCountSum ?? 0) + (result.state.stats.detonationCount ?? 0);
  if (summary.scoreHistogram instanceof Map) {
    summary.scoreHistogram.set(result.score, (summary.scoreHistogram.get(result.score) ?? 0) + 1);
  }
  if (Number.isFinite(result.frontHalfIdleRatio)) {
    summary.frontHalfIdleRatioSum = (summary.frontHalfIdleRatioSum ?? 0) + result.frontHalfIdleRatio;
    summary.continuationRatioSum = (summary.continuationRatioSum ?? 0) + (result.continuationRatio ?? 0);
  }
  for (const [kind, count] of Object.entries(result.waveCounts ?? {})) {
    summary.waveCounts[kind] = (summary.waveCounts[kind] ?? 0) + count;
  }
};

/**
 * O(1)-memory 10,000-seed safety run. It advances each seed through every
 * session tick in one derived-tick pass and retains only aggregate evidence.
 */
export const runSafetySweep = (options = {}) => {
  const rules = mergeRules(options.rules ?? DEFAULT_RULES);
  const seedCount = Number.isInteger(options.seedCount) ? options.seedCount : 10_000;
  const startSeed = Number.isInteger(options.startSeed) ? options.startSeed : 0;
  const summary = {
    kind: "safety",
    requestedSeeds: seedCount,
    processedSeeds: 0,
    processedTicks: 0,
    faults: 0,
    invalidStates: 0,
    nondeterministicSeeds: 0,
    scoreSum: 0,
    minScore: Number.POSITIVE_INFINITY,
    maxScore: 0,
    maxEntities: 0,
    maxChain: 0,
    maxChainDurationTicks: 0,
    maxChainSum: 0,
    directTargetsSum: 0,
    chainTargetsSum: 0,
    forecastMatchesSum: 0,
    forecastOpportunitiesSum: 0,
    directScoreSum: 0,
    chainScoreSum: 0,
    forecastPlanBonusSum: 0,
    forecastPlanCountSum: 0,
    forecastChainBonusSum: 0,
    forecastQualifiedTargetsSum: 0,
    forecastScoreSum: 0,
    detonationCountSum: 0,
    frontHalfIdleRatioSum: 0,
    continuationRatioSum: 0,
    waveCounts: {},
    maxTicksPerSeed: rules.maxTicks,
    strategyRngSeparated: true,
    generatedWavesInspected: 0,
    unselectableWaves: 0,
    unselectableSeeds: 0,
    exactOverlapViolations: 0,
    forecastMismatches: 0,
    generationRuleViolations: 0,
    strategyRngLeaks: 0,
    maxSelectableWaveGapTicks: 0,
  };
  for (let offset = 0; offset < Math.max(0, seedCount); offset += 1) {
    const seed = startSeed + offset;
    const first = createGame(seed, rules);
    advanceGame(first, rules.maxTicks, rules);
    const firstErrors = validateGame(first, rules);
    const firstSnapshot = snapshotGame(first);
    const second = createGame(seed, rules);
    advanceGame(second, rules.maxTicks, rules);
    const secondSnapshot = snapshotGame(second);
    const result = {
      score: first.score,
      simulationFault: first.simulationFault,
      processedTicks: first.tick,
      invariantErrors: firstErrors,
      state: firstSnapshot,
      waveCounts: first.waves.reduce((counts, wave) => {
        counts[wave.kind] = (counts[wave.kind] ?? 0) + 1;
        return counts;
      }, {}),
    };
    addSummary(summary, result);
    if (JSON.stringify(firstSnapshot) !== JSON.stringify(secondSnapshot)) summary.nondeterministicSeeds += 1;
    const generation = inspectGeneratedSeed(seed, rules);
    summary.generatedWavesInspected += generation.generatedWaves;
    summary.unselectableWaves += generation.unselectableWaves;
    if (generation.unselectableWaves) summary.unselectableSeeds += 1;
    summary.exactOverlapViolations += generation.exactOverlaps;
    summary.forecastMismatches += generation.forecastMismatches;
    summary.generationRuleViolations += generation.generationRuleViolations;
    summary.strategyRngLeaks += generation.strategyRngLeak;
    summary.maxSelectableWaveGapTicks = Math.max(
      summary.maxSelectableWaveGapTicks,
      generation.maxSelectableWaveGapTicks,
    );
  }
  if (summary.minScore === Number.POSITIVE_INFINITY) summary.minScore = 0;
  summary.strategyRngSeparated = summary.strategyRngLeaks === 0;
  summary.ok = summary.faults === 0 && summary.invalidStates === 0 && summary.nondeterministicSeeds === 0 &&
    summary.unselectableWaves === 0 && summary.exactOverlapViolations === 0 &&
    summary.forecastMismatches === 0 && summary.generationRuleViolations === 0 &&
    summary.strategyRngLeaks === 0 &&
    summary.processedSeeds === Math.max(0, seedCount);
  return summary;
};

/** Compare every deterministic strategy without retaining individual results. */
export const compareStrategies = (options = {}) => {
  const rules = mergeRules(options.rules ?? DEFAULT_RULES);
  const seedCount = Number.isInteger(options.seedCount) ? options.seedCount : 1_000;
  const startSeed = Number.isInteger(options.startSeed) ? options.startSeed : 0;
  const names = Array.isArray(options.strategies) && options.strategies.length
    ? options.strategies.filter((name) => STRATEGY_NAMES.includes(name))
    : [...STRATEGY_NAMES];
  const byStrategy = Object.fromEntries(names.map((name) => [name, {
    strategy: name,
    processedSeeds: 0,
    processedTicks: 0,
    faults: 0,
    invalidStates: 0,
    scoreSum: 0,
    minScore: Number.POSITIVE_INFINITY,
    maxScore: 0,
    maxEntities: 0,
    maxChain: 0,
    maxChainDurationTicks: 0,
    maxChainSum: 0,
    directTargetsSum: 0,
    chainTargetsSum: 0,
    forecastMatchesSum: 0,
    forecastOpportunitiesSum: 0,
    directScoreSum: 0,
    chainScoreSum: 0,
    forecastPlanBonusSum: 0,
    forecastPlanCountSum: 0,
    forecastChainBonusSum: 0,
    forecastQualifiedTargetsSum: 0,
    forecastScoreSum: 0,
    detonationCountSum: 0,
    frontHalfIdleRatioSum: 0,
    continuationRatioSum: 0,
    waveCounts: {},
    scoreHistogram: new Map(),
  }]));
  for (let offset = 0; offset < Math.max(0, seedCount); offset += 1) {
    for (const name of names) {
      const result = runSimulation(startSeed + offset, {
        strategy: name,
        rules,
        summaryOnly: true,
      });
      addSummary(byStrategy[name], result);
    }
  }
  for (const summary of Object.values(byStrategy)) {
    summary.averageScore = summary.processedSeeds ? summary.scoreSum / summary.processedSeeds : 0;
    summary.frontHalfIdleRatio = summary.processedSeeds
      ? summary.frontHalfIdleRatioSum / summary.processedSeeds
      : 0;
    summary.continuationRatio = summary.processedSeeds
      ? summary.continuationRatioSum / summary.processedSeeds
      : 0;
    summary.averageMaxChain = summary.processedSeeds
      ? summary.maxChainSum / summary.processedSeeds
      : 0;
    summary.averageDirectTargets = summary.processedSeeds
      ? summary.directTargetsSum / summary.processedSeeds
      : 0;
    summary.averageChainTargets = summary.processedSeeds
      ? summary.chainTargetsSum / summary.processedSeeds
      : 0;
    summary.averageForecastMatches = summary.processedSeeds
      ? summary.forecastMatchesSum / summary.processedSeeds
      : 0;
    summary.averageForecastOpportunities = summary.processedSeeds
      ? summary.forecastOpportunitiesSum / summary.processedSeeds
      : 0;
    summary.forecastMatchRate = summary.forecastOpportunitiesSum
      ? summary.forecastMatchesSum / summary.forecastOpportunitiesSum
      : 0;
    summary.averageDirectScore = summary.processedSeeds
      ? summary.directScoreSum / summary.processedSeeds
      : 0;
    summary.averageChainScore = summary.processedSeeds
      ? summary.chainScoreSum / summary.processedSeeds
      : 0;
    summary.averageForecastPlanBonus = summary.processedSeeds
      ? summary.forecastPlanBonusSum / summary.processedSeeds
      : 0;
    summary.averageForecastPlanCount = summary.processedSeeds
      ? summary.forecastPlanCountSum / summary.processedSeeds
      : 0;
    summary.averageForecastChainBonus = summary.processedSeeds
      ? summary.forecastChainBonusSum / summary.processedSeeds
      : 0;
    summary.averageForecastQualifiedTargets = summary.processedSeeds
      ? summary.forecastQualifiedTargetsSum / summary.processedSeeds
      : 0;
    summary.averageForecastScore = summary.processedSeeds
      ? summary.forecastScoreSum / summary.processedSeeds
      : 0;
    summary.forecastScoreRatio = summary.scoreSum
      ? summary.forecastScoreSum / summary.scoreSum
      : 0;
    summary.averageDetonations = summary.processedSeeds
      ? summary.detonationCountSum / summary.processedSeeds
      : 0;
    summary.chainScoreRatio = summary.scoreSum
      ? summary.chainScoreSum / summary.scoreSum
      : 0;
    const histogram = [...summary.scoreHistogram.entries()].sort((left, right) => left[0] - right[0]);
    const percentile = (ratio) => {
      if (!summary.processedSeeds) return 0;
      const rank = Math.floor((summary.processedSeeds - 1) * ratio);
      let seen = 0;
      for (const [score, count] of histogram) {
        seen += count;
        if (seen > rank) return score;
      }
      return histogram.at(-1)?.[0] ?? 0;
    };
    summary.medianScore = percentile(0.5);
    summary.p10Score = percentile(0.1);
    summary.p90Score = percentile(0.9);
    if (summary.minScore === Number.POSITIVE_INFINITY) summary.minScore = 0;
    summary.ok = summary.faults === 0 && summary.invalidStates === 0;
    delete summary.scoreHistogram;
  }
  const winner = [...Object.values(byStrategy)].sort((left, right) =>
    right.averageScore - left.averageScore || left.strategy.localeCompare(right.strategy),
  )[0]?.strategy ?? null;
  return {
    kind: "comparison",
    requestedSeeds: seedCount,
    seedCount: seedCount,
    strategyCount: names.length,
    processedSeeds: Math.max(0, seedCount),
    strategies: names,
    byStrategy,
    processedRuns: Math.max(0, seedCount) * names.length,
    winner,
    ok: Object.values(byStrategy).every((summary) => summary.ok),
  };
};

/** Compatibility wrapper around the real generated-game safety sweep. */
export const runSafetyInspection = (options = {}) => {
  const caseCount = Number.isInteger(options.caseCount) ? options.caseCount : 10_000;
  const summary = runSafetySweep({
    ...options,
    seedCount: caseCount,
    startSeed: options.startSeed ?? 0,
  });
  return {
    caseCount,
    failed: summary.faults + summary.invalidStates + summary.nondeterministicSeeds,
    ok: summary.ok,
    processedSeeds: summary.processedSeeds,
    processedTicks: summary.processedTicks,
    maxTicks: summary.maxTicksPerSeed,
  };
};

export const simulate = runSimulation;
export const safetySweep = runSafetySweep;
export const compare = compareStrategies;

export default runSimulation;
