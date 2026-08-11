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

export const chainMilestoneFor = (chain) => {
  const value = Math.max(0, Math.trunc(finite(chain)));
  let result = 0;
  for (const milestone of CHAIN_MILESTONES) {
    if (value >= milestone) result = milestone;
  }
  return result;
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
  let spawned = 0;
  for (let index = 0; index < count; index += 1) {
    const angle = (unit(`${explosionVisualKey(explosion)}:angle:${index}`) * Math.PI * 2) +
      (direct ? 0 : finite(explosion.depth) * 0.08);
    const speed = baseSpeed * (0.55 + unit(`${explosionVisualKey(explosion)}:speed:${index}`) * 0.65);
    pool.spawn({
      x: explosion.originX,
      y: explosion.originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: direct ? 480 : 350,
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

const drawStarfield = (ctx, { width, height, count, seed = 1, tick = 0 } = {}) => {
  if (!ctx || !count) return;
  ctx.save();
  ctx.fillStyle = "rgba(210, 231, 255, 0.52)";
  for (let index = 0; index < count; index += 1) {
    const x = unit(`${seed}:star:x:${index}`) * width;
    const y = unit(`${seed}:star:y:${index}`) * height;
    const twinkle = 0.45 + unit(`${seed}:star:t:${index}`) * 0.55;
    const size = 0.45 + unit(`${seed}:star:s:${index}`) * 1.3;
    ctx.globalAlpha = twinkle * (0.82 + Math.sin((tick + index * 19) * 0.035) * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
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
    const ringAlpha = (1 - age) * (explosion.kind === "direct" ? 0.86 : 0.68) * glowMultiplier;
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(4, radius * 0.35) * glowMultiplier;
    ctx.lineWidth = Math.max(1.5, width / (explosion.kind === "direct" ? 500 : 720));
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = ringAlpha * (0.36 + Math.min(0.45, generation * 0.05));
    ctx.lineWidth = Math.max(1, width / 1_050);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * (0.58 + generation * 0.018), 0, Math.PI * 2);
    ctx.stroke();
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
    const radius = (160 + pulse.milestone * 18) * scale * (0.55 + age * 0.85);
    ctx.save();
    ctx.globalAlpha = (1 - age) * 0.78;
    ctx.strokeStyle = pulse.milestone >= 20 ? "#ffd166" : "#79e6ff";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.lineWidth = Math.max(1.5, width / 540);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = (1 - age) * 0.22;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
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
} = {}) => {
  if (!ctx || !state || !profile) return;
  const activeExplosions = [...(state.activeExplosions ?? [])]
    .filter((explosion) => finite(explosion.endTick, 0) > finite(state.tick, 0));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawStarfield(ctx, {
    width,
    height,
    count: profile.backgroundStars,
    seed: state.seed,
    tick: state.tick,
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
  });
  drawMilestonePulses(ctx, pulses, {
    width,
    height,
    boardWidth,
    boardHeight,
    nowMs,
  });
  ctx.restore();
};

export default drawFireworkEffects;
