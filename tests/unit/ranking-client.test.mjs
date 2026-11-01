import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRankingClient,
  createPendingSubmissionStore,
  normalizeRankingRows,
  RankingClientError,
} from "../../src/ranking/client.js";
import { setLanguage } from "../../src/i18n/index.js";
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
    { accepted:true,duplicate:false,start_id:ids.start,play_id:ids.play,display_name:"花火",normalized_name:"花火",game_slug:"hanabin",client_version:RANKING_CONFIG.clientVersion },
    {accepted:true,duplicate:false,play_id:ids.play,result_type:"game_over",game_slug:"hanabin",score:1234,reached_wave:3},
    [{
      accepted: true,
      result_submission_id: ids.submission,
      result_play_id: ids.play,
      result_normalized_name:"花火", result_display_name:"花火",result_first_score:1234,is_first_play:true,is_new_best:true,
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

test("ranking rows preserve server ties and typed fields without inventing missing data",()=>{
 const rows=normalizeRankingRows(Array.from({length:12},(_,i)=>({rank_no:i<2?1:i+1,display_name:i===1?'同名':'A',best_score:900-i,play_count:5})),10);
 assert.equal(rows.length,10);assert.equal(rows[1].rankNo,1);assert.equal(rows[0].score,900);
 assert.throws(()=>normalizeRankingRows([{rank_no:1,display_name:'A',best_score:'900'}]));
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

test("localized rejection labels never become internal error identifiers", async()=>{
 const client=createRankingClient({storage:null,fetchImpl:async()=>response({accepted:false})});
 setLanguage('ko',{storage:null});
 try {await assert.rejects(()=>client.startPlay({startId:ids.start,displayName:'Player'}),error=>error.code==='request_rejected');}
 finally {setLanguage('ja',{storage:null});}
});


test('independent: missing acceptance is retryable for start and finish, not permanent rejection',async()=>{for(const payload of [{},{accepted:'true'},{accepted:null}]){const c=createRankingClient({storage:null,fetchImpl:async()=>response(payload)});for(const action of [()=>c.startPlay({startId:ids.start,displayName:'A'}),()=>c.finishPlay({playId:ids.play,displayName:'A',resultType:'game_over',reachedWave:1,score:1})])await assert.rejects(action,e=>e.retryable===true)}});
test('independent: malformed server play UUID is retryable, valid request IDs remain unchanged',async()=>{const c=createRankingClient({storage:null,fetchImpl:async()=>response({accepted:true,play_id:'bad'})});await assert.rejects(()=>c.startPlay({startId:ids.start,displayName:'A'}),e=>e.retryable===true)});
test('independent: request timeout covers a stalled response body, not just headers',async()=>{const c=createRankingClient({config:{...RANKING_CONFIG,timeoutMs:5},storage:null,fetchImpl:async(_url,{signal})=>({ok:true,status:200,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted body'),{name:'AbortError'})))),text:async()=>{throw Error('body unavailable')}})});const outcome=await Promise.race([c.fetchTopRanking().then(()=> 'accepted',e=>e.code),new Promise(resolve=>setTimeout(()=>resolve('still-pending'),30))]);assert.notEqual(outcome,'still-pending')});

test('independent: v1 same-ID different payload is not shadowed by a new v3 record',()=>{const values=new Map();const storage={get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const old={submissionId:ids.submission,startId:ids.start,playId:ids.play,displayName:'A',score:10,resultType:'game_over',reachedWave:1};const raw=JSON.stringify(old);storage.setItem(RANKING_CONFIG.pendingSubmissionStorageKey,raw);const c=createRankingClient({storage});assert.throws(()=>c.savePendingSubmission({...old,score:20}),e=>e.code==='pending_conflict');assert.equal(storage.getItem(RANKING_CONFIG.pendingSubmissionStorageKey),raw);assert.equal(storage.getItem(RANKING_CONFIG.pendingSubmissionStorageKey+':entry:v3:'+ids.submission),null)});
