const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const inactiveIndex = (particles, cursor) => {
  for (let offset = 0; offset < particles.length; offset += 1) {
    const index = (cursor + offset) % particles.length;
    if (!particles[index].active) return index;
  }
  return cursor % particles.length;
};

/**
 * Fixed-capacity particle storage. Slots are reused instead of allocating a
 * new object for every spark, which keeps large chain reactions bounded.
 */
export class ParticlePool {
  constructor(capacity = 1_024) {
    this.capacity = Math.max(1, Math.trunc(finite(capacity, 1_024)));
    this.particles = Array.from({ length: this.capacity }, (_, index) => ({
      slot: index,
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      size: 0,
      alpha: 0,
      color: "#ffffff",
      kind: "spark",
      ageMs: 0,
      lifeMs: 1,
      bornAtMs: 0,
    }));
    this.cursor = 0;
    this.activeCount = 0;
  }

  reset() {
    for (const particle of this.particles) particle.active = false;
    this.cursor = 0;
    this.activeCount = 0;
  }

  spawn({
    x = 0,
    y = 0,
    vx = 0,
    vy = 0,
    gravity = 0,
    size = 20,
    alpha = 1,
    color = "#ffffff",
    kind = "spark",
    lifeMs = 500,
  } = {}, nowMs = 0) {
    const index = inactiveIndex(this.particles, this.cursor);
    const particle = this.particles[index];
    if (!particle.active) this.activeCount += 1;
    Object.assign(particle, {
      active: true,
      x: finite(x),
      y: finite(y),
      vx: finite(vx),
      vy: finite(vy),
      gravity: finite(gravity),
      size: Math.max(1, finite(size, 20)),
      alpha: Math.max(0, Math.min(1, finite(alpha, 1))),
      color: typeof color === "string" ? color : "#ffffff",
      kind: typeof kind === "string" ? kind : "spark",
      ageMs: 0,
      lifeMs: Math.max(1, finite(lifeMs, 500)),
      bornAtMs: finite(nowMs),
    });
    this.cursor = (index + 1) % this.particles.length;
    return particle;
  }

  update(deltaMs = 0) {
    const elapsed = Math.max(0, Math.min(250, finite(deltaMs)));
    const seconds = elapsed / 1_000;
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.ageMs += elapsed;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vy += particle.gravity * seconds;
      if (particle.ageMs >= particle.lifeMs) {
        particle.active = false;
        this.activeCount -= 1;
      }
    }
    return this.activeCount;
  }

  /** Immediately enforce a lowered presentation budget. */
  trim(maxActive = this.capacity) {
    const limit = Math.max(0, Math.min(this.capacity, Math.trunc(finite(maxActive, this.capacity))));
    if (this.activeCount <= limit) return this.activeCount;
    const oldest = this.particles
      .filter((particle) => particle.active)
      .sort((left, right) => left.bornAtMs - right.bornAtMs || left.slot - right.slot);
    for (const particle of oldest.slice(0, this.activeCount - limit)) {
      particle.active = false;
      this.activeCount -= 1;
    }
    return this.activeCount;
  }

  forEachActive(callback) {
    if (typeof callback !== "function") return;
    for (const particle of this.particles) {
      if (particle.active) callback(particle);
    }
  }

  snapshot() {
    return this.particles
      .filter((particle) => particle.active)
      .map((particle) => ({ ...particle }));
  }
}

export default ParticlePool;
