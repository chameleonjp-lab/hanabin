import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import { SOUND_CUES, SoundController } from "../../src/audio/sound.js";
import { GameController } from "../../src/game/controller.js";

test("Q6 player HUD labels are understandable without internal field names", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  for (const label of ["得点", "残り時間", "連鎖", "選択", "爆発範囲", "選べる数", "次の予告"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  const renderer = await readFile(new URL("../../src/render/canvas-renderer.js", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /FIXED 60Hz \/ 16:9/);
  assert.match(html, /id="finalizing-summary"/);
  const controller = await readFile(new URL("../../src/game/controller.js", import.meta.url), "utf8");
  assert.match(controller, /focusResultTitle\(\)/u);
  assert.match(controller, /focus\?\.\(\{ preventScroll: true \}\)/u);
  assert.match(controller, /resultSaveStatus/u);
  assert.match(controller, /persisted === false/u);
});

test("Q6 sound state exposes bounded cues and never schedules while interrupted", async () => {
  const context = {
    state: "interrupted",
    currentTime: 0,
    destination: {},
    resumeCalls: 0,
    async resume() { this.resumeCalls += 1; this.state = "running"; },
    createOscillator() {
      return {
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
      };
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    },
  };
  const sound = new SoundController({ enabled: true, contextFactory: () => context, maxVoices: 2 });
  assert.equal(sound.play("select"), false);
  assert.equal(sound.snapshot().activeVoices, 0);
  assert.equal(await sound.unlock(), true);
  assert.equal(context.resumeCalls, 1);
  assert.equal(sound.play("select"), true);
  assert.ok(SOUND_CUES.length >= 8);
  assert.ok(sound.snapshot().activeVoices <= 2);
  sound.destroy();
});

test("Q6 result save status exposes storage and validation outcomes", () => {
  const resultSaveStatus = { hidden: true, textContent: "" };
  const controller = Object.assign(Object.create(GameController.prototype), { resultSaveStatus });
  controller.setResultSaveStatus("保存できませんでした");
  assert.equal(resultSaveStatus.hidden, false);
  assert.equal(resultSaveStatus.textContent, "保存できませんでした");
  controller.setResultSaveStatus("");
  assert.equal(resultSaveStatus.hidden, true);
  assert.equal(resultSaveStatus.textContent, "");
});
