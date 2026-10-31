import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameController } from '../../src/game/controller.js';

const controller = () => Object.assign(Object.create(GameController.prototype), {
  destroyed: false, deterministicTestMode: false, profile: { name: '' },
  profileError: { hidden: true }, playerNameInput: { value: '' },
  profileStore: { update(value) { return value; } },
  startGameplay(seed) { this.started = seed; return 'playing'; },
  rankingClient: { startPlay() { throw Error('guest must not write'); } },
});
test('blank and whitespace names are optional while invalid nonempty names are rejected', () => {
  const c = controller();
  for (const value of ['', '   ', '\t']) { c.playerNameInput.value=value; assert.equal(c.validateNameField(), true); }
  c.playerNameInput.value='x'.repeat(13); assert.equal(c.validateNameField(), false);
  assert.equal(c.setPlayerName(' '), true); assert.equal(c.profile.name, '');
});
test('guest starts immediately without a public start and later naming does not opt in', async () => {
  const c = controller();
  assert.equal(c.start(42), 'playing');
  assert.equal(c.rankingPlay.guest, true);
  c.profile.name='later';
  c.currentResultKey='result';
  c.rankingClient.fetchTopRanking=async limit=>{ assert.equal(limit,30); return [{rank:1,name:'A'}]; };
  c.populateResult=()=>{};
  await c.syncRankingResult({status:'finished'},'result');
  assert.equal(c.rankingEntries.length,1);
  assert.equal(c.rankingPlay.displayName,'');
});
test('guest ranking failure keeps result and allows retry; stale responses cannot replace new result', async () => {
  const c=controller(); c.start(1); c.currentResultKey='guest'; c.populateResult=()=>{};
  c.rankingClient.fetchTopRanking=async()=>{throw Error('offline');};
  await c.syncRankingResult({status:'finished'},'guest');
  assert.equal(c.rankingStatus,'retryable_failed');
  let resolve;
  c.rankingClient.fetchTopRanking=()=>new Promise(r=>{resolve=r;});
  const pending=c.syncRankingResult({status:'finished'},'guest');
  c.currentResultKey='new'; c.rankingEntries=['new'];
  resolve([{rank:1,name:'old'}]); await pending;
  assert.deepEqual(c.rankingEntries,['new']);
});
