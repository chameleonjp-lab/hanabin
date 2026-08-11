const QUALITY_LEVELS = Object.freeze(["low", "medium", "high"]);

export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    level: "low",
    resolutionScale: 0.78,
    backgroundStars: 14,
    particlesPerDirect: 8,
    particlesPerChain: 5,
    particleCapacity: 320,
    trailAlpha: 0.48,
    glowMultiplier: 0.62,
  }),
  medium: Object.freeze({
    level: "medium",
    resolutionScale: 0.9,
    backgroundStars: 24,
    particlesPerDirect: 16,
    particlesPerChain: 10,
    particleCapacity: 640,
    trailAlpha: 0.64,
    glowMultiplier: 0.82,
  }),
  high: Object.freeze({
    level: "high",
    resolutionScale: 1,
    backgroundStars: 36,
    particlesPerDirect: 28,
    particlesPerChain: 18,
    particleCapacity: 1_024,
    trailAlpha: 0.82,
    glowMultiplier: 1,
  }),
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const profileFor = (level) => QUALITY_PROFILES[QUALITY_LEVELS.includes(level) ? level : "high"];

/**
 * Controls decoration only.  It never receives or changes a game state and
 * therefore cannot affect score, input replay, or fixed-tick simulation.
 */
export class QualityController {
  constructor({ initial = "high", auto = true, sampleWindow = 30 } = {}) {
    this.level = QUALITY_LEVELS.includes(initial) ? initial : "high";
    this.auto = auto !== false;
    this.sampleWindow = Math.max(5, Math.trunc(finite(sampleWindow, 30)));
    this.samples = [];
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  get profile() {
    return profileFor(this.level);
  }

  setQuality(level) {
    const next = QUALITY_LEVELS.includes(level) ? level : this.level;
    const changed = next !== this.level;
    this.level = next;
    this.samples.length = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    return changed;
  }

  observe(frameMs) {
    if (!this.auto || !Number.isFinite(Number(frameMs))) return false;
    this.samples.push(Math.max(0, Number(frameMs)));
    if (this.samples.length < this.sampleWindow) return false;

    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples.length = 0;
    const index = QUALITY_LEVELS.indexOf(this.level);
    const slow = average > (this.level === "high" ? 28 : 34);
    const fast = average < 14;

    if (slow) {
      this.slowWindows += 1;
      this.fastWindows = 0;
      if (this.slowWindows >= 2 && index > 0) {
        this.setQuality(QUALITY_LEVELS[index - 1]);
        return true;
      }
    } else if (fast) {
      this.fastWindows += 1;
      this.slowWindows = 0;
      if (this.fastWindows >= 3 && index < QUALITY_LEVELS.length - 1) {
        this.setQuality(QUALITY_LEVELS[index + 1]);
        return true;
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
    return false;
  }

  snapshot() {
    return {
      level: this.level,
      auto: this.auto,
      sampleWindow: this.sampleWindow,
      profile: { ...this.profile },
    };
  }
}

export { QUALITY_LEVELS };

export default QualityController;
