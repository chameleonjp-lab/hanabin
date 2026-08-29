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
