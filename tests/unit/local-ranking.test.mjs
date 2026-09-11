import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_RANKING_ENTRIES,
  RANKING_STORAGE_KEY,
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
  assert.equal(entries.every((entry) => entry.ruleVersion === ""), true);
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
    ruleVersion: "",
  }]);
  assert.deepEqual(store.list()[0].name, "花子");
});

test("local ranking separates current and legacy rule records without guessing missing versions", () => {
  const storage = fakeStorage(JSON.stringify([
    { name: "旧ルール", score: 10_000, maxChain: 8, createdAt: 1, ruleVersion: "m4-gameplay-1" },
    { name: "版不明", score: 9_000, maxChain: 7, createdAt: 2 },
    { name: "現行", score: 100, maxChain: 1, createdAt: 3, ruleVersion: "m4-gameplay-3" },
  ]));
  const store = createRankingStore(storage, "test-ranking", {
    now: () => 4,
    ruleVersion: "m4-gameplay-3",
  });

  assert.deepEqual(store.list(), [{
    name: "現行",
    score: 100,
    maxChain: 1,
    createdAt: 3,
    ruleVersion: "m4-gameplay-3",
  }]);
  assert.deepEqual(store.legacyList(), [
    {
      name: "旧ルール",
      score: 10_000,
      maxChain: 8,
      createdAt: 1,
      ruleVersion: "m4-gameplay-1",
    },
    {
      name: "版不明",
      score: 9_000,
      maxChain: 7,
      createdAt: 2,
      ruleVersion: "",
    },
  ]);

  store.record({ name: "新しい現行", score: 200, maxChain: 2 });
  const saved = JSON.parse(storage.raw());
  assert.equal(saved.length, 4);
  assert.ok(saved.some((entry) => entry.name === "旧ルール" && entry.ruleVersion === "m4-gameplay-1"));
  assert.ok(saved.some((entry) => entry.name === "版不明" && entry.ruleVersion === ""));
  assert.deepEqual(store.list().map((entry) => entry.ruleVersion), ["m4-gameplay-3", "m4-gameplay-3"]);
});

test("local ranking reads the latest current-rule records for each tab", () => {
  const storage = fakeStorage();
  const tabA = createRankingStore(storage, "shared-ranking", { ruleVersion: "m4-gameplay-3" });
  const tabB = createRankingStore(storage, "shared-ranking", { ruleVersion: "m4-gameplay-3" });

  tabA.record({ name: "高得点", score: 10_000, maxChain: 8 });
  assert.equal(tabB.list()[0].score, 10_000);
  tabB.record({ name: "低得点", score: 0, maxChain: 0 });
  assert.deepEqual(tabA.list().map((entry) => entry.score), [10_000, 0]);
});

test("local ranking keeps versioned in-memory entries when storage writes fail", () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error("quota"); },
    removeItem() {},
  };
  const store = createRankingStore(storage, "failed-ranking", {
    now: () => 0,
    ruleVersion: "m4-gameplay-3",
  });

  assert.deepEqual(store.record({ name: "保存失敗", score: 321, maxChain: 4 }), [{
    name: "保存失敗",
    score: 321,
    maxChain: 4,
    createdAt: 0,
    ruleVersion: "m4-gameplay-3",
  }]);
  assert.equal(store.list()[0].ruleVersion, "m4-gameplay-3");
});
