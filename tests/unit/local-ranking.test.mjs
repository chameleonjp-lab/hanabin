import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_RANKING_ENTRIES,
  RANKING_STORAGE_KEY,
  migrateProfileBest,
  rankingStorageKeyFor,
  createRankingStore,
} from "../../src/storage/local-ranking.js";

const fakeStorage = (initial = null) => {
  let value = initial;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    removeItem() { value = null; },
    raw() { return value; },
  };
};

const mapStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    raw(key) { return values.get(key) ?? null; },
    keys() { return [...values.keys()]; },
  };
};

test("local ranking keeps only the ordered top ten and rejects blank names", () => {
  let timestamp = 100;
  const storage = fakeStorage();
  const store = createRankingStore(storage, "test-ranking", { now: () => timestamp++ });

  assert.deepEqual(store.record({ name: " ", score: 999 }), []);
  for (let score = 0; score < MAX_RANKING_ENTRIES + 2; score += 1) {
    store.record({ name: `P${score}`, score, maxChain: score % 3 });
  }
  const entries = store.list();
  assert.equal(entries.length, MAX_RANKING_ENTRIES);
  assert.equal(entries[0].score, MAX_RANKING_ENTRIES + 1);
  assert.equal(entries.at(-1).score, 2);
  assert.equal(entries.every((entry) => entry.name !== "名無し"), true);
  assert.equal(JSON.parse(storage.raw()).length, MAX_RANKING_ENTRIES);
});

test("local ranking survives malformed storage through an in-memory fallback", () => {
  const storage = fakeStorage("{broken");
  const store = createRankingStore(storage, RANKING_STORAGE_KEY, { now: () => 42 });
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.record({ name: "花子", score: 123, maxChain: 4 }), [{
    name: "花子",
    score: 123,
    maxChain: 4,
    createdAt: 42,
  }]);
  assert.deepEqual(store.list()[0].name, "花子");
});

test("rule-scoped ranking ignores the opaque legacy area and keeps versions separate", () => {
  const storage = mapStorage({
    [RANKING_STORAGE_KEY]: JSON.stringify([{ name: "旧版", score: 90_000, maxChain: 99, createdAt: 1 }]),
  });
  const current = createRankingStore(storage, {
    ruleVersion: "m4-gameplay-3",
    now: () => 10,
  });
  const future = createRankingStore(storage, {
    ruleVersion: "m4-gameplay-4",
    now: () => 20,
  });

  assert.equal(current.key, rankingStorageKeyFor("m4-gameplay-3"));
  assert.deepEqual(current.list(), []);
  assert.deepEqual(current.best(), { name: "", score: 0, maxChain: 0, createdAt: 0 });
  current.record({ name: "現版", score: 100, maxChain: 2, runId: "current-1" });
  future.record({ name: "次版", score: 200, maxChain: 3, runId: "future-1" });
  assert.equal(current.list()[0].name, "現版");
  assert.equal(future.list()[0].name, "次版");
  assert.equal(JSON.parse(storage.raw(RANKING_STORAGE_KEY))[0].score, 90_000);
});

test("best maxChain is independent from the bounded top ten", () => {
  const storage = mapStorage();
  const store = createRankingStore(storage, { ruleVersion: "rules-test", now: () => 100 });
  for (let score = 1; score <= MAX_RANKING_ENTRIES + 1; score += 1) {
    store.record({ name: `P${score}`, score, maxChain: score, runId: `score-${score}` });
  }
  store.record({ name: "連鎖王", score: 0, maxChain: 999, runId: "chain-only" });

  assert.equal(store.list().length, MAX_RANKING_ENTRIES);
  assert.equal(store.list().some((entry) => entry.name === "連鎖王"), false);
  assert.equal(store.best().score, MAX_RANKING_ENTRIES + 1);
  assert.equal(store.best().maxChain, 999);
});

test("shared rule store merges stale tabs in either completion order", () => {
  const storage = mapStorage();
  const first = createRankingStore(storage, { ruleVersion: "shared-rules", now: () => 1 });
  const stale = createRankingStore(storage, { ruleVersion: "shared-rules", now: () => 2 });
  const high = first.recordRun({ name: "高得点", score: 1_000, maxChain: 10, runId: "high" });
  const low = stale.recordRun({ name: "古いタブ", score: 200, maxChain: 2, runId: "low" });

  assert.equal(high.best.score, 1_000);
  assert.equal(low.best.score, 1_000);
  assert.equal(first.best().score, 1_000);
  assert.equal(stale.best().maxChain, 10);
  assert.equal(first.list()[0].score, 1_000);
});

test("known profile best migrates once to its own rule bucket without creating TOP10", () => {
  const storage = mapStorage();
  const profile = {
    name: "花子",
    bestScore: 1_234,
    bestChain: 27,
    bestRuleVersion: "m4-gameplay-2",
  };
  const first = migrateProfileBest({ storage, profile, now: () => 30 });
  const second = migrateProfileBest({ storage, profile, now: () => 31 });
  const migrated = createRankingStore(storage, { ruleVersion: profile.bestRuleVersion });

  assert.equal(first.migrated, true);
  assert.equal(second.migrated, true);
  assert.equal(migrated.best().score, 1_234);
  assert.equal(migrated.best().maxChain, 27);
  assert.deepEqual(migrated.list(), []);
});

test("rule store keeps the current run in memory when saving is refused", () => {
  const storage = {
    get length() { return 0; },
    key() { return null; },
    getItem() { return null; },
    setItem() { throw new Error("quota"); },
    removeItem() {},
  };
  const store = createRankingStore(storage, { ruleVersion: "blocked-rules", now: () => 40 });
  const result = store.recordRun({ name: "保存不可", score: 42, maxChain: 4, runId: "blocked" });
  assert.equal(result.persisted, false);
  assert.equal(store.list()[0].score, 42);
  assert.equal(store.best().maxChain, 4);
});
