import {test,expect} from '@playwright/test';
test('durable result refuses quota, recovers one exact receipt and reload never resubmits it',async({page})=>{
 const calls=[];const playId='22222222-2222-4222-8222-222222222222';
 await page.route('**/rest/v1/**',async route=>{const fn=route.request().url().split('/').pop(),p=route.request().postDataJSON();calls.push({fn,p});
 let data;
 if(fn==='start_game_play_v1')data={accepted:true,duplicate:false,start_id:p.p_start_id,play_id:playId,game_slug:p.p_game_slug,display_name:p.p_display_name,normalized_name:p.p_display_name,client_version:p.p_client_version};
 else if(fn==='finish_game_play_v1')data={accepted:true,duplicate:false,play_id:p.p_play_id,game_slug:p.p_game_slug,result_type:p.p_result_type,reached_wave:p.p_reached_wave,score:p.p_score};
 else if(fn==='submit_score_idempotent_v1')data=[{accepted:true,result_submission_id:p.p_submission_id,result_play_id:p.p_play_id,result_display_name:p.p_display_name,result_normalized_name:p.p_display_name,result_first_score:p.p_score,result_best_score:p.p_score,result_play_count:1,is_first_play:true,is_new_best:true,was_duplicate:false}];
 else {expect(fn).toBe('get_best_score_ranking');data=[];}
 await route.fulfill({json:data});});
 await page.goto('/?e2e=1');
 const failed=await page.evaluate(async()=>{
 const {GameController}=await import('/src/game/controller.js'),{createRankingClient}=await import('/src/ranking/client.js');
 let quota=true;const storage={get length(){return localStorage.length},key:i=>localStorage.key(i),getItem:k=>localStorage.getItem(k),removeItem:k=>localStorage.removeItem(k),setItem(k,v){if(quota)throw new DOMException('Quota','QuotaExceededError');localStorage.setItem(k,v)}};
 const client=createRankingClient({storage});const c=Object.assign(Object.create(GameController.prototype),{destroyed:false,deterministicTestMode:false,profile:{name:'Fixed'},rankingClient:client,startGameplay(){return'playing'},session:{replayCheck:{ok:true}},currentResultKey:'result',populateResult(){}});
 c.start(1);await c.rankingPlay.startPromise;const state={status:'finished',finalScore:1234,stats:{wavesSpawned:4}};await c.syncRankingResult(state,'result');window.receiptFixture={c,client,state,recover(){quota=false}};return{warning:c.rankingStorageFailed,status:c.rankingStatus};
 });
 expect(failed.warning).toBe(true);expect(failed.status).toBe('retryable_failed');
 expect(calls.filter(x=>x.fn==='finish_game_play_v1')).toHaveLength(0);expect(calls.filter(x=>x.fn==='submit_score_idempotent_v1')).toHaveLength(0);
 const result=await page.evaluate(async()=>{const {c,client,state,recover}=window.receiptFixture;recover();await c.syncRankingResult(state,'result');await c.syncRankingResult(state,'result');return{final:c.rankingStatus,id:c.rankingPlay.submission.submissionId,pending:client.listPendingSubmissions()}});
expect(result.final).toBe('submitted');expect(result.pending).toEqual([]);
 expect(calls.filter(x=>x.fn==='finish_game_play_v1')).toHaveLength(1);const submits=calls.filter(x=>x.fn==='submit_score_idempotent_v1');expect(submits).toHaveLength(1);expect(submits[0].p.p_submission_id).toBe(result.id);expect(submits[0].p.p_score).toBe(1234);
 await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-state','home');
 const restored=await page.evaluate(async()=>{const {GameController}=await import('/src/game/controller.js'),{createRankingClient}=await import('/src/ranking/client.js');const c=Object.assign(Object.create(GameController.prototype),{rankingClient:createRankingClient()});return c.resumePendingRankingSubmission()});expect(restored).toBe(true);expect(calls.filter(x=>x.fn==='finish_game_play_v1')).toHaveLength(1);expect(calls.filter(x=>x.fn==='submit_score_idempotent_v1')).toHaveLength(1);
});
