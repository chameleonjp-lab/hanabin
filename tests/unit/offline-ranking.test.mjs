import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameController} from '../../src/game/controller.js';
import {createRankingClient} from '../../src/ranking/client.js';
import {RANKING_CONFIG} from '../../src/config/ranking.js';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const makeController=client=>Object.assign(Object.create(GameController.prototype),{
 destroyed:false,deterministicTestMode:false,profile:{name:'開始時の名前'},rankingClient:client,
 startGameplay(seed){this.startedSeed=seed;return 'playing';},session:{replayCheck:{ok:true}},currentResultKey:'result',populateResult(){},
});
const finished={status:'finished',finalScore:1234,stats:{wavesSpawned:4}};

test('named play starts before a pending network response and late response keeps its own snapshot',async()=>{
 const pending=defer();const calls=[];
 const c=makeController({startPlay(request){calls.push(request);return pending.promise;}});
 assert.equal(c.start(7),'playing');const play=c.rankingPlay;
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
 assert.equal(c.start(8),'playing');const play=c.rankingPlay;await play.startPromise;
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
 c.start(1);const old=c.rankingPlay;await old.startPromise;
 const sync=c.syncRankingResult(finished,'result');await new Promise(resolve=>setImmediate(resolve));
 c.profile.name='new';c.start(2);c.currentResultKey='new-result';c.rankingEntries=['new'];
 pending.resolve(['old']);await sync;
 assert.deepEqual(c.rankingEntries,['new']);assert.equal(c.rankingPlay.displayName,'new');assert.ok(calls.every(request=>request.displayName==='開始時の名前'));
});

test('additive pending queue imports the legacy record and clears only acknowledged IDs across reload',()=>{
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const legacy={submissionId:'legacy',playId:'old',displayName:'旧名',score:12};storage.setItem(RANKING_CONFIG.pendingSubmissionStorageKey,JSON.stringify(legacy));
 const c=createRankingClient({storage});c.savePendingSubmission({submissionId:'one',startId:'start-one',displayName:'名前1',score:34});c.savePendingSubmission({submissionId:'two',startId:'start-two',displayName:'名前2',score:56});
 assert.deepEqual(c.listPendingSubmissions().map(value=>value.submissionId),['legacy','one','two']);c.clearPendingSubmission('one');
 const reloaded=createRankingClient({storage});assert.deepEqual(reloaded.listPendingSubmissions().map(value=>value.submissionId),['legacy','two']);
 assert.deepEqual(JSON.parse(storage.getItem(RANKING_CONFIG.pendingSubmissionStorageKey)),legacy);reloaded.clearPendingSubmission('legacy');
 assert.equal(storage.getItem(RANKING_CONFIG.pendingSubmissionStorageKey),null);assert.equal(reloaded.loadPendingSubmission().submissionId,'two');
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
