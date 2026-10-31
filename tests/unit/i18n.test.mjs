import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import keys from '../../src/i18n/source-keys.js';
import {CATALOGS,SUPPORTED_LANGUAGES,LANGUAGE_STORAGE_KEY,resolveLanguage,translate,setLanguage} from '../../src/i18n/index.js';
import {buildShareText,resultHintFor,scoreBreakdownFor,openXComposer} from '../../src/ui/result.js';
const parameters=text=>[...text.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort();
test('all fifteen catalogs contain all messages and preserve dynamic parameters',()=>{
 assert.equal(SUPPORTED_LANGUAGES.length,15);
 for(const {id} of SUPPORTED_LANGUAGES) {
  assert.equal(Object.keys(CATALOGS[id]).length,keys.length);
  for(const source of keys){assert.equal(typeof CATALOGS[id][source],'string',`${id}: ${source}`);assert.ok(CATALOGS[id][source].length,`${id}: ${source}`);assert.deepEqual(parameters(CATALOGS[id][source]),parameters(source),`${id}: ${source}`);}
 }
});
test('saved language precedes browser preference and unsupported browsers use English',()=>{
 assert.equal(resolveLanguage({storage:{getItem:key=>key===LANGUAGE_STORAGE_KEY?'th':null},navigatorObject:{languages:['ja']}}),'th');
 for(const [input,expected] of [['pt-PT','pt-BR'],['zh-HK','zh-Hant'],['zh-Hans-TW','zh-Hans'],['es-MX','es'],['xx-ZZ','en']])assert.equal(resolveLanguage({storage:null,navigatorObject:{languages:[input]}}),expected);
 assert.equal(resolveLanguage({storage:{getItem(){throw Error('blocked')}},navigatorObject:{languages:[]}}),'en');
});
test('translation leaves unknown player names alone and all languages share the actual result',()=>{
 const before=scoreBreakdownFor({scoreEvents:[],bonusEvents:[]});
 for(const {id} of SUPPORTED_LANGUAGES){
  for (const name of ['Player 123','toString','__proto__']) assert.equal(translate(name,[],id),name);
  setLanguage(id,{storage:null});
  const text=buildShareText({name:'PRIVATE_NAME',score:1234,maxChain:7,url:'https://chameleonjp-lab.github.io/hanabin/'});
  assert.ok(text.includes('7'));assert.ok(text.includes('https://chameleonjp-lab.github.io/hanabin/'));assert.ok(!text.includes('PRIVATE_NAME'));
  assert.deepEqual(scoreBreakdownFor({scoreEvents:[],bonusEvents:[]}),before);
  assert.equal(typeof resultHintFor({finalScore:0}),'string');
 }
 setLanguage('ja',{storage:null});
});
test('static language markers are known and dynamic rule text has no untranslated source-only path',()=>{
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 for(const [,source] of html.matchAll(/data-i18n="([^"]+)"/g))assert.ok(Object.hasOwn(CATALOGS.en,source)||['SELECTION','RANGE','NEXT WAVES','音量','GO'].includes(source),source);
});

test('the standalone module-load error handler is valid JavaScript',()=>{
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 for(const [,source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Script(source));
});

test('bootstrap error catalogs match the full language catalogs',()=>{
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 const boot=JSON.parse(html.match(/const bootMessages = (.+);/)[1]);
 for(const {id} of SUPPORTED_LANGUAGES) assert.deepEqual(boot[id],[CATALOGS[id]['読み込みに失敗しました'],CATALOGS[id]['ページの読み込みに失敗しました。再読み込みしてください。']]);
});

test('X composer keeps symbols and newlines intact and blocked windows use the fallback',()=>{
 const text='HANABIN\n日本語 & ? # 1,234\nhttps://chameleonjp-lab.github.io/hanabin/';
 let opened='';const composer={opener:{}};
 assert.equal(openXComposer(text,{windowObject:{open:url=>{opened=url;return composer;}}}),true);
 assert.equal(new URL(opened).searchParams.get('text'),text);assert.equal(composer.opener,null);
 assert.equal(openXComposer(text,{windowObject:{open:()=>null}}),false);
 assert.equal(openXComposer(text,{windowObject:{open(){throw Error('blocked');}}}),false);
});
