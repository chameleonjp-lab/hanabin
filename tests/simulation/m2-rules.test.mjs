import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  COLORS,
  COLOR_COUNT,
  DEFAULT_RULES,
  GAME_TICKS,
  TICKS_PER_SECOND,
  TOTAL_TICKS,
  WAVE_INTERVAL_TICKS,
  WAVE_KINDS,
  mergeRules,
  waveKindAt,
  waveTickAt,
} from "../../src/config/rules.js";
import { DEFAULT_SEED, XorShift32, createRng, normalizeSeed, xorshift32 } from "../../src/core/rng.js";
import { generateWave, waveKinds } from "../../src/core/wave-generator.js";
import { advanceGame, createGame } from "../../src/core/engine.js";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("M2 uses four colors, an integer 16000x9000 board, and 60Hz/3600ticks", () => {
  assert.equal(COLOR_COUNT, 4);
  assert.deepEqual(COLORS, ["red", "blue", "green", "yellow"]);
  assert.equal(DEFAULT_RULES.colorCount, 4);
  assert.equal(BOARD_WIDTH, 16_000);
  assert.equal(BOARD_HEIGHT, 9_000);
  assert.equal(DEFAULT_RULES.board.width, 16_000);
  assert.equal(DEFAULT_RULES.board.height, 9_000);
  assert.equal(TICKS_PER_SECOND, 60);
  assert.equal(TOTAL_TICKS, 3_600);
  assert.equal(GAME_TICKS, 3_600);
  assert.equal(DEFAULT_RULES.maxTicks, 3_600);
  for (const key of ["boardWidth", "boardHeight", "maxTicks", "tickRate", "colorCount"]) {
    assert.equal(Number.isInteger(DEFAULT_RULES[key]), true, `${key} must be integer`);
  }
  const attemptedOverride = mergeRules({
    boardWidth: 1,
    boardHeight: 1,
    maxTicks: 1,
    durationTicks: 1,
    tickRate: 1,
    gameVersion: "wrong",
    ruleVersion: "wrong",
  });
  assert.deepEqual(
    [attemptedOverride.boardWidth, attemptedOverride.boardHeight, attemptedOverride.maxTicks,
      attemptedOverride.tickRate, attemptedOverride.gameVersion, attemptedOverride.ruleVersion],
    [16_000, 9_000, 3_600, 60, DEFAULT_RULES.gameVersion, DEFAULT_RULES.ruleVersion],
  );
});

test("xorshift32 has a non-zero deterministic zero-seed boundary", () => {
  assert.notEqual(DEFAULT_SEED, 0);
  assert.notEqual(normalizeSeed(0), 0);
  assert.equal(xorshift32(1), 270_369);
  assert.equal(xorshift32(0), xorshift32(DEFAULT_SEED));
  const left = createRng(0);
  const right = new XorShift32(DEFAULT_SEED);
  assert.deepEqual(
    Array.from({ length: 8 }, () => left.nextUint32()),
    Array.from({ length: 8 }, () => right.nextUint32()),
  );
});

test("the six wave kinds appear in a deterministic 120–240 tick schedule", () => {
  assert.equal(WAVE_KINDS.length, 6);
  assert.deepEqual(waveKinds(), [...WAVE_KINDS]);
  const intervalsFromConfig = Array.from(WAVE_INTERVAL_TICKS);
  assert.ok(intervalsFromConfig.every((interval) => interval >= 120 && interval <= 240));
  const ticks = Array.from({ length: 20 }, (_, index) => waveTickAt(index, DEFAULT_RULES));
  const intervals = ticks.slice(1).map((tick, index) => tick - ticks[index]);
  assert.ok(intervals.every((interval) => interval >= 120 && interval <= 240));
  const schedule = [];
  for (let index = 0; index < DEFAULT_RULES.maxWaves; index += 1) {
    const tick = waveTickAt(index, DEFAULT_RULES);
    if (tick >= TOTAL_TICKS) break;
    schedule.push(tick);
  }
  assert.ok(schedule.length >= 15 && schedule.length <= 30, "session wave count must stay in the 15–30 band");
  assert.ok(DEFAULT_RULES.maxWaves <= 32);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => waveKindAt(index)),
    [...WAVE_KINDS],
  );
  const generatedKinds = Array.from({ length: 12 }, (_, index) => generateWave(0, index, DEFAULT_RULES).kind);
  assert.deepEqual(new Set(generatedKinds), new Set(WAVE_KINDS));
  for (const wave of Array.from({ length: 20 }, (_, index) => generateWave(0, index, DEFAULT_RULES))) {
    for (const entity of wave.entities) {
      assert.equal(Number.isInteger(entity.x), true);
      assert.equal(Number.isInteger(entity.y), true);
      assert.ok(entity.x >= 0 && entity.x <= BOARD_WIDTH);
      assert.ok(entity.y >= 0 && entity.y <= BOARD_HEIGHT);
      assert.ok(entity.lifetimeTicks >= 240 && entity.lifetimeTicks <= 420);
    }
  }
});

test("the next two forecasts identify the exact waves later generated", () => {
  const state = createGame(2026, DEFAULT_RULES);
  assert.equal(state.upcomingWaves.length, 2);
  for (const forecast of state.upcomingWaves) {
    const generated = generateWave(state.seed, forecast.waveIndex, DEFAULT_RULES);
    assert.deepEqual(
      {
        waveId: forecast.waveId,
        primaryColor: forecast.primaryColor,
        order: forecast.order,
        position: forecast.position,
      },
      {
        waveId: generated.waveId,
        primaryColor: generated.primaryColor,
        order: generated.order,
        position: generated.position,
      },
    );
  }
  const firstForecast = state.upcomingWaves[0];
  advanceGame(state, firstForecast.fireTick, DEFAULT_RULES);
  assert.ok(state.waves.some((wave) => wave.waveId === firstForecast.waveId));
});

test("core/config has no browser, ambient random, or wall-clock dependency", async () => {
  const files = [];
  const collect = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = resolve(directory, entry.name);
      if (entry.isDirectory()) await collect(target);
      else if (entry.name.endsWith(".js")) files.push(target);
    }
  };
  await collect(resolve(projectRoot, "src/config"));
  await collect(resolve(projectRoot, "src/core"));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|\bCanvas\b|Math\.random\b/i);
  assert.doesNotMatch(source, /\b(?:Date|performance)\s*\.|new\s+Date\s*\(|requestAnimationFrame|setTimeout|setInterval/);
});
