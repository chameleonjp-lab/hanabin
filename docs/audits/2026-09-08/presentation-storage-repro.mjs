import assert from 'node:assert/strict';
import { GameController } from '../../../src/game/controller.js';
import { createProfileStore } from '../../../src/storage/local-storage.js';
import { createRankingStore } from '../../../src/storage/local-ranking.js';
import { SoundController } from '../../../src/audio/sound.js';

const backing = new Map();
const storage = {
  getItem: key => backing.get(key) ?? null,
  setItem: (key, value) => backing.set(key, value),
  removeItem: key => backing.delete(key),
};
const profileA = createProfileStore(storage);
profileA.save({ name: 'Player', bestScore: 100, bestChain: 1, bestRuleVersion: 'm4-gameplay-3' });
const profileB = createProfileStore(storage);
const staleProfileB = profileB.load();
profileA.update({ bestScore: 1000, bestChain: 10 });
const ranking = createRankingStore(storage);
const controller = Object.assign(Object.create(GameController.prototype), {
  root: { querySelector: () => null },
  profileStore: profileB,
  profile: staleProfileB,
  rankingStore: ranking,
  rules: { ruleVersion: 'm4-gameplay-3' },
  session: {
    state: { seed: 1, actionCount: 3600, score: 200, finalScore: 200,
      stats: { maxChain: 2 }, status: 'finished' },
    replayCheck: { ok: true },
  },
  updateHomeBest: () => {},
});
controller.populateResult();
assert.equal(profileA.load().bestScore, 200);
assert.equal(profileA.load().bestChain, 2);
console.log('CONFIRMED: stale tab lowers persisted best 1000/10 ->', profileA.load().bestScore, profileA.load().bestChain);

// Emulate the exact profile migration branch from controller lines 71-77.
const upgradedProfile = createProfileStore(storage);
const nextRuleVersion = 'audit-future-rule';
if (upgradedProfile.load().bestRuleVersion !== nextRuleVersion) {
  upgradedProfile.update({ bestScore: 0, bestChain: 0, bestRuleVersion: nextRuleVersion });
}
assert.equal(upgradedProfile.load().bestScore, 0);
assert.equal(createRankingStore(storage).list()[0].score, 200);
console.log('CONFIRMED conditional future migration: profile best resets; unversioned ranking retains prior-rule score', createRankingStore(storage).list());

controller.lastPersistedResultKey = '';
controller.session.state.seed = 2;
controller.session.state.score = controller.session.state.finalScore = 900;
controller.session.replayCheck = { ok: false, stateMatch: false, scoreMatch: false };
controller.populateResult();
assert.equal(ranking.list()[0].score, 900);
console.log('CONFIRMED conditional replay mismatch: finished result with replayCheck.ok=false is still recorded', ranking.list()[0]);

let resumeCalls = 0;
const context = { state: 'interrupted', resume: async () => { resumeCalls++; context.state = 'running'; } };
const sound = new SoundController({ enabled: true, contextFactory: () => context });
const unlocked = await sound.unlock();
assert.equal(unlocked, true);
assert.equal(resumeCalls, 0);
assert.equal(context.state, 'interrupted');
console.log('CONFIRMED stub branch only; real iPhone NOT tested: unlock reports true in interrupted state without calling resume');
