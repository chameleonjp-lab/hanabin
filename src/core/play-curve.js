// The play-curve bands describe the intended 60-second experience. They are
// analysis labels only; no gameplay decision reads them.
export const PLAY_CURVE_BANDS = Object.freeze([
  Object.freeze({ id: "opening", label: "0-10s", startTick: 0, endTick: 600 }),
  Object.freeze({ id: "discovery", label: "10-25s", startTick: 600, endTick: 1_500 }),
  Object.freeze({ id: "decision", label: "25-45s", startTick: 1_500, endTick: 2_700 }),
  Object.freeze({ id: "surge", label: "45-55s", startTick: 2_700, endTick: 3_300 }),
  Object.freeze({ id: "finale", label: "55-60s", startTick: 3_300, endTick: 3_600 }),
]);

const sampleRatios = Object.freeze([0.25, 0.5, 0.75]);

const sessionTickFor = (tick, maxTicks) => {
  const safeMaxTicks = Math.max(1, Number.isInteger(maxTicks) ? maxTicks : 3_600);
  if (!Number.isFinite(tick)) return null;
  return Math.min(safeMaxTicks - 1, Math.max(0, Math.trunc(tick)));
};

const bandIndexForTick = (tick, maxTicks) => {
  const sessionTick = sessionTickFor(tick, maxTicks);
  if (sessionTick === null) return -1;
  return PLAY_CURVE_BANDS.findIndex((band) =>
    sessionTick >= band.startTick && sessionTick < band.endTick,
  );
};

export const playCurveSampleTicks = (maxTicks = 3_600) => PLAY_CURVE_BANDS.flatMap((band) => {
  const safeEndTick = Math.min(band.endTick, Math.max(0, maxTicks));
  const safeStartTick = Math.min(band.startTick, safeEndTick);
  if (safeEndTick <= safeStartTick) return [];
  const span = safeEndTick - safeStartTick;
  return sampleRatios.map((ratio) => Math.min(
    safeEndTick - 1,
    safeStartTick + Math.floor(span * ratio),
  ));
});

const emptyBand = (band) => ({
  id: band.id,
  label: band.label,
  startTick: band.startTick,
  endTick: band.endTick,
  scoreGained: 0,
  detonations: 0,
  directTargets: 0,
  chainTargets: 0,
  maxChainGeneration: 0,
  maxCapturedTargets: 0,
  waveSpawns: 0,
  largestSelectableGroupSum: 0,
  largestSelectableGroupSamples: 0,
});

/**
 * Summarize a completed deterministic run by the five design-review bands.
 * Event ticks after the 60-second input boundary are attributed to the final
 * band because they are the resolution of the terminal player action.
 */
export const summarizePlayCurve = ({
  state,
  rules = {},
  choiceSamples = [],
  detonationTicks = [],
} = {}) => {
  const maxTicks = Number.isInteger(rules.maxTicks) ? rules.maxTicks : 3_600;
  const bands = PLAY_CURVE_BANDS.map(emptyBand);
  const actionTargetsByBand = PLAY_CURVE_BANDS.map(() => new Map());

  for (const wave of state?.waves ?? []) {
    const bandIndex = bandIndexForTick(wave.fireTick, maxTicks);
    if (bandIndex >= 0) bands[bandIndex].waveSpawns += 1;
  }

  for (const event of [...(state?.scoreEvents ?? []), ...(state?.bonusEvents ?? [])]) {
    const bandIndex = bandIndexForTick(event.fireTick, maxTicks);
    if (bandIndex < 0) continue;
    const band = bands[bandIndex];
    band.scoreGained += Number.isFinite(event.amount) ? event.amount : 0;
    if (event.kind === "direct" || event.kind === "chain") {
      if (event.kind === "direct") band.directTargets += 1;
      if (event.kind === "chain") {
        band.chainTargets += 1;
        band.maxChainGeneration = Math.max(band.maxChainGeneration, event.generation ?? 0);
      }
      const actionKey = String(event.actionId);
      const actionTargets = actionTargetsByBand[bandIndex];
      actionTargets.set(actionKey, (actionTargets.get(actionKey) ?? 0) + 1);
      band.maxCapturedTargets = Math.max(band.maxCapturedTargets, actionTargets.get(actionKey));
    }
  }

  for (const tick of detonationTicks) {
    const bandIndex = bandIndexForTick(tick, maxTicks);
    if (bandIndex >= 0) bands[bandIndex].detonations += 1;
  }

  for (const sample of choiceSamples) {
    const bandIndex = bandIndexForTick(sample.tick, maxTicks);
    if (bandIndex < 0 || !Number.isFinite(sample.largestSelectableGroup)) continue;
    bands[bandIndex].largestSelectableGroupSum += sample.largestSelectableGroup;
    bands[bandIndex].largestSelectableGroupSamples += 1;
  }

  return {
    bands,
    sampleTicksPerBand: sampleRatios.length,
    metricNotes: {
      largestSelectableGroup: "largest visible same-color connected group sampled at fixed quarter, midpoint, and three-quarter ticks",
      terminalResolution: "events after maxTicks are attributed to the final band",
    },
  };
};

export default summarizePlayCurve;
