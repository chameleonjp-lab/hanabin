import { normalizePresentationVariant } from "../presentation/experience.js";

const QUALITY_LEVELS = Object.freeze(["low", "medium", "high"]);

const freezeProfiles = (profiles, variant) => Object.freeze(Object.fromEntries(
  Object.entries(profiles).map(([level, profile]) => [level, Object.freeze({
    ...profile,
    level,
    variant,
    reducedMotion: false,
  })]),
));

/**
 * The touch profiles retain M5's shipped budgets. New fields describe
 * optional decoration only; renderers that do not know them keep the current
 * appearance and deterministic game state remains untouched.
 */
export const QUALITY_PROFILES = freezeProfiles({
  low: {
    resolutionScale: 0.78,
    backgroundStars: 14,
    particlesPerDirect: 8,
    particlesPerChain: 5,
    particleCapacity: 320,
    trailAlpha: 0.48,
    glowMultiplier: 0.62,
    burstLayers: 1,
    sparkTrailSegments: 0,
    afterglowAlpha: 0.08,
    shockwaveRings: 1,
    secondaryRings: 0,
    auroraAlpha: 0,
    scoreLabels: false,
    scoreLabelLimit: 0,
    starTwinkle: true,
    milestonePulses: true,
    motionScale: 1,
  },
  medium: {
    resolutionScale: 0.9,
    backgroundStars: 24,
    particlesPerDirect: 16,
    particlesPerChain: 10,
    particleCapacity: 640,
    trailAlpha: 0.64,
    glowMultiplier: 0.82,
    burstLayers: 1,
    sparkTrailSegments: 1,
    afterglowAlpha: 0.12,
    shockwaveRings: 1,
    secondaryRings: 0,
    auroraAlpha: 0.03,
    scoreLabels: true,
    scoreLabelLimit: 6,
    starTwinkle: true,
    milestonePulses: true,
    motionScale: 1,
  },
  high: {
    resolutionScale: 1,
    backgroundStars: 36,
    particlesPerDirect: 28,
    particlesPerChain: 18,
    particleCapacity: 1_024,
    trailAlpha: 0.82,
    glowMultiplier: 1,
    burstLayers: 1,
    sparkTrailSegments: 2,
    afterglowAlpha: 0.18,
    shockwaveRings: 1,
    secondaryRings: 1,
    auroraAlpha: 0.06,
    scoreLabels: true,
    scoreLabelLimit: 10,
    starTwinkle: true,
    milestonePulses: true,
    motionScale: 1,
  },
}, "touch");

/** Desktop has a deliberately richer decorative ceiling than touch. */
export const DESKTOP_QUALITY_PROFILES = freezeProfiles({
  low: {
    resolutionScale: 0.86,
    backgroundStars: 26,
    particlesPerDirect: 14,
    particlesPerChain: 8,
    particleCapacity: 480,
    trailAlpha: 0.62,
    glowMultiplier: 0.82,
    burstLayers: 1,
    sparkTrailSegments: 2,
    afterglowAlpha: 0.16,
    shockwaveRings: 1,
    secondaryRings: 1,
    auroraAlpha: 0.08,
    scoreLabels: true,
    scoreLabelLimit: 6,
    starTwinkle: true,
    milestonePulses: true,
    motionScale: 1,
  },
  medium: {
    resolutionScale: 0.94,
    backgroundStars: 48,
    particlesPerDirect: 26,
    particlesPerChain: 16,
    particleCapacity: 960,
    trailAlpha: 0.8,
    glowMultiplier: 1.06,
    burstLayers: 2,
    sparkTrailSegments: 4,
    afterglowAlpha: 0.25,
    shockwaveRings: 2,
    secondaryRings: 2,
    auroraAlpha: 0.14,
    scoreLabels: true,
    scoreLabelLimit: 12,
    starTwinkle: true,
    milestonePulses: true,
    motionScale: 1,
  },
  high: {
    resolutionScale: 1,
    backgroundStars: 72,
    particlesPerDirect: 44,
    particlesPerChain: 28,
    particleCapacity: 1_536,
    trailAlpha: 0.94,
    glowMultiplier: 1.25,
    burstLayers: 3,
    sparkTrailSegments: 6,
    afterglowAlpha: 0.34,
    shockwaveRings: 3,
    secondaryRings: 3,
    auroraAlpha: 0.22,
    scoreLabels: true,
    scoreLabelLimit: 20,
    starTwinkle: true,
    milestonePulses: true,
    motionScale: 1,
  },
}, "desktop");

export const QUALITY_PROFILES_BY_VARIANT = Object.freeze({
  touch: QUALITY_PROFILES,
  desktop: DESKTOP_QUALITY_PROFILES,
});

const reducedProfiles = Object.freeze(Object.fromEntries(
  Object.entries(QUALITY_PROFILES_BY_VARIANT).map(([variant, profiles]) => [
    variant,
    Object.freeze(Object.fromEntries(QUALITY_LEVELS.map((level) => {
      const profile = profiles[level];
      return [level, Object.freeze({
        ...profile,
        backgroundStars: Math.min(profile.backgroundStars, variant === "desktop" ? 18 : 10),
        particlesPerDirect: Math.max(3, Math.ceil(profile.particlesPerDirect * 0.35)),
        particlesPerChain: Math.max(2, Math.ceil(profile.particlesPerChain * 0.3)),
        particleCapacity: Math.min(profile.particleCapacity, variant === "desktop" ? 480 : 320),
        trailAlpha: 0,
        glowMultiplier: Math.min(profile.glowMultiplier, 0.72),
        burstLayers: 1,
        sparkTrailSegments: 0,
        afterglowAlpha: 0,
        shockwaveRings: 1,
        secondaryRings: 0,
        auroraAlpha: 0,
        scoreLabels: false,
        scoreLabelLimit: 0,
        starTwinkle: false,
        milestonePulses: false,
        motionScale: 0.25,
        reducedMotion: true,
      })];
    }))),
  ]),
));

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeLevel = (level) => QUALITY_LEVELS.includes(level) ? level : "high";

export const qualityProfileFor = (level, {
  variant = "touch",
  reducedMotion = false,
} = {}) => {
  const resolvedLevel = normalizeLevel(level);
  const resolvedVariant = normalizePresentationVariant(variant);
  return reducedMotion === true
    ? reducedProfiles[resolvedVariant][resolvedLevel]
    : QUALITY_PROFILES_BY_VARIANT[resolvedVariant][resolvedLevel];
};

/**
 * Controls decoration only. It never receives or changes a game state and
 * therefore cannot affect score, input replay, or fixed-tick simulation.
 */
export class QualityController {
  constructor({
    initial = "high",
    auto = true,
    sampleWindow = 30,
    variant = "touch",
    reducedMotion = false,
  } = {}) {
    this.level = normalizeLevel(initial);
    this.auto = auto !== false;
    this.variant = normalizePresentationVariant(variant);
    this.reducedMotion = reducedMotion === true;
    this.sampleWindow = Math.max(5, Math.trunc(finite(sampleWindow, 30)));
    this.samples = [];
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  get profile() {
    return qualityProfileFor(this.level, {
      variant: this.variant,
      reducedMotion: this.reducedMotion,
    });
  }

  resetSamples() {
    this.samples.length = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  setQuality(level) {
    const next = QUALITY_LEVELS.includes(level) ? level : this.level;
    const changed = next !== this.level;
    this.level = next;
    this.resetSamples();
    return changed;
  }

  setVariant(variant) {
    const next = normalizePresentationVariant(variant, this.variant);
    const changed = next !== this.variant;
    this.variant = next;
    if (changed) this.resetSamples();
    return changed;
  }

  setReducedMotion(reducedMotion) {
    const next = reducedMotion === true;
    const changed = next !== this.reducedMotion;
    this.reducedMotion = next;
    if (changed) this.resetSamples();
    return changed;
  }

  setExperience({ variant = this.variant, reducedMotion = this.reducedMotion } = {}) {
    const variantChanged = this.setVariant(variant);
    const motionChanged = this.setReducedMotion(reducedMotion);
    return variantChanged || motionChanged;
  }

  observeFrameInterval(frameMs) {
    if (!this.auto || !Number.isFinite(Number(frameMs))) return false;
    this.samples.push(Math.max(0, Number(frameMs)));
    if (this.samples.length < this.sampleWindow) return false;

    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples.length = 0;
    const index = QUALITY_LEVELS.indexOf(this.level);
    // These are rAF intervals, not render function costs. Stable 60 Hz is
    // about 16.7 ms and should be eligible to recover toward high quality.
    const slow = average > (this.level === "high" ? 21 : 26);
    const fast = average < 18.5;

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

  /** Backwards-compatible alias; callers should pass measured rAF intervals. */
  observe(frameMs) {
    return this.observeFrameInterval(frameMs);
  }

  snapshot() {
    return {
      level: this.level,
      auto: this.auto,
      variant: this.variant,
      reducedMotion: this.reducedMotion,
      sampleWindow: this.sampleWindow,
      profile: { ...this.profile },
    };
  }
}

export { QUALITY_LEVELS };

export default QualityController;
