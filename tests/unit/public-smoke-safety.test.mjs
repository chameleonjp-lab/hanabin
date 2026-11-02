import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = p => readFile(new URL('../../'+p, import.meta.url), 'utf8');
test('public smoke is anonymous and installs a fail-closed network guard before navigation', async()=>{
 const source=await read('tests/e2e/m7-public-release.spec.mjs');
 assert.match(source,/installPublicSmokeNetworkGuard/);
 assert.ok(source.indexOf('await installPublicSmokeNetworkGuard') < source.indexOf('await page.goto'));
 assert.match(source, /locator\("#player-name"\)\.fill\(""\)/);
 assert.doesNotMatch(source,/fill\("公開テスト"\)/);
 assert.match(source,/expect\(network\.unexpected\)\.toEqual\(\[\]\)/);
});
test('public smoke fixes Japanese locale and disables service workers',async()=>{
 const source=await read('playwright.public.config.mjs');
 assert.match(source,/locale: "ja-JP"/);
 assert.match(source,/serviceWorkers: "block"/);
});

test('network guard never forwards writes, external reads or sockets; ranking fixture is local', async()=>{
 const {installPublicSmokeNetworkGuard}=await import('../e2e/helpers/public-smoke-network.mjs');
 let handle, websocket;
 const context={route:async(_,handler)=>{handle=handler;},routeWebSocket:async(_,handler)=>{websocket=handler;}};
 const result=await installPublicSmokeNetworkGuard(context,'https://example.test/hanabin/');
 const execute=async(method,url)=>{let action;await handle({request:()=>({method:()=>method,url:()=>url}),continue:()=>{action='continue';},fetch:async()=>({status:()=>200}),fulfill:body=>{action=body.response?'static-fulfilled':body;},abort:()=>{action='abort';}});return action;};
 assert.equal(await execute('GET','https://example.test/hanabin/src/main.js'),'static-fulfilled');
 assert.equal(await execute('POST','https://example.test/hanabin/write'),'abort');
 assert.equal(await execute('GET','https://api.test/collect'),'abort');
 for(const rpc of ['start_game_play_v1','finish_game_play_v1','submit_score_idempotent_v1']) assert.equal(await execute('POST','https://api.test/rest/v1/rpc/'+rpc),'abort');
 assert.deepEqual(await execute('POST','https://api.test/rest/v1/rpc/get_best_score_ranking'),{status:200,contentType:'application/json',body:'[]'});
 let closed=false;websocket({url:()=> 'wss://api.test/realtime',close:()=>{closed=true;}});
 assert.ok(closed);assert.equal(result.unexpected.length,6);assert.equal(result.mockedRankingReads.length,1);
});

test('allowed static GET never follows an HTTP redirect to a live service',async()=>{
 const {installPublicSmokeNetworkGuard}=await import('../e2e/helpers/public-smoke-network.mjs');
 let handle,action,fetchOptions;
 const network=await installPublicSmokeNetworkGuard({route:async(_,h)=>{handle=h;},routeWebSocket:async()=>{}},'https://example.test/hanabin/');
 await handle({request:()=>({method:()=> 'GET',url:()=> 'https://example.test/hanabin/src/main.js'}),continue:()=>{action='continued';},fetch:async options=>{fetchOptions=options;return {status:()=>302};},fulfill:()=>{action='fulfilled';},abort:()=>{action='aborted';}});
 assert.deepEqual(fetchOptions,{maxRedirects:0});
 assert.equal(action,'aborted');assert.equal(network.unexpected.length,1);
});
