import {
  CHAIN_MILESTONES,
  drawFireworkEffects,
  spawnExplosionParticles,
  explosionVisualKey,
  scoreFeedbackKey,
} from "./firework-effects.js";
import { ParticlePool } from "./particle-pool.js";
import { QualityController } from "./quality-controller.js";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * Owns only visual state. The game state is read but never mutated; the
 * renderer keeps its own particle and milestone records outside replay data.
 */
export class DecorativeLayer {
  constructor({ qualityController = new QualityController(), capacity = 1_024 } = {}) {
    this.qualityController = qualityController;
    this.pool = new ParticlePool(Math.max(capacity, qualityController.profile.particleCapacity));
    this.stateReference = null;
    this.lastTick = -1;
    this.lastNowMs = null;
    this.processedExplosions = new Set();
    this.pulses = [];
    this.processedScoreEvents = new Set();
    this.scoreFeedback = [];
    this.previousMaxChain = 0;
  }

  reset() {
    this.pool.reset();
    this.stateReference = null;
    this.lastTick = -1;
    this.lastNowMs = null;
    this.processedExplosions.clear();
    this.pulses.length = 0;
    this.processedScoreEvents.clear();
    this.scoreFeedback.length = 0;
    this.previousMaxChain = 0;
  }

  syncState(state) {
    if (this.stateReference !== state || finite(state?.tick, 0) < this.lastTick) {
      this.reset();
      this.stateReference = state;
    }
  }

  rememberMilestones(state, nowMs) {
    const maxChain = Math.max(0, Math.trunc(finite(state?.stats?.maxChain)));
    if (maxChain > this.previousMaxChain) {
      const crossed = CHAIN_MILESTONES.filter((milestone) =>
        this.previousMaxChain < milestone && milestone <= maxChain,
      );
      if (crossed.length) {
        const origin = [...(state.activeExplosions ?? [])].at(-1) ?? {};
        for (const milestone of crossed) {
          this.pulses.push({
            milestone,
            startedAtMs: nowMs,
            x: finite(origin.originX, 8_000),
            y: finite(origin.originY, 4_500),
          });
        }
      }
      this.previousMaxChain = maxChain;
    }
    this.pulses = this.pulses.filter((pulse) => nowMs - pulse.startedAtMs < 900);
  }

  startNewExplosions(state, nowMs) {
    const profile = this.qualityController.profile;
    const budget = Math.max(0, profile.particleCapacity - this.pool.activeCount);
    let remaining = budget;
    for (const explosion of state.activeExplosions ?? []) {
      const key = explosionVisualKey(explosion);
      if (this.processedExplosions.has(key) || finite(explosion.fireTick) > finite(state.tick)) continue;
      this.processedExplosions.add(key);
      if (remaining <= 0) continue;
      const spawned = spawnExplosionParticles(this.pool, explosion, {
        profile,
        nowMs,
        maxNew: remaining,
      });
      remaining -= spawned;
    }
    if (this.processedExplosions.size > 2_048) {
      const activeKeys = new Set((state.activeExplosions ?? []).map(explosionVisualKey));
      this.processedExplosions = new Set(
        [...this.processedExplosions].filter((key) => activeKeys.has(key)),
      );
    }
  }

  rememberScoreFeedback(state, nowMs) {
    const profile = this.qualityController.profile;
    const groups = new Map();
    const entities = new Map((state.fireworks ?? []).map((entity) => [String(entity.id), entity]));
    const events = [
      ...(state.scoreEvents ?? []),
      ...(state.bonusEvents ?? []),
    ];
    for (const event of events) {
      const eventKey = scoreFeedbackKey(event);
      if (this.processedScoreEvents.has(eventKey)) continue;
      this.processedScoreEvents.add(eventKey);
      const amount = Math.max(0, Math.trunc(finite(event.amount)));
      if (amount <= 0) continue;
      const groupKey = `${event.actionId ?? "0"}:${event.fireTick ?? state.tick ?? "0"}`;
      const target = entities.get(String(event.targetId));
      const fallback = (state.activeExplosions ?? []).find((explosion) =>
        String(explosion.actionId) === String(event.actionId));
      const group = groups.get(groupKey) ?? {
        key: groupKey,
        amount: 0,
        xTotal: 0,
        yTotal: 0,
        positions: 0,
        forecast: false,
      };
      group.amount += amount;
      group.forecast ||= finite(event.forecastPlanAmount) > 0;
      const x = finite(target?.x ?? fallback?.originX, Number.NaN);
      const y = finite(target?.y ?? fallback?.originY, Number.NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        group.xTotal += x;
        group.yTotal += y;
        group.positions += 1;
      }
      groups.set(groupKey, group);
    }
    for (const group of groups.values()) {
      this.scoreFeedback.push({
        key: group.key,
        amount: group.amount,
        x: group.positions ? group.xTotal / group.positions : 8_000,
        y: group.positions ? group.yTotal / group.positions : 4_500,
        forecast: group.forecast,
        startedAtMs: nowMs,
      });
    }
    const lifetime = profile.reducedMotion ? 560 : 900;
    const labelLimit = Math.max(0, Math.trunc(profile.scoreLabelLimit ?? 12));
    this.scoreFeedback = labelLimit > 0
      ? this.scoreFeedback
        .filter((item) => nowMs - item.startedAtMs < lifetime)
        .slice(-labelLimit)
      : [];
    if (this.processedScoreEvents.size > 2_048) {
      const activeKeys = new Set(events.slice(-512).map(scoreFeedbackKey));
      this.processedScoreEvents = new Set(
        [...this.processedScoreEvents].filter((key) => activeKeys.has(key)),
      );
    }
  }

  render(ctx, {
    state,
    width,
    height,
    boardWidth,
    boardHeight,
    nowMs = 0,
  } = {}) {
    if (!state) {
      this.reset();
      return;
    }
    const currentNow = finite(nowMs);
    this.syncState(state);
    const deltaMs = this.lastNowMs === null ? 0 : Math.max(0, Math.min(250, currentNow - this.lastNowMs));
    this.lastNowMs = currentNow;
    this.pool.update(deltaMs);
    // Auto quality, reduced motion, or a pointer-capability change can lower
    // the budget while particles are alive. Enforce the new ceiling now.
    this.pool.trim(this.qualityController.profile.particleCapacity);
    this.startNewExplosions(state, currentNow);
    this.rememberMilestones(state, currentNow);
    this.rememberScoreFeedback(state, currentNow);
    drawFireworkEffects(ctx, {
      state,
      pool: this.pool,
      width,
      height,
      boardWidth,
      boardHeight,
      profile: this.qualityController.profile,
      nowMs: currentNow,
      pulses: this.pulses,
      scoreFeedback: this.scoreFeedback,
    });
    this.lastTick = finite(state.tick, 0);
  }
}

export default DecorativeLayer;
