import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAIN_MILESTONES,
  chainMilestoneFor,
  chainMilestonePresentationFor,
  drawFireworkEffects,
  explosionPresentationFor,
  explosionVisualKey,
  spawnExplosionParticles,
} from "../../src/render/firework-effects.js";
import { ParticlePool } from "../../src/render/particle-pool.js";
import { DecorativeLayer } from "../../src/render/decorative-layer.js";
import {
  PRESENTATION_MEDIA_QUERIES,
  detectPresentationExperience,
} from "../../src/presentation/experience.js";
import {
  displayEntityRadius,
  isForecastBridgeForNextWave,
} from "../../src/render/competitive-layer.js";
import {
  DESKTOP_QUALITY_PROFILES,
  QUALITY_LEVELS,
  QUALITY_PROFILES,
  QualityController,
  qualityProfileFor,
} from "../../src/render/quality-controller.js";

test("M5 keeps three decoration profiles while preserving competitive information", () => {
  assert.deepEqual(QUALITY_LEVELS, ["low", "medium", "high"]);
  for (const level of QUALITY_LEVELS) {
    const profile = QUALITY_PROFILES[level];
    assert.ok(profile.particleCapacity > 0);
    assert.ok(profile.particlesPerDirect >= profile.particlesPerChain);
    assert.ok(profile.resolutionScale > 0 && profile.resolutionScale <= 1);
  }
  assert.ok(QUALITY_PROFILES.low.particleCapacity < QUALITY_PROFILES.high.particleCapacity);
  assert.equal(QUALITY_PROFILES.low.scoreLabels, true);
  assert.equal(QUALITY_PROFILES.low.scoreLabelLimit, 1);
});

test("presentation capability detection chooses rich desktop only for a fine hover pointer", () => {
  const matcher = (matching) => (query) => ({ matches: matching.includes(query) });
  const desktop = detectPresentationExperience({
    matchMedia: matcher([PRESENTATION_MEDIA_QUERIES.desktop]),
    maxTouchPoints: 0,
  });
  assert.equal(desktop.variant, "desktop");
  assert.equal(desktop.desktopCapable, true);
  assert.equal(desktop.reducedMotion, false);

  const touch = detectPresentationExperience({
    matchMedia: matcher([
      PRESENTATION_MEDIA_QUERIES.coarsePointer,
      PRESENTATION_MEDIA_QUERIES.reducedMotion,
    ]),
    maxTouchPoints: 5,
  });
  assert.equal(touch.variant, "touch");
  assert.equal(touch.coarsePointer, true);
  assert.equal(touch.reducedMotion, true);
});

test("low touch quality keeps one score label as success feedback", () => {
  const labels = [];
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText(label) { labels.push(label); },
  };
  drawFireworkEffects(context, {
    state: { seed: 1, tick: 4, activeExplosions: [] },
    width: 1_600,
    height: 900,
    profile: QUALITY_PROFILES.low,
    nowMs: 100,
    scoreFeedback: [{ amount: 100, startedAtMs: 0, x: 4_000, y: 3_000 }],
  });
  assert.deepEqual(labels, ["+100"]);
});

test("desktop quality is richer while reduced motion keeps competitive geometry intact", () => {
  for (const level of QUALITY_LEVELS) {
    const touch = QUALITY_PROFILES[level];
    const desktop = DESKTOP_QUALITY_PROFILES[level];
    assert.ok(desktop.backgroundStars > touch.backgroundStars);
    assert.ok(desktop.particlesPerDirect > touch.particlesPerDirect);
    assert.ok(desktop.particleCapacity > touch.particleCapacity);
    assert.ok(desktop.secondaryRings >= touch.secondaryRings);
    assert.ok(desktop.auroraAlpha > touch.auroraAlpha);
  }

  const full = qualityProfileFor("high", { variant: "desktop" });
  const reduced = qualityProfileFor("high", { variant: "desktop", reducedMotion: true });
  assert.equal(reduced.level, full.level);
  assert.equal(reduced.variant, full.variant);
  assert.equal(reduced.reducedMotion, true);
  assert.equal(reduced.starTwinkle, false);
  assert.equal(reduced.milestonePulses, false);
  assert.equal(reduced.scoreLabels, false);
  assert.ok(reduced.particleCapacity < full.particleCapacity);
  assert.ok(reduced.motionScale < full.motionScale);
});

test("practice-sized targets and forecast bridge markings remain competitive information", () => {
  assert.equal(displayEntityRadius(0.02), 10);
  assert.ok(displayEntityRadius(0.1) > 10);
  const state = { upcomingWaves: [{ waveIndex: 8 }] };
  assert.equal(isForecastBridgeForNextWave({ forecastForWaveIndex: 8 }, state), true);
  assert.equal(isForecastBridgeForNextWave({ forecastForWaveIndex: 7 }, state), false);
  assert.equal(isForecastBridgeForNextWave({ forecastForWaveIndex: 8 }, { upcomingWaves: [] }), false);
});

test("quality controller can change presentation experience without changing quality level", () => {
  const controller = new QualityController({ initial: "medium", variant: "touch" });
  const touchCapacity = controller.profile.particleCapacity;
  assert.equal(controller.setExperience({ variant: "desktop", reducedMotion: false }), true);
  assert.equal(controller.level, "medium");
  assert.equal(controller.profile.variant, "desktop");
  assert.ok(controller.profile.particleCapacity > touchCapacity);
  assert.equal(controller.setReducedMotion(true), true);
  assert.equal(controller.profile.reducedMotion, true);
  assert.equal(controller.snapshot().profile.scoreLabels, false);
});

test("quality controller lowers and raises decoration without changing its contract", () => {
  const controller = new QualityController({ initial: "high", sampleWindow: 5 });
  for (let window = 0; window < 2; window += 1) {
    for (let frame = 0; frame < 5; frame += 1) controller.observe(40);
  }
  assert.equal(controller.level, "medium");
  for (let window = 0; window < 2; window += 1) {
    for (let frame = 0; frame < 5; frame += 1) controller.observe(40);
  }
  assert.equal(controller.level, "low");
  controller.setQuality("medium");
  assert.equal(controller.profile.level, "medium");
  for (let window = 0; window < 3; window += 1) {
    for (let frame = 0; frame < 5; frame += 1) controller.observe(10);
  }
  assert.equal(controller.level, "high");
});

test("stable 60 Hz frame intervals can recover automatic quality", () => {
  const controller = new QualityController({ initial: "low", sampleWindow: 5 });
  for (let window = 0; window < 3; window += 1) {
    for (let frame = 0; frame < 5; frame += 1) controller.observeFrameInterval(16.7);
  }
  assert.equal(controller.level, "medium");
});

test("particle pool reuses fixed slots and never exceeds capacity", () => {
  const pool = new ParticlePool(2);
  const first = pool.spawn({ x: 1, lifeMs: 10 }, 0);
  const second = pool.spawn({ x: 2, lifeMs: 10 }, 0);
  const replacement = pool.spawn({ x: 3, lifeMs: 10 }, 0);
  assert.equal(pool.activeCount, 2);
  assert.ok(replacement === first || replacement === second);
  pool.update(11);
  assert.equal(pool.activeCount, 0);
  const reused = pool.spawn({ x: 4, lifeMs: 10 }, 12);
  assert.ok(reused === first || reused === second);
  assert.equal(pool.snapshot().length, 1);
});

test("particle pool immediately trims live decoration to a lowered quality budget", () => {
  const pool = new ParticlePool(6);
  for (let index = 0; index < 6; index += 1) {
    pool.spawn({ x: index, lifeMs: 1_000 }, index);
  }
  assert.equal(pool.trim(2), 2);
  assert.deepEqual(pool.snapshot().map((particle) => particle.x), [4, 5]);
  assert.equal(pool.trim(0), 0);
});

test("firework particle directions are deterministic and generation-aware", () => {
  const first = new ParticlePool(64);
  const second = new ParticlePool(64);
  const explosion = {
    actionId: 3,
    eventId: 9,
    kind: "chain",
    depth: 2,
    originX: 1_000,
    originY: 2_000,
    sourceColor: "blue",
  };
  const profile = QUALITY_PROFILES.medium;
  spawnExplosionParticles(first, explosion, { profile, nowMs: 20 });
  spawnExplosionParticles(second, explosion, { profile, nowMs: 20 });
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.equal(explosionVisualKey(explosion), "3:9");
});

test("chain milestones use the intended 5, 10, 20, 30 thresholds", () => {
  assert.deepEqual(CHAIN_MILESTONES, [5, 10, 20, 30]);
  assert.equal(chainMilestoneFor(0), 0);
  assert.equal(chainMilestoneFor(5), 5);
  assert.equal(chainMilestoneFor(19), 10);
  assert.equal(chainMilestoneFor(30), 30);
  assert.equal(chainMilestoneFor(99), 30);
});

test("chain presentation distinguishes direct, shallow, and deep reactions", () => {
  const direct = explosionPresentationFor({ kind: "direct", depth: 0 });
  const shallow = explosionPresentationFor({ kind: "chain", depth: 1 });
  const deep = explosionPresentationFor({ kind: "chain", depth: 2 });
  assert.equal(direct.role, "direct");
  assert.equal(shallow.role, "chain");
  assert.equal(deep.role, "chain-deep");
  assert.notEqual(direct.accentColor, shallow.accentColor);
  assert.notEqual(shallow.accentColor, deep.accentColor);
  assert.ok(deep.lineWidthMultiplier > shallow.lineWidthMultiplier);
  assert.ok(deep.accentRadiusScale > 1);
});

test("higher chain milestones receive stronger multi-ring pulses", () => {
  const five = chainMilestonePresentationFor(5);
  const ten = chainMilestonePresentationFor(10);
  const twenty = chainMilestonePresentationFor(20);
  const thirty = chainMilestonePresentationFor(30);
  assert.equal(five.ringCount, 1);
  assert.equal(ten.ringCount, 2);
  assert.equal(twenty.ringCount, 3);
  assert.equal(thirty.ringCount, 4);
  assert.ok(thirty.radiusScale > twenty.radiusScale);
  assert.ok(thirty.fillAlpha > five.fillAlpha);
});

test("decorative rendering reads the game state without writing to it", () => {
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
  };
  const state = {
    seed: 7,
    tick: 4,
    stats: { maxChain: 10 },
    activeExplosions: [{
      actionId: 1,
      eventId: 2,
      kind: "direct",
      depth: 0,
      fireTick: 0,
      endTick: 30,
      durationTicks: 30,
      radius: 1_800,
      originX: 4_000,
      originY: 3_000,
      sourceColor: "red",
    }],
  };
  const before = JSON.stringify(state);
  const layer = new DecorativeLayer({ capacity: 64 });
  layer.render(context, {
    state,
    width: 1_600,
    height: 900,
    boardWidth: 16_000,
    boardHeight: 9_000,
    nowMs: 100,
  });
  assert.equal(JSON.stringify(state), before);
  assert.ok(layer.pool.activeCount > 0);
  assert.equal(layer.pulses.length, 2);
});
