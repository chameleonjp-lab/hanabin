import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRankingClient,
  createPendingSubmissionStore,
  normalizeRankingRows,
  RankingClientError,
} from "../../src/ranking/client.js";
import { RANKING_CONFIG } from "../../src/config/ranking.js";

const ids = {
  start: "11111111-1111-4111-8111-111111111111",
  play: "22222222-2222-4222-8222-222222222222",
  submission: "33333333-3333-4333-8333-333333333333",
};

const fakeStorage = () => {
  let value = null;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    removeItem() { value = null; },
  };
};

const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return payload; },
});

test("ranking client uses the shared idempotent RPC contract in order", async () => {
  const calls = [];
  const payloads = [
    { accepted: true, duplicate: false, play_id: ids.play, display_name: "花火" },
    { accepted: true, duplicate: false, play_id: ids.play, result_type: "game_over" },
    [{
      accepted: true,
      result_submission_id: ids.submission,
      result_play_id: ids.play,
      result_best_score: 1_234,
      result_play_count: 2,
      was_duplicate: false,
    }],
    [{ rank_no: 1, display_name: "花火", best_score: 1_234, play_count: 2 }],
  ];
  const client = createRankingClient({
    storage: fakeStorage(),
    config: { ...RANKING_CONFIG, rpcBaseUrl: "https://example.test/rpc" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response(payloads.shift());
    },
  });

  const started = await client.startPlay({ startId: ids.start, displayName: " 花火 " });
  await client.finishPlay({
    playId: started.playId,
    displayName: started.displayName,
    resultType: "game_over",
    reachedWave: 3,
    score: 1_234,
  });
  const submitted = await client.submitScore({
    playId: ids.play,
    submissionId: ids.submission,
    displayName: "花火",
    score: 1_234,
  });
  const ranking = await client.fetchTopRanking(10);

  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /start_game_play_v1$/);
  assert.equal(calls[0].body.p_start_id, ids.start);
  assert.equal(calls[0].body.p_display_name, "花火");
  assert.equal(calls[1].body.p_play_id, ids.play);
  assert.equal(calls[1].body.p_result_type, "game_over");
  assert.equal(calls[2].body.p_submission_id, ids.submission);
  assert.equal(calls[3].body.p_limit, 10);
  assert.equal(submitted.playCount, 2);
  assert.deepEqual(ranking, [{
    rankNo: 1,
    name: "花火",
    score: 1_234,
    firstScore: 0,
    playCount: 2,
    updatedAt: "",
  }]);
  assert.match(calls[0].options.headers.Authorization, /^Bearer sb_publishable_/);
});

test("ranking rows keep server rank and show only the requested top ten", () => {
  const rows = normalizeRankingRows([
    { rank_no: 4, display_name: "A", best_score: "900", play_count: "5" },
    { rank_no: 5, display_name: "", best_score: -4, play_count: null },
    ...Array.from({ length: 10 }, (_, index) => ({
      rank_no: index + 6,
      display_name: `N${index}`,
      best_score: index,
      play_count: 1,
    })),
  ], 10);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].rankNo, 4);
  assert.equal(rows[1].name, "名無し");
  assert.equal(rows[1].score, 0);
});

test("pending submission storage survives a normal reload and clears only its own ID", () => {
  const storage = fakeStorage();
  const store = createPendingSubmissionStore(storage, "test-pending");
  const pending = { submissionId: ids.submission, playId: ids.play, score: 42 };
  assert.deepEqual(store.save(pending), pending);
  assert.deepEqual(createPendingSubmissionStore(storage, "test-pending").load(), pending);
  assert.deepEqual(store.clear(), null);
});

test("server and network failures preserve retryability", async () => {
  const client = createRankingClient({
    config: { ...RANKING_CONFIG, rpcBaseUrl: "https://example.test/rpc" },
    fetchImpl: async () => response({ message: "busy" }, 503),
  });
  await assert.rejects(
    () => client.fetchTopRanking(),
    (error) => error instanceof RankingClientError && error.retryable === true && error.status === 503,
  );
});
