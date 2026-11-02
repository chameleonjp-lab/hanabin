import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LANGUAGES,setLanguage} from '../../src/i18n/index.js';
import * as share from '../../src/ui/result.js';
// twitter/twitter-text config/v3.json, checked 2026-11-02. These fixed
// templates contain no emoji clusters; a URL has transformed weight 23.
const weighted = text => [...text.replaceAll(share.CANONICAL_GAME_URL,'')].reduce((total,char)=>{
 const p=char.codePointAt(0);
 return total+((p<=4351||(p>=8192&&p<=8205)||(p>=8208&&p<=8223)||(p>=8242&&p<=8247))?1:2);
}, text.includes(share.CANONICAL_GAME_URL)?23:0);
test('all fifteen home/result texts retain exact tags, current result and no player identity within X limit',()=>{
 assert.equal(typeof share.buildHomeShareText,'function');
 try {
  for(const {id} of SUPPORTED_LANGUAGES){
   setLanguage(id,{storage:null});
   const home=share.buildHomeShareText();
   const result=share.buildShareText({name:'PRIVATE_TEST_NAME',score:2147483647,maxChain:99999});
   for(const text of [home,result]){
    assert.ok(text.endsWith('#ハナビン #ゲーム制作'),id);
    assert.equal(text.split('#ハナビン').length-1,1,id);
    assert.equal(text.split('#ゲーム制作').length-1,1,id);
    assert.equal(text.split(share.CANONICAL_GAME_URL).length-1,1,id);
    assert.ok(weighted(text)<=280,`${id}: ${weighted(text)}`);
    assert.ok(!text.includes('PRIVATE_TEST_NAME'));
   }
   assert.ok(result.includes('99999'),id);
  }
 }finally{setLanguage('ja',{storage:null});}
});

test('social metadata points to one real fixed PNG with matching dimensions',async()=>{
 const {readFile}=await import('node:fs/promises');
 const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
 assert.match(html,/property="og:image" content="https:\/\/chameleonjp-lab.github.io\/hanabin\/src\/assets\/social-card.png"/);
 assert.match(html,/name="twitter:card" content="summary_large_image"/);
 const png=await readFile(new URL('../../src/assets/social-card.png',import.meta.url));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
 assert.match(html,/property="og:image:width" content="1200"/);
 assert.match(html,/property="og:image:height" content="630"/);
});
