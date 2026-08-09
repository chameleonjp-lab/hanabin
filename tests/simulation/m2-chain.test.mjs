import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES } from "../../src/config/rules.js";

test("selection and hold multipliers are radius/duration contracts, not score multipliers", async () => {
  assert.equal(DEFAULT_RULES.selectionLinkDistance, 5_140);
  assert.equal(DEFAULT_RULES.baseExplosionRadius, 1_800);
  assert.notEqual(DEFAULT_RULES.selectionLinkDistance, DEFAULT_RULES.baseExplosionRadius);
  assert.equal(DEFAULT_RULES.sameColorRadius, 90);
  assert.equal(DEFAULT_RULES.differentColorRadius, 78);
  assert.equal(DEFAULT_RULES.minimumRadius, 55);

  // Required pure chain API. It must use integer arithmetic and stay separate
  // from input/UI modules.
  const chain = await import("../../src/core/chain.js");
  for (const name of [
    "selectionRadiusMultiplierPercent",
    "holdDurationMultiplierPercent",
    "attenuatedRadius",
  ]) {
    assert.equal(typeof chain[name], "function", `missing public chain API: ${name}`);
  }
  assert.deepEqual(
    [3, 4, 5, 6, 9].map((count) => chain.selectionRadiusMultiplierPercent(count)),
    [100, 115, 130, 140, 140],
  );
  assert.deepEqual(
    [3, 4, 5, 6, 9].map((ticks) => chain.holdDurationMultiplierPercent(ticks)),
    [100, 100, 110, 115, 115],
  );
  assert.equal(chain.attenuatedRadius(1_800, 90), 1_620);
  assert.equal(chain.attenuatedRadius(1_800, 78), 1_404);
  assert.equal(chain.attenuatedRadius(1_800, 55), 990);

  const metadata = [3, 4, 5, 6].map((count) => {
    const entities = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      color: 0,
      x: 1_000 + index * 10,
      y: 1_000,
      depth: index,
    }));
    return chain.resolveChain(entities, {
      selectedIds: entities.map((entity) => entity.id),
      directX: 1_000,
      directY: 1_000,
    }).events[0];
  });
  assert.deepEqual(metadata.map((event) => event.radius), [1_800, 2_070, 2_340, 2_520]);
  assert.deepEqual(metadata.map((event) => event.explosionDurationTicks), [30, 30, 33, 35]);
});

test("chain propagation has a finite safety bound and does not score one target twice", async () => {
  assert.equal(DEFAULT_RULES.maxChainTicks, 150);
  assert.ok(DEFAULT_RULES.maxConcurrentExplosions > 0);
  assert.ok(DEFAULT_RULES.maxChainEvents > 0);
  // Required public API: resolution is a deterministic pure operation over
  // an ordered-independent entity set; duplicate target IDs are ignored.
  const chain = await import("../../src/core/chain.js");
  assert.equal(typeof chain.resolveChain, "function", "missing public chain resolver");
  const entities = [
    { id: "a", color: 0, x: 1_000, y: 1_000 },
    { id: "b", color: 0, x: 1_500, y: 1_000 },
    { id: "c", color: 1, x: 1_900, y: 1_000 },
    { id: "d", color: 0, x: 2_400, y: 1_000 },
  ];
  const options = {
    selectedIds: ["a"],
    directX: 1_000,
    directY: 1_000,
    tick: 0,
    rules: DEFAULT_RULES,
  };
  const first = chain.resolveChain(entities, options);
  const second = chain.resolveChain([...entities].reverse(), options);
  assert.deepEqual(first, second);
  const targetIds = first.events.map((event) => event.targetId);
  assert.equal(new Set(targetIds).size, targetIds.length);
  assert.ok(first.events.every((event) => event.fireTick <= DEFAULT_RULES.maxChainTicks));
  const directRadius = first.events[0].directRadius;
  assert.ok(first.events.every((event) => event.radius >= Math.round(directRadius * 0.55)));

  const competing = chain.resolveChain([
    { id: 3, color: 0, x: 1_200, y: 1_000, depth: 1 },
    { id: 2, color: 0, x: 1_020, y: 1_000, depth: 2 },
    { id: 1, color: 0, x: 1_000, y: 1_000, depth: 3 },
  ], {
    selectedIds: [2, 1],
    directX: 1_000,
    directY: 1_000,
    tick: 0,
    actionId: 9,
  });
  const capture = competing.events.find((event) => event.targetId === 3);
  assert.equal(capture.sourceId, 1, "stable source order wins a same-tick competing claim");
});

test("the direct radius catches first-generation targets before attenuation", async () => {
  const chain = await import("../../src/core/chain.js");
  const result = chain.resolveChain([
    { id: 1, color: 0, x: 1_000, y: 1_000, depth: 3 },
    { id: 2, color: 0, x: 2_700, y: 1_000, depth: 2 },
  ], {
    selectedIds: [1],
    tick: 0,
    actionId: 7,
  });
  const captured = result.events.find((event) => event.targetId === 2);
  assert.ok(captured, "1,700 is inside the direct 1,800 radius");
  assert.equal(captured.radius, 1_620, "the caught same-color firework receives the 90% next radius");
});
