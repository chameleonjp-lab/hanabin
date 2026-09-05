import assert from "node:assert/strict";
import { test } from "node:test";

import { SOUND_CUES, SoundController } from "../../src/audio/sound.js";
import { PresentationEventTracker } from "../../src/game/presentation-events.js";
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
  scoreBreakdownFor,
} from "../../src/ui/result.js";
import { DEFAULT_RULES } from "../../src/config/rules.js";
import { explosionRangeRows, scoreGuideModel } from "../../src/ui/rules-guide.js";
import { updatePlayMessage } from "../../src/ui/hud.js";
import {
  findPracticeCandidate,
  normalizePracticePoint,
  PRACTICE_SECONDS,
  PRACTICE_CHAIN_TARGET,
  PRACTICE_STAGE_COUNT,
  PRACTICE_STAGE_TWO_TARGETS,
  PRACTICE_TARGET_COUNT,
  PRACTICE_TARGETS,
  practiceTargetBoardPoint,
  practiceStageDurationsFor,
  practiceTargetsAt,
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

const fakeAudioContext = ({ initialState = "running" } = {}) => {
  const stats = { oscillators: 0, resumes: 0, suspends: 0 };
  const context = {
    state: initialState,
    currentTime: 0,
    destination: {},
    async resume() {
      stats.resumes += 1;
      this.state = "running";
    },
    async suspend() {
      stats.suspends += 1;
      this.state = "suspended";
    },
    createOscillator() {
      stats.oscillators += 1;
      return {
        type: "sine",
        frequency: { setValueAtTime() {} },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    },
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    },
    async close() { this.state = "closed"; },
  };
  return { context, stats };
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

test("M6 failed Safari-style storage reads and writes preserve in-memory updates", () => {
  const stale = JSON.stringify({
    ...DEFAULT_PROFILE,
    name: "保存済み",
  });
  const storage = {
    getItem() { return stale; },
    setItem() { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem() {},
  };
  const store = createProfileStore(storage, "test");

  assert.equal(store.load().name, "保存済み");
  const afterPractice = store.update({ practiceCompleted: true });
  const afterSound = store.update({ soundEnabled: true });

  assert.equal(afterPractice.practiceCompleted, true);
  assert.equal(afterSound.practiceCompleted, true);
  assert.equal(afterSound.soundEnabled, true);
  assert.equal(afterSound.name, "保存済み");

  let readFails = false;
  let persisted = stale;
  const transientReadFailure = createProfileStore({
    getItem() {
      if (readFails) throw new DOMException("blocked", "SecurityError");
      return persisted;
    },
    setItem(_key, value) { persisted = value; },
    removeItem() { persisted = null; },
  }, "test");
  transientReadFailure.load();
  transientReadFailure.update({ practiceCompleted: true });
  readFails = true;
  const afterReadFailure = transientReadFailure.update({ soundEnabled: true });
  assert.equal(afterReadFailure.practiceCompleted, true);
  assert.equal(afterReadFailure.soundEnabled, true);
  assert.equal(afterReadFailure.name, "保存済み");
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

test("M6 result hints use player-facing operation words instead of internal tick units", () => {
  const firstHint = resultHintFor({ score: 0, stats: {} });
  const chainHint = resultHintFor({ score: 1_000, stats: { maxChain: 5, directTargets: 1, chainTargets: 9 } });
  assert.match(firstHint, /指を押したまま少し待ってから離して/);
  assert.match(chainHint, /短い待ち時間に次の花火を準備/);
  assert.doesNotMatch(`${firstHint} ${chainHint}`, /\btick\b/i);
});

test("score guide exposes every addition, zero deductions, and all blast radii", () => {
  const guide = scoreGuideModel(DEFAULT_RULES);
  assert.match(guide.direct, new RegExp(String(DEFAULT_RULES.directScore)));
  assert.match(guide.preparation, new RegExp(String(DEFAULT_RULES.preparationScoreCap)));
  assert.match(guide.forecast, new RegExp(String(DEFAULT_RULES.forecastPlanBonus).replace("1000", "1,000")));
  assert.match(guide.forecast, /ちょうど5個/);
  assert.match(guide.forecast, /金色の二重リング3個以上/);
  assert.match(guide.penalty, /減点はありません/);
  assert.match(guide.selection, /1本指/);
  assert.match(guide.selection, /0\.05秒（3更新）/);
  assert.match(guide.selection, /外輪が一周/);
  assert.match(guide.selection, /2\.5秒で、3個以上は自動起爆、3個未満は取消/);
  assert.match(guide.choices, /同色4個以上/);
  assert.deepEqual(explosionRangeRows(DEFAULT_RULES).map((row) => row.count), [3, 4, 5, 6]);
  assert.deepEqual(
    explosionRangeRows(DEFAULT_RULES).map((row) => row.radius),
    [1_800, 2_070, 2_340, 2_520],
  );
});

test("result score breakdown reconciles score ledgers without hiding bonus sources", () => {
  const breakdown = scoreBreakdownFor({
    scoreEvents: [
      { kind: "direct", baseAmount: 300, inclusionAmount: 40, forecastPlanAmount: 0 },
      { kind: "chain", baseAmount: 168, inclusionAmount: 0, forecastPlanAmount: 150 },
    ],
    bonusEvents: [
      { preparationAmount: 240, forecastPlanAmount: 1_000, detonationAmount: 0, comboAmount: 0 },
    ],
  });
  assert.deepEqual(breakdown, {
    direct: 300,
    chain: 168,
    inclusion: 40,
    preparation: 240,
    forecast: 1_150,
    other: 0,
    deductions: 0,
    total: 1_898,
  });
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
  assert.equal(PRACTICE_SECONDS, 18);
});

test("sound unlock resumes WebKit-style suspended audio and survives off-on", async () => {
  const { context, stats } = fakeAudioContext({ initialState: "suspended" });
  const sound = new SoundController({ enabled: true, contextFactory: () => context });
  assert.equal(await sound.unlock(), true);
  assert.equal(context.state, "running");
  assert.equal(stats.resumes, 1);
  assert.equal(sound.tap(), true);

  sound.setEnabled(false);
  await Promise.resolve();
  assert.equal(context.state, "suspended");
  sound.setEnabled(true);
  assert.equal(await sound.unlock(), true);
  assert.equal(context.state, "running");
  assert.ok(stats.resumes >= 2);
  assert.equal(stats.suspends, 1);
  sound.destroy();
});

test("desktop sound is layered while all sound variants obey their voice ceiling", () => {
  const touchAudio = fakeAudioContext();
  const desktopAudio = fakeAudioContext();
  const touch = new SoundController({
    enabled: true,
    variant: "touch",
    contextFactory: () => touchAudio.context,
    now: () => 1_000,
  });
  const desktop = new SoundController({
    enabled: true,
    variant: "desktop",
    contextFactory: () => desktopAudio.context,
    now: () => 1_000,
  });
  assert.equal(touch.detonation(), true);
  assert.equal(desktop.detonation(), true);
  assert.ok(desktopAudio.stats.oscillators > touchAudio.stats.oscillators);

  const cappedAudio = fakeAudioContext();
  const capped = new SoundController({
    enabled: true,
    variant: "desktop",
    maxVoices: 2,
    contextFactory: () => cappedAudio.context,
    now: () => 2_000,
  });
  assert.equal(capped.detonation(), true);
  assert.equal(capped.snapshot().activeVoices, 2);
  assert.equal(capped.score({ amount: 5_000 }), false);
  assert.equal(cappedAudio.stats.oscillators, 2);
  capped.destroy();
  touch.destroy();
  desktop.destroy();
});

test("sound exposes every requested operation and feedback cue", () => {
  const audio = fakeAudioContext();
  let time = 0;
  const sound = new SoundController({
    enabled: true,
    variant: "touch",
    maxVoices: 64,
    contextFactory: () => audio.context,
    now: () => { time += 200; return time; },
  });
  const methodFor = { select: "selection", detonate: "detonation" };
  for (const cue of SOUND_CUES) {
    const method = methodFor[cue] ?? cue;
    assert.equal(typeof sound[method], "function");
    assert.equal(sound[method]({ count: 4, depth: 2, milestone: 10, amount: 1_000 }), true);
  }
  assert.equal(audio.stats.oscillators, SOUND_CUES.length);
  sound.destroy();
});

test("presentation events distinguish direct detonation from true chain ledger entries", () => {
  const tracker = new PresentationEventTracker({ traceDistance: 100 });
  const state = {
    gameVersion: "test",
    ruleVersion: "test-rules",
    rulesFingerprint: "same-core",
    seed: 7,
    tick: 1,
    inputFrames: [{ type: "pointer", pressed: true, x: 100, y: 200, tick: 1 }],
    waves: [{ waveIndex: 0, entities: [{ id: 1 }, { id: 2 }, { id: 3 }] }],
    fireworks: [{ id: 1, color: "red" }],
    selectedIds: [1],
    selectedColor: "red",
    lastAcquisitionTick: 1,
    lastAction: { type: "select", id: 1 },
    scoreEvents: [],
    bonusEvents: [],
    stats: { entitiesSpawned: 3, entitiesExpired: 0, maxChain: 0, selectionDrops: 0 },
  };
  const first = tracker.consume(state);
  assert.deepEqual(first.map((event) => event.type), ["tap", "select", "spawn"]);
  assert.equal(first.find((event) => event.type === "spawn")?.count, 3);

  state.tick = 2;
  state.inputFrames.push({ type: "pointer", pressed: false, x: 140, y: 220, tick: 2 });
  state.selectedIds = [];
  state.lastAcquisitionTick = null;
  state.lastAction = { type: "detonate", actionId: 2, count: 7 };
  state.scoreEvents.push({
    kind: "direct",
    actionId: 2,
    eventId: 1,
    fireTick: 2,
    depth: 0,
    amount: 100,
  });
  state.stats.maxChain = 3;
  const direct = tracker.consume(state);
  assert.ok(direct.some((event) => event.type === "detonate" && event.count === 7));
  assert.equal(direct.some((event) => event.type === "chain"), false);
  assert.ok(direct.some((event) => event.type === "score" && event.amount === 100));

  state.tick = 3;
  state.scoreEvents.push(
    { kind: "chain", actionId: 2, eventId: 2, fireTick: 3, generation: 1, amount: 300 },
    { kind: "chain", actionId: 2, eventId: 3, fireTick: 3, generation: 1, amount: 350 },
  );
  state.bonusEvents.push({ actionId: 2, eventId: 4, fireTick: 3, amount: 120 });
  state.stats.maxChain = 5;
  state.stats.entitiesExpired = 2;
  const chained = tracker.consume(state);
  const chain = chained.find((event) => event.type === "chain");
  assert.deepEqual(chain, {
    type: "chain",
    actionId: 2,
    fireTick: 3,
    depth: 1,
    count: 2,
    amount: 650,
  });
  assert.ok(chained.some((event) => event.type === "milestone" && event.milestone === 5));
  assert.ok(chained.some((event) => event.type === "expire" && event.count === 2));
  assert.ok(chained.some((event) => event.type === "score" && event.amount === 770));

  state.tick = 4;
  state.stats.selectionDrops = 1;
  state.lastAction = { type: "ignored", reason: "timeout" };
  const dropped = tracker.consume(state);
  assert.ok(dropped.some((event) => event.type === "cancel" && event.count === 1));

  const cloned = JSON.parse(JSON.stringify(state));
  assert.deepEqual(tracker.consume(cloned), []);
  assert.equal(JSON.stringify(state), JSON.stringify(cloned));
});

test("presentation trace follows the sampled pointer path within one fixed tick", () => {
  const tracker = new PresentationEventTracker({ traceDistance: 100 });
  const state = {
    gameVersion: "test",
    ruleVersion: "test-rules",
    rulesFingerprint: "same-core",
    seed: 8,
    tick: 0,
    inputFrames: [{ type: "pointer", pressed: true, x: 0, y: 0, tick: 0 }],
    waves: [],
    fireworks: [],
    selectedIds: [],
    scoreEvents: [],
    bonusEvents: [],
    stats: { entitiesSpawned: 0, entitiesExpired: 0, maxChain: 0, selectionDrops: 0 },
  };
  assert.deepEqual(tracker.consume(state).map((event) => event.type), ["tap"]);

  state.tick = 1;
  state.inputFrames.push({
    type: "pointer",
    pressed: true,
    x: 0,
    y: 100,
    tick: 1,
    path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
  });
  const events = tracker.consume(state);
  assert.deepEqual(events.map((event) => event.type), ["trace"]);
  assert.equal(events[0].distance, 300);
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

test("M6 practice adds a short moving chain lesson without changing play rules", () => {
  assert.equal(PRACTICE_STAGE_COUNT, 2);
  assert.deepEqual(practiceStageDurationsFor(18), [8, 10]);
  assert.equal(PRACTICE_STAGE_TWO_TARGETS.length, 3);
  assert.equal(PRACTICE_CHAIN_TARGET.selectable, false);

  const initial = practiceTargetsAt(2, 0);
  const later = practiceTargetsAt(2, 60);
  assert.equal(initial.length, 4);
  assert.equal(initial.filter((target) => target.selectable !== false).length, 3);
  assert.equal(initial.at(-1).id, PRACTICE_CHAIN_TARGET.id);
  assert.notDeepEqual(
    initial.slice(0, 3).map(({ x, y }) => [x, y]),
    later.slice(0, 3).map(({ x, y }) => [x, y]),
  );

  const chainPoint = practiceTargetBoardPoint(PRACTICE_CHAIN_TARGET);
  assert.equal(findPracticeCandidate(chainPoint, [], {}, { stage: 2, tick: 0 }), null);
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

test("play feedback explains an incomplete tap and the remaining target count", () => {
  const element = { textContent: "" };
  updatePlayMessage(element, { selectedIds: [1, 2], lastAction: { type: "select" } });
  assert.equal(element.textContent, "あと1個つないで起爆");
  updatePlayMessage(element, {
    selectedIds: [],
    lastAction: { type: "selection-cleared", reason: "release-below-minimum" },
  });
  assert.match(element.textContent, /3個未満のため取消/);
  updatePlayMessage(element, { selectedIds: [1, 2, 3], lastAction: { type: "select" } });
  assert.equal(element.textContent, "指を離すか2.5秒で自動起爆");
});
