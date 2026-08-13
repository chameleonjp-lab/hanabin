import assert from "node:assert/strict";
import { test } from "node:test";

import { SoundController } from "../../src/audio/sound.js";
import {
  DEFAULT_PROFILE,
  createProfileStore,
  normalizeProfile,
  sanitizePlayerName,
} from "../../src/storage/local-storage.js";
import {
  buildShareText,
  publicUrlFor,
  resultHintFor,
} from "../../src/ui/result.js";
import { updatePlayMessage } from "../../src/ui/hud.js";
import {
  normalizePracticePoint,
  PRACTICE_SECONDS,
  PRACTICE_TARGET_COUNT,
  PRACTICE_TARGETS,
} from "../../src/ui/tutorial.js";
import {
  forecastSuccessCountFor,
  forecastSuccessForAction,
} from "../../src/ui/forecast-feedback.js";

const fakeStorage = (initial = null) => {
  let value = initial;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    removeItem() { value = null; },
    raw() { return value; },
  };
};

test("M6 player names are trimmed, bounded, and reject control characters", () => {
  assert.equal(sanitizePlayerName("  花火  "), "花火");
  assert.equal(sanitizePlayerName("line\nfeed"), "");
  assert.equal(sanitizePlayerName("a".repeat(13)), "");
  assert.equal(sanitizePlayerName(""), "");
});

test("M6 corrupted profile storage falls back to safe defaults", () => {
  const storage = fakeStorage("{not-json");
  const store = createProfileStore(storage, "test");
  assert.deepEqual(store.load(), DEFAULT_PROFILE);
  const saved = store.update({ name: " Player ", bestScore: 42, quality: "invalid", soundEnabled: true });
  assert.deepEqual(saved, {
    ...DEFAULT_PROFILE,
    name: "Player",
    bestScore: 42,
    soundEnabled: true,
  });
  assert.deepEqual(store.load(), saved);
  assert.deepEqual(normalizeProfile({ bestScore: -5, bestChain: "8", practiceCompleted: true }), {
    ...DEFAULT_PROFILE,
    bestChain: 8,
    practiceCompleted: true,
  });
});

test("M6 result hint is one deterministic sentence and share URL is last", () => {
  const state = { score: 2_000, stats: { maxChain: 2, directTargets: 9, chainTargets: 1 } };
  const hint = resultHintFor(state);
  assert.equal(typeof hint, "string");
  assert.ok(hint.length > 0);
  assert.equal(hint.split("。 ").length, 1);
  const url = publicUrlFor({ href: "https://example.test/hanabin/?e2e=1#result" });
  assert.equal(url, "https://example.test/hanabin/");
  const share = buildShareText({ name: "花子", score: 1_234, maxChain: 7, url });
  assert.match(share, /^花子さんのHANABIN結果\nSCORE 1,234 \/ 最大連鎖 7\n/);
  assert.equal(share.split("\n").at(-1), url);
});

test("M6 sound is silent by default and only creates audio when enabled", () => {
  let contexts = 0;
  const disabled = new SoundController({ contextFactory: () => { contexts += 1; return null; } });
  assert.equal(disabled.selection(), false);
  assert.equal(contexts, 0);
  const fakeContext = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
      };
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    },
    close() {},
  };
  const enabled = new SoundController({ enabled: true, contextFactory: () => fakeContext });
  assert.equal(enabled.detonation(), true);
  assert.equal(PRACTICE_SECONDS, 12);
});

test("M6 practice uses three fixed same-colour targets and normalizes touch points", () => {
  assert.equal(PRACTICE_TARGETS.length, PRACTICE_TARGET_COUNT);
  assert.equal(new Set(PRACTICE_TARGETS.map((target) => target.color)).size, 1);
  assert.deepEqual(normalizePracticePoint(25, 50, {
    left: 25,
    top: 50,
    width: 200,
    height: 100,
  }), { x: 0, y: 0 });
  assert.equal(normalizePracticePoint(0, 0, { left: 0, top: 0, width: 0, height: 100 }), null);
});

test("M6 forecast feedback derives successful plans from the score ledger", () => {
  const state = {
    bonusEvents: [
      { actionId: 4, forecastPlanAmount: 0 },
      { actionId: 9, forecastPlanAmount: 1_000 },
      { actionId: 12, forecastPlanAmount: 1_000 },
    ],
  };
  assert.equal(forecastSuccessCountFor(state), 2);
  assert.equal(forecastSuccessForAction(state, 9)?.forecastPlanAmount, 1_000);
  assert.equal(forecastSuccessForAction(state, 4), null);
});

test("M6 play feedback names a forecast success instead of only showing chain count", () => {
  const element = { textContent: "" };
  updatePlayMessage(element, {
    lastAction: { type: "detonate", actionId: 9, count: 7 },
    bonusEvents: [{ actionId: 9, forecastPlanAmount: 1_000 }],
  });
  assert.equal(element.textContent, "予告成功！次の波を先回りしました");
});
