import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameController} from '../../src/game/controller.js';
import {GameSession} from '../../src/game/session.js';
import {createRankingClient} from '../../src/ranking/client.js';
import {RANKING_CONFIG} from '../../src/config/ranking.js';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const makeController=client=>Object.assign(Object.create(GameController.prototype),{
 destroyed:false,deterministicTestMode:false,profile:{name:'開始時の名前'},rankingClient:client,
 startGameplay(seed){this.startedSeed=seed;this.countdownStartedMs=100;this.session.phase='countdown';return 'countdown';},
 session:{replayCheck:{ok:true},updateCountdown(){this.phase='playing';}},currentResultKey:'result',populateResult(){},
 renderer:{observeAnimationFrame(){}},updateCountdownPresentation(){},render(){},ensureLoop(){},
});
const finished={status:'finished',finalScore:1234,stats:{wavesSpawned:4}};

test('named play starts before a pending network response and late response keeps its own snapshot',async()=>{
 const pending=defer();const calls=[];
 const c=makeController({startPlay(request){calls.push(request);return pending.promise;}});
 assert.equal(c.start(7),'countdown');const play=c.rankingPlay;
 c.frame(3100);assert.equal(c.phase,'playing');
 c.profile.name='別の名前';await Promise.resolve();
 assert.equal(calls[0].displayName,'開始時の名前');assert.equal(c.startedSeed,7);
 pending.resolve({playId:'server-play'});await play.startPromise;
 assert.equal(play.displayName,'開始時の名前');assert.equal(play.playId,'server-play');
});

test('failed start retains final result and reuses IDs on retry without blocking another game',async()=>{
 const starts=[],submits=[],finishes=[],saved=[];let offline=true;
 const c=makeController({
  async startPlay(request){starts.push({...request});if(offline)throw Error('offline');return {playId:'accepted-play'};},
  savePendingSubmission(value){saved.push({...value});},clearPendingSubmission(){},
  async finishPlay(value){finishes.push(value);},async submitScore(value){submits.push(value);},
  async fetchTopRanking(limit){assert.equal(limit,30);return [{name:'ranking'}];},
 });
 assert.equal(c.start(8),'countdown');c.frame(3100);const play=c.rankingPlay;await play.startPromise;
 await c.syncRankingResult(finished,'result');
 assert.equal(c.rankingStatus,'retryable_failed');assert.equal(c.rankingEntries[0].name,'ranking');
 assert.equal(saved[0].score,1234);assert.equal(saved[0].displayName,'開始時の名前');
 c.profile.name='後の名前';offline=false;
 await c.syncRankingResult(finished,'result');await c.syncRankingResult(finished,'result');
 assert.equal(c.rankingStatus,'submitted');assert.equal(finishes.length,1);assert.equal(submits.length,1);
 assert.ok(starts.every(value=>value.startId===starts[0].startId));assert.ok(starts.every(value=>value.displayName==='開始時の名前'));
 assert.equal(submits[0].submissionId,saved[0].submissionId);assert.equal(submits[0].score,1234);
});

test('old asynchronous submission cannot replace a later result or its participant',async()=>{
 const pending=defer();const calls=[];
 const c=makeController({async startPlay(){return {playId:'old'};},savePendingSubmission(){},clearPendingSubmission(){},
  async finishPlay(request){calls.push(request);},async submitScore(request){calls.push(request);},fetchTopRanking(){return pending.promise;}});
 c.start(1);c.frame(3100);const old=c.rankingPlay;await old.startPromise;
 const sync=c.syncRankingResult(finished,'result');await new Promise(resolve=>setImmediate(resolve));
 c.profile.name='new';c.start(2);c.currentResultKey='new-result';c.rankingEntries=['new'];
 pending.resolve(['old']);await sync;
 assert.deepEqual(c.rankingEntries,['new']);assert.equal(c.rankingPlay.displayName,'new');assert.ok(calls.every(request=>request.displayName==='開始時の名前'));
});

test('additive pending queue imports the legacy record and clears only acknowledged IDs across reload',()=>{
 const values=new Map();const storage={get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const legacy={submissionId:'legacy',playId:'old',displayName:'旧名',score:12};storage.setItem(RANKING_CONFIG.pendingSubmissionStorageKey,JSON.stringify(legacy));
 const c=createRankingClient({storage});c.savePendingSubmission({submissionId:'one',startId:'start-one',displayName:'名前1',score:34});c.savePendingSubmission({submissionId:'two',startId:'start-two',displayName:'名前2',score:56});
 assert.deepEqual(c.listPendingSubmissions().map(value=>value.submissionId),['legacy','one','two']);c.clearPendingSubmission('one');
 const reloaded=createRankingClient({storage});assert.deepEqual(reloaded.listPendingSubmissions().map(value=>value.submissionId),['legacy','two']);
 assert.deepEqual(JSON.parse(storage.getItem(RANKING_CONFIG.pendingSubmissionStorageKey)),legacy);reloaded.clearPendingSubmission('legacy');
 assert.notEqual(storage.getItem(RANKING_CONFIG.pendingSubmissionStorageKey),null); // Legacy data remains acknowledged by an ID tombstone.assert.equal(reloaded.loadPendingSubmission().submissionId,'two');
});

test('reload resumes a finalized offline play using captured IDs; retired results never submit scores',async()=>{
 const calls=[];let pending={submissionId:'submission',startId:'start',displayName:'captured',score:0,resultType:'retire',reachedWave:1};
 const c=makeController({loadPendingSubmission:()=>pending,
  async startPlay(value){calls.push(['start',value]);return {playId:'accepted'};},savePendingSubmission(value){pending=value;},
  async finishPlay(value){calls.push(['finish',value]);},async submitScore(){throw Error('retire must not submit');},clearPendingSubmission(){pending=null;}});
 assert.equal(await c.resumePendingRankingSubmission(),true);assert.deepEqual(calls.map(x=>x[0]),['start','finish']);
 assert.equal(calls[0][1].startId,'start');assert.equal(calls[1][1].displayName,'captured');
});

test('an old completion cannot clear a newer synchronization with the same result key',async()=>{
 const old=defer(),current=defer();let updates=0;
 const c=makeController({});c.rankingPlay={playId:'old'};c.updateRankingUi=()=>{updates++;};
 c.syncRankingResult=()=>old.promise;
 const first=c.beginRankingSync(finished,'same');
 c.rankingPlay={playId:'new'};c.currentResultKey='same';c.syncRankingResult=()=>current.promise;
 const second=c.beginRankingSync(finished,'same',{force:true});
 old.resolve();await first;assert.equal(c.rankingSyncPromise,second);assert.equal(updates,2);
 current.resolve();await second;assert.equal(c.rankingSyncPromise,null);assert.equal(updates,3);
});

test('separate clients preserve independent pending IDs and acknowledge only one legacy or new record',()=>{
 const values=new Map();const writes=[];const storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem(k,v){writes.push(k);values.set(k,v);},removeItem:k=>values.delete(k)};
 const key=RANKING_CONFIG.pendingSubmissionStorageKey;
 storage.setItem(key,JSON.stringify({submissionId:'legacy',playId:'old',score:1}));
 storage.setItem(key+':queue:v2',JSON.stringify([{submissionId:'v2',playId:'old-v2',score:2}]));
 const a=createRankingClient({storage}),b=createRankingClient({storage});
 a.savePendingSubmission({submissionId:'a',playId:'play-a',score:3});b.savePendingSubmission({submissionId:'b',playId:'play-b',score:4});
 const beforeV1=storage.getItem(key),beforeV2=storage.getItem(key+':queue:v2');writes.length=0;
 a.clearPendingSubmission('a');b.savePendingSubmission({submissionId:'c',playId:'play-c',score:5});
 a.clearPendingSubmission('legacy');a.clearPendingSubmission('v2');
 assert.ok(writes.every(k=>k.includes(':entry:v3:')));assert.equal(storage.getItem(key),beforeV1);assert.equal(storage.getItem(key+':queue:v2'),beforeV2);
 assert.deepEqual(createRankingClient({storage}).listPendingSubmissions().map(x=>x.submissionId).sort(),['b','c']);
 assert.deepEqual(b.listPendingSubmissions().map(x=>x.submissionId).sort(),['b','c']);
});


test('storage rejection keeps result and prevents finish/submit until durable retry',async()=>{
 let durable=false,finishes=0,submits=0;const c=makeController({async startPlay(){return{playId:'accepted-play'}},savePendingSubmission:value=>({...value,persisted:durable}),clearPendingSubmission(){},async finishPlay(){finishes++},async submitScore(){submits++},async fetchTopRanking(){return[]}});
 c.start(1);c.frame(3100);await c.rankingPlay.startPromise;await c.syncRankingResult(finished,'result');assert.equal(finishes,0);assert.equal(submits,0);assert.equal(c.rankingStorageFailed,true);durable=true;await c.syncRankingResult(finished,'result');assert.equal(finishes,1);assert.equal(submits,1);assert.equal(c.rankingStorageFailed,false);
});
test('reload refuses malformed pending result without synthesizing a successful game',async()=>{let calls=0;const client=createRankingClient({storage:null,fetchImpl:async()=>{calls++;throw Error('network')}});client.savePendingSubmission({submissionId:'broken',score:'1',displayName:'A'});const c=makeController(client);await c.resumePendingRankingSubmission();assert.equal(calls,0)});

const fixture = (name = '開始時の名前', deterministic = false) => {
  const requests = [];
  const session = new GameSession();
  const controller = Object.assign(Object.create(GameController.prototype), {
    destroyed: false, deterministicTestMode: deterministic, profile: {name},
    session, renderer: {observeAnimationFrame() {}}, render() {},
    updateCountdownPresentation() {}, ensureLoop() {},
    startGameplay(seed) { session.prepare(seed); this.countdownStartedMs = 100; },
    rankingClient: {async startPlay(request) { requests.push(request); return {playId: 'accepted'}; }},
  });
  return {controller, requests, session};
};

test('only the real GO frame writes one named start with its captured name', async () => {
  const {controller: c, requests, session} = fixture();
  c.start(1);
  await Promise.resolve();
  assert.equal(session.phase, 'countdown');
  assert.equal(requests.length, 0);
  c.frame(3099);
  assert.equal(session.phase, 'countdown');
  assert.equal(requests.length, 0);
  c.profile.name = '後の名前';
  c.frame(3100);
  assert.equal(session.phase, 'playing');
  await c.rankingPlay.startPromise;
  assert.deepEqual(requests.map(r => r.displayName), ['開始時の名前']);
  assert.equal(requests[0].startId, c.rankingPlay.startId);
  assert.equal(c.rankingPlay.playId, 'accepted');
});

test('cancelled and paused countdowns do not write; only the replacement visible GO can write', async () => {
  const {controller: c, requests, session} = fixture();
  c.start(1);
  c.clockPaused = true;
  c.frame(10000);
  assert.equal(session.phase, 'countdown');
  session.goHome();
  c.frame(10001);
  await Promise.resolve();
  assert.equal(requests.length, 0);
  c.profile.name = '次の名前';
  c.clockPaused = false;
  c.start(2);
  c.frame(3100);
  await c.rankingPlay.startPromise;
  assert.deepEqual(requests.map(r => r.displayName), ['次の名前']);
});

test('guest and deterministic GO never invent a named start record', async () => {
  for (const [name, deterministic] of [['', false], ['named', true]]) {
    const {controller: c, requests} = fixture(name, deterministic);
    c.start(1);
    c.frame(3100);
    await Promise.resolve();
    assert.deepEqual(requests, []);
  }
});

test('a canceled animation callback cannot advance a replacement countdown', async (t) => {
  const {controller: c, requests, session} = fixture();
  delete c.ensureLoop;
  c.rafId = null;
  const callbacks = [];
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  t.after(() => {
    globalThis.requestAnimationFrame = previousRAF;
    globalThis.cancelAnimationFrame = previousCancel;
  });
  globalThis.requestAnimationFrame = callback => callbacks.push(callback);
  globalThis.cancelAnimationFrame = () => {};
  c.start(1);
  c.ensureLoop();
  c.stopLoop();
  c.start(2);
  c.ensureLoop();
  callbacks[0](3100);
  assert.equal(session.phase, 'countdown');
  assert.equal(c.rafId, 2);
  callbacks[1](3100);
  assert.equal(session.phase, 'playing');
  await c.rankingPlay.startPromise;
  assert.equal(requests.length, 1);
});

test('a hidden frame before visibility handler is paused and resumes without counting background time', async (t) => {
  const {controller: c, requests, session} = fixture();
  const prior = globalThis.document;
  t.after(() => { globalThis.document = prior; });
  globalThis.document = {visibilityState: 'hidden'};
  c.renderer.resetFrameObservation = () => {};
  c.updateResumePresentation = () => {};
  c.rafId = null;
  c.start(1);
  c.countdownPausedAtMs = null;
  c.frame(3100);
  assert.equal(c.clockPaused, true);
  assert.equal(session.phase, 'countdown');
  assert.equal(requests.length, 0);
  c.countdownPausedAtMs -= 4000;
  document.visibilityState = 'visible';
  c.resumeClock();
  assert.ok(c.countdownStartedMs >= 4100);
  c.frame(c.countdownStartedMs + 2999);
  assert.equal(requests.length, 0);
  assert.equal(session.phase, 'countdown');
  c.frame(c.countdownStartedMs + 3000);
  assert.equal(session.phase, 'playing');
  await c.rankingPlay.startPromise;
  assert.equal(requests.length, 1);
});
