import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAIN_MILESTONES,
  chainMilestoneFor,
  explosionVisualKey,
  spawnExplosionParticles,
} from "../../src/render/firework-effects.js";
import { ParticlePool } from "../../src/render/particle-pool.js";
import { DecorativeLayer } from "../../src/render/decorative-layer.js";
import {
  QUALITY_LEVELS,
  QUALITY_PROFILES,
  QualityController,
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
