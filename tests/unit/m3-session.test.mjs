import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES } from "../../src/config/rules.js";
import { createGame, replayGame } from "../../src/core/index.js";
import { makeInputFrame } from "../../src/core/input-frame.js";
import { isClockBacklogUnsafe } from "../../src/game/controller.js";
import { GameSession } from "../../src/game/session.js";

const makeSelectionFrames = (seed = 123) => {
  const preview = createGame(seed, DEFAULT_RULES);
  const targets = preview.fireworks.slice(0, 3);
  const frames = Array.from({ length: DEFAULT_RULES.maxTicks }, (_, tick) =>
    makeInputFrame(tick, tick, "noop", {
      pressed: false,
      x: 0,
      y: 0,
    }),
  );

  for (const [index, target] of targets.entries()) {
    for (let hold = 0; hold < DEFAULT_RULES.minHoldTicks; hold += 1) {
      const tick = index * DEFAULT_RULES.minHoldTicks + hold;
      frames[tick] = makeInputFrame(tick, tick, "pointer", {
        pressed: true,
        x: target.x,
        y: target.y,
      });
    }
  }
  frames[9] = makeInputFrame(9, 9, "pointer", {
    pressed: false,
    x: 0,
    y: 0,
  });
  return frames;
};

const makePointer = (frames) => ({
  sampleFrame: (tick, actionId) => {
    assert.equal(actionId, tick);
    return frames[tick];
  },
});

test("the presentation clock declares an explicit resync boundary before backlog can grow without bound", () => {
  assert.equal(isClockBacklogUnsafe(0), false);
  assert.equal(isClockBacklogUnsafe(1_000), false);
  assert.equal(isClockBacklogUnsafe(1_000.001), true);
  assert.equal(isClockBacklogUnsafe(Number.POSITIVE_INFINITY), true);
});

test("GameSession consumes exactly 3,600 fixed frames and replays the same result", () => {
  const frames = makeSelectionFrames();
  const phases = [];
  const session = new GameSession({
    seed: 123,
    pointer: makePointer(frames),
    onPhaseChange: (next, previous) => phases.push({ next, previous }),
  });

  session.prepare();
  session.advanceTicks(DEFAULT_RULES.maxTicks);
  assert.equal(session.phase, "finalizing");
  assert.equal(session.state.actionCount, DEFAULT_RULES.maxTicks);
  assert.equal(session.state.inputFrames.length, DEFAULT_RULES.maxTicks);
  assert.deepEqual(
    session.state.inputFrames.map((frame, index) => [frame.tick, frame.actionId]),
    Array.from({ length: DEFAULT_RULES.maxTicks }, (_, index) => [index, index]),
  );
  assert.ok(session.state.score > 0, "the fixed pointer fixture must exercise a real detonation");

  session.finalize();
  session.showResult();
  assert.equal(session.phase, "result");
  assert.equal(session.state.tick, DEFAULT_RULES.maxTicks);
  assert.ok(session.state.resolutionTick >= DEFAULT_RULES.maxTicks);
  assert.ok(session.state.resolutionTick <= DEFAULT_RULES.maxTicks + DEFAULT_RULES.maxChainTicks);
  assert.deepEqual(session.validate(), []);
  assert.equal(session.replayCheck?.ok, true);

  const replayed = replayGame(session.replay, { rules: DEFAULT_RULES });
  assert.equal(replayed.simulationFault, null);
  assert.deepEqual(replayed.validationErrors, []);
  assert.equal(replayed.state.score, session.state.score);
  assert.equal(replayed.state.finalScore, session.state.finalScore);
  assert.deepEqual(replayed.state, session.snapshot());
});

test("terminal sessions reject additional input frames and enter result only once", () => {
  const phases = [];
  const session = new GameSession({
    seed: 1,
    onPhaseChange: (next, previous) => phases.push({ next, previous }),
  });

  session.prepare();
  session.advanceTicks(DEFAULT_RULES.maxTicks);
  session.finalize();
  session.showResult();

  const before = {
    actionCount: session.state.actionCount,
    frameCount: session.state.inputFrames.length,
    score: session.state.score,
  };
  session.advanceTicks(120);
  session.showResult();

  assert.deepEqual(
    {
      actionCount: session.state.actionCount,
      frameCount: session.state.inputFrames.length,
      score: session.state.score,
    },
    before,
  );
  assert.equal(phases.filter(({ next }) => next === "result").length, 1);
});
