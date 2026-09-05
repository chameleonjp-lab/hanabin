import { colorValue } from "./competitive-layer.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const easeOut = (value) => 1 - (1 - clamp(value, 0, 1)) ** 3;

export const CHAIN_MILESTONES = Object.freeze([5, 10, 20, 30]);

const hashText = (value) => {
  let hash = 2_166_136_261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const unit = (value) => hashText(value) / 4_294_967_296;

export const explosionVisualKey = (explosion) =>
  `${explosion?.actionId ?? "0"}:${explosion?.eventId ?? "0"}`;

export const scoreFeedbackKey = (event) =>
  `${event?.kind ?? "score"}:${event?.actionId ?? "0"}:${event?.eventId ?? "0"}`;

export const chainMilestoneFor = (chain) => {
  const value = Math.max(0, Math.trunc(finite(chain)));
  let result = 0;
  for (const milestone of CHAIN_MILESTONES) {
    if (value >= milestone) result = milestone;
  }
  return result;
};

/**
 * Decorative tiers make the player's contribution legible without changing
 * the explosion geometry used by the game rules. Color is paired with ring
 * shape/weight so the distinction survives muted color palettes and low
 * quality profiles.
 */
export const explosionPresentationFor = (explosion = {}) => {
  const direct = explosion.kind === "direct";
  const generation = Math.max(0, Math.trunc(finite(explosion.depth)));
  if (direct) {
    return {
      role: "direct",
      accentColor: "#f7fbff",
      ringAlpha: 0.86,
      lineWidthMultiplier: 1,
      innerRadiusScale: 0.58,
      accentRadiusScale: 0.88,
      accentRingAlpha: 0.52,
      accentLineWidthMultiplier: 1,
    };
  }
  if (generation >= 2) {
    return {
      role: "chain-deep",
      accentColor: "#ffd166",
      ringAlpha: 0.82,
      lineWidthMultiplier: 1.12,
      innerRadiusScale: 0.5,
      accentRadiusScale: 1.16,
      accentRingAlpha: 0.68,
      accentLineWidthMultiplier: 1.1,
    };
  }
  return {
    role: "chain",
    accentColor: "#79e6ff",
    ringAlpha: 0.7,
    lineWidthMultiplier: 0.9,
    innerRadiusScale: 0.52,
    accentRadiusScale: 0.76,
    accentRingAlpha: 0.5,
    accentLineWidthMultiplier: 0.9,
  };
};

/**
 * Higher chain milestones use more rings and a wider pulse. This is a visual
 * acknowledgement only; the milestone thresholds remain in CHAIN_MILESTONES.
 */
export const chainMilestonePresentationFor = (milestone) => {
  const value = Math.max(0, Math.trunc(finite(milestone)));
  if (value >= 30) {
    return {
      color: "#fff0a8",
      ringCount: 4,
      radiusScale: 1.24,
      lineWidthMultiplier: 1.2,
      fillAlpha: 0.3,
    };
  }
  if (value >= 20) {
    return {
      color: "#ffd166",
      ringCount: 3,
      radiusScale: 1.12,
      lineWidthMultiplier: 1.1,
      fillAlpha: 0.26,
    };
  }
  if (value >= 10) {
    return {
      color: "#ff9f68",
      ringCount: 2,
      radiusScale: 1.02,
      lineWidthMultiplier: 1,
      fillAlpha: 0.23,
    };
  }
  return {
    color: "#79e6ff",
    ringCount: 1,
    radiusScale: 0.94,
    lineWidthMultiplier: 0.92,
    fillAlpha: 0.2,
  };
};

export const spawnExplosionParticles = (pool, explosion, {
  profile,
  nowMs = 0,
  maxNew = Infinity,
} = {}) => {
  if (!pool || !explosion || !profile) return 0;
  const direct = explosion.kind === "direct";
  const requested = direct ? profile.particlesPerDirect : profile.particlesPerChain;
  const count = Math.max(0, Math.min(requested, Math.trunc(maxNew)));
  const color = colorValue(explosion.sourceColor ?? explosion.targetColor);
  const baseSpeed = direct ? 2_800 : 2_100;
  const motionScale = clamp(finite(profile.motionScale, 1), 0, 1);
  let spawned = 0;
  for (let index = 0; index < count; index += 1) {
    const angle = (unit(`${explosionVisualKey(explosion)}:angle:${index}`) * Math.PI * 2) +
      (direct ? 0 : finite(explosion.depth) * 0.08);
    const speed = baseSpeed * (0.55 + unit(`${explosionVisualKey(explosion)}:speed:${index}`) * 0.65);
    pool.spawn({
      x: explosion.originX,
      y: explosion.originY,
      vx: Math.cos(angle) * speed * motionScale,
      vy: Math.sin(angle) * speed * motionScale,
      gravity: (direct ? 480 : 350) * motionScale,
      size: direct ? 28 : 21,
      alpha: direct ? 0.92 : 0.72,
      color,
      kind: direct ? "direct-spark" : "chain-spark",
      lifeMs: direct ? 600 : 440,
    }, nowMs);
    spawned += 1;
  }
  return spawned;
};

const boardToCanvas = (x, y, width, height, boardWidth, boardHeight) => ({
  x: finite(x) * width / boardWidth,
  y: finite(y) * height / boardHeight,
});

const drawStarfield = (ctx, {
  width,
  height,
  count,
  seed = 1,
  tick = 0,
  animateTwinkle = true,
} = {}) => {
  if (!ctx || !count) return;
  ctx.save();
  ctx.fillStyle = "rgba(210, 231, 255, 0.52)";
  for (let index = 0; index < count; index += 1) {
    const x = unit(`${seed}:star:x:${index}`) * width;
    const y = unit(`${seed}:star:y:${index}`) * height;
    const baseAlpha = 0.45 + unit(`${seed}:star:t:${index}`) * 0.55;
    const size = 0.45 + unit(`${seed}:star:s:${index}`) * 1.3;
    ctx.globalAlpha = baseAlpha * (animateTwinkle === false
      ? 0.82
      : 0.82 + Math.sin((tick + index * 19) * 0.035) * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawAurora = (ctx, { width, height, tick = 0, alpha = 0 } = {}) => {
  if (!ctx || alpha <= 0 || typeof ctx.createRadialGradient !== "function") return;
  const phase = (finite(tick) % 720) / 720 * Math.PI * 2;
  const centers = [
    { x: width * (0.28 + Math.sin(phase) * 0.04), y: height * 0.28, color: "121, 230, 255" },
    { x: width * (0.72 + Math.cos(phase * 0.8) * 0.05), y: height * 0.46, color: "255, 113, 143" },
  ];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const center of centers) {
    const radius = Math.max(width, height) * 0.48;
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    gradient.addColorStop(0, `rgba(${center.color}, ${alpha})`);
    gradient.addColorStop(1, `rgba(${center.color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
};

const drawParticles = (ctx, pool, {
  width,
  height,
  boardWidth,
  boardHeight,
} = {}) => {
  if (!ctx || !pool) return;
  const scale = Math.min(width / boardWidth, height / boardHeight);
  pool.forEachActive((particle) => {
    const point = boardToCanvas(particle.x, particle.y, width, height, boardWidth, boardHeight);
    const remaining = clamp(1 - particle.ageMs / particle.lifeMs, 0, 1);
    ctx.globalAlpha = particle.alpha * remaining;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = Math.max(2, particle.size * scale * 1.6);
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(0.8, particle.size * scale * (0.4 + remaining * 0.6)), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.shadowBlur = 0;
};

const drawExplosionRings = (ctx, explosions, {
  width,
  height,
  boardWidth,
  boardHeight,
  tick,
  glowMultiplier = 1,
  secondaryRings = 0,
} = {}) => {
  const scale = Math.min(width / boardWidth, height / boardHeight);
  for (const explosion of explosions) {
    const duration = Math.max(1, finite(explosion.durationTicks, 1));
    const age = clamp((finite(tick) - finite(explosion.fireTick)) / duration, 0, 1);
    const point = boardToCanvas(
      explosion.originX,
      explosion.originY,
      width,
      height,
      boardWidth,
      boardHeight,
    );
    const radius = Math.max(3, finite(explosion.radius) * scale * (0.16 + easeOut(age) * 0.84));
    const color = colorValue(explosion.sourceColor ?? explosion.targetColor);
    const generation = Math.max(0, Math.trunc(finite(explosion.depth)));
    const presentation = explosionPresentationFor(explosion);
    const ringAlpha = (1 - age) * presentation.ringAlpha * glowMultiplier;
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(4, radius * 0.35) * glowMultiplier;
    ctx.lineWidth = Math.max(1.5, width / (explosion.kind === "direct" ? 500 : 720)) *
      presentation.lineWidthMultiplier;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = ringAlpha * (0.36 + Math.min(0.45, generation * 0.05));
    ctx.strokeStyle = presentation.accentColor;
    ctx.shadowColor = presentation.accentColor;
    ctx.lineWidth = Math.max(1, width / 1_050) * presentation.accentLineWidthMultiplier;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * presentation.innerRadiusScale, 0, Math.PI * 2);
    ctx.stroke();

    if (presentation.role === "chain-deep") {
      ctx.globalAlpha = ringAlpha * presentation.accentRingAlpha;
      ctx.lineWidth = Math.max(1, width / 1_180) * presentation.accentLineWidthMultiplier;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * presentation.accentRadiusScale, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    for (let ring = 0; ring < Math.max(0, Math.trunc(secondaryRings)); ring += 1) {
      ctx.globalAlpha = ringAlpha * (0.24 / (ring + 1));
      ctx.lineWidth = Math.max(0.8, width / 1_400);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * (0.72 + ring * 0.14), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
};

const drawDirectConstellation = (ctx, explosions, {
  width,
  height,
  boardWidth,
  boardHeight,
  alpha = 0.8,
} = {}) => {
  const groups = new Map();
  for (const explosion of explosions) {
    if (explosion.kind !== "direct") continue;
    const key = String(explosion.actionId ?? "0");
    const group = groups.get(key) ?? [];
    group.push(explosion);
    groups.set(key, group);
  }
  const paths = [...groups.values()]
    .map((group) => group.sort((left, right) => finite(left.eventId) - finite(right.eventId)))
    .filter((group) => group.length >= 2);
  if (!paths.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(194, 246, 255, 0.86)";
  ctx.shadowColor = "rgba(121, 230, 255, 0.9)";
  ctx.shadowBlur = 10;
  ctx.lineWidth = Math.max(1.2, width / 920);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const direct of paths) {
    ctx.beginPath();
    direct.forEach((explosion, index) => {
      const point = boardToCanvas(
        explosion.originX,
        explosion.originY,
        width,
        height,
        boardWidth,
        boardHeight,
      );
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.restore();
};

const drawMilestonePulses = (ctx, pulses, {
  width,
  height,
  boardWidth,
  boardHeight,
  nowMs = 0,
} = {}) => {
  const scale = Math.min(width / boardWidth, height / boardHeight);
  for (const pulse of pulses) {
    const age = clamp((finite(nowMs) - pulse.startedAtMs) / 850, 0, 1);
    const point = boardToCanvas(pulse.x, pulse.y, width, height, boardWidth, boardHeight);
    const presentation = chainMilestonePresentationFor(pulse.milestone);
    const radius = (160 + pulse.milestone * 18) * scale * presentation.radiusScale *
      (0.55 + age * 0.85);
    ctx.save();
    ctx.strokeStyle = presentation.color;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    for (let ring = 0; ring < presentation.ringCount; ring += 1) {
      const ringProgress = presentation.ringCount === 1
        ? 1
        : ring / (presentation.ringCount - 1);
      ctx.globalAlpha = (1 - age) * (ring === 0 ? 0.78 : 0.4 / (ring + 1));
      ctx.lineWidth = Math.max(1.5, width / 540) * presentation.lineWidthMultiplier *
        (ring === 0 ? 1 : 0.72);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * (0.82 + ringProgress * 0.24), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = (1 - age) * presentation.fillAlpha;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

const drawScoreFeedback = (ctx, feedback, {
  width,
  height,
  boardWidth,
  boardHeight,
  nowMs = 0,
  motionScale = 1,
} = {}) => {
  for (const item of feedback ?? []) {
    const age = clamp((finite(nowMs) - finite(item.startedAtMs)) / 850, 0, 1);
    const point = boardToCanvas(item.x, item.y, width, height, boardWidth, boardHeight);
    const lift = 34 * age * Math.max(0, finite(motionScale, 1));
    ctx.save();
    ctx.globalAlpha = (1 - age) * 0.96;
    ctx.fillStyle = item.forecast ? "#ffd166" : "#f7fbff";
    ctx.shadowColor = item.forecast ? "rgba(255, 209, 102, 0.9)" : "rgba(121, 230, 255, 0.9)";
    ctx.shadowBlur = 10;
    ctx.font = `800 ${Math.max(12, width / 72)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${Math.max(0, Math.trunc(finite(item.amount))).toLocaleString("ja-JP")}`, point.x, point.y - lift);
    ctx.restore();
  }
};

export const drawFireworkEffects = (ctx, {
  state,
  pool,
  width,
  height,
  boardWidth = 16_000,
  boardHeight = 9_000,
  profile,
  nowMs = 0,
  pulses = [],
  scoreFeedback = [],
} = {}) => {
  if (!ctx || !state || !profile) return;
  const activeExplosions = [...(state.activeExplosions ?? [])]
    .filter((explosion) => finite(explosion.endTick, 0) > finite(state.tick, 0));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawAurora(ctx, {
    width,
    height,
    tick: state.tick,
    alpha: profile.reducedMotion ? 0 : finite(profile.auroraAlpha),
  });
  drawStarfield(ctx, {
    width,
    height,
    count: profile.backgroundStars,
    seed: state.seed,
    tick: state.tick,
    animateTwinkle: profile.starTwinkle !== false,
  });
  drawParticles(ctx, pool, { width, height, boardWidth, boardHeight });
  drawDirectConstellation(ctx, activeExplosions, {
    width,
    height,
    boardWidth,
    boardHeight,
    alpha: profile.trailAlpha,
  });
  drawExplosionRings(ctx, activeExplosions, {
    width,
    height,
    boardWidth,
    boardHeight,
    tick: state.tick,
    glowMultiplier: profile.glowMultiplier,
    secondaryRings: profile.reducedMotion ? 0 : profile.secondaryRings,
  });
  if (profile.milestonePulses !== false) {
    drawMilestonePulses(ctx, pulses, {
      width,
      height,
      boardWidth,
      boardHeight,
      nowMs,
    });
  }
  ctx.restore();
  if (profile.scoreLabels !== false) {
    drawScoreFeedback(ctx, scoreFeedback, {
      width,
      height,
      boardWidth,
      boardHeight,
      nowMs,
      motionScale: profile.motionScale ?? 1,
    });
  }
};

export default drawFireworkEffects;
