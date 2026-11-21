import {test,expect} from '@playwright/test';
import {SUPPORTED_LANGUAGES,translate} from '../../src/i18n/index.js';

test('home language selector leads the scroll area at the upper-left',async({page,baseURL})=>{
 const testOrigin=new URL(baseURL).origin;
 await page.route('**/*',route=>new URL(route.request().url()).origin===testOrigin ? route.continue() : route.abort());
 for(const viewport of [{width:320,height:568},{width:402,height:700},{width:844,height:390}]){
  await page.setViewportSize(viewport);
  await page.goto('/?e2e=1');
  const picker=page.locator('#language-select');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option')).toHaveCount(15);
  await picker.selectOption('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');
  const fits=await picker.evaluate(select=>{
   const group=select.closest('label').getBoundingClientRect();
   const scroll=select.closest('.home-scroll');
   const bounds=scroll.getBoundingClientRect();
   const styles=getComputedStyle(scroll);
   const title=scroll.querySelector('#home-title').getBoundingClientRect();
   const control=select.getBoundingClientRect();
   return Math.abs(group.left-(bounds.left+parseFloat(styles.paddingLeft)))<=1 &&
    Math.abs(group.top-(bounds.top+parseFloat(styles.paddingTop)))<=1 &&
    group.bottom<=title.top && control.height>=44 &&
    control.right<=bounds.right-parseFloat(styles.paddingRight)+1 &&
    document.documentElement.scrollWidth<=innerWidth;
  });
  expect(fits,`selector remains in-flow above the title at ${viewport.width}×${viewport.height}`).toBe(true);
 }
});

for (const {id} of SUPPORTED_LANGUAGES) {
 test(`all home, dynamic rules, practice and result messages use ${id}`, async({page})=>{
  await page.setViewportSize({width:393,height:700});
  await page.addInitScript(language=>localStorage.setItem('hanabin.language.v1',language),id);
  const writes=[];
  await page.route('**/rest/v1/**',async route=>{
   const url=route.request().url();
   if(!url.includes('get_best_score_ranking'))writes.push(url);
   await route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('html')).toHaveAttribute('lang',id);
  await expect(page.locator('#home-title')).toHaveText(translate('同じ色を3つつないで、連鎖を起こす',[],id));
  await expect(page.locator('#player-name-consent')).toHaveText(translate('名前を入力すると、名前と記録がランキングに公開されます。空欄でも遊べます。',[],id));
  await expect(page.locator('#home-share-button')).toHaveText(translate('Xでシェア',[],id));
  await expect(page.locator('#rule-direct')).not.toHaveText('');
  await expect(page.locator('#rule-penalty')).toHaveText(translate('減点はありません。選択不足、キャンセル、時間切れの花火は0点です',[],id));
  expect(await page.locator('#language-select option').count()).toBe(15);
  await page.locator('#practice-button').click();
  await expect(page.locator('#practice-value')).toHaveText(translate('{0}秒',[18],id));
  await page.locator('#practice-home').click();
  await page.evaluate(()=>{window.__hanabinTest.start(42);window.__hanabinTest.advanceTicks(120);});
  const before=await page.evaluate(()=>window.__hanabinTest.snapshot());
  await page.evaluate(()=>{const select=document.querySelector('#language-select');select.value='en';select.dispatchEvent(new Event('change'));});
  expect(await page.evaluate(()=>window.__hanabinTest.snapshot())).toEqual(before);
  await page.evaluate(language=>{const select=document.querySelector('#language-select');select.value=language;select.dispatchEvent(new Event('change'));window.__hanabinTest.advanceTicks(4000);window.__hanabinTest.settleTerminal();},id);
  await expect(page.locator('#result-screen')).toBeVisible();
  await expect(page.locator('#share-button')).toHaveText(translate('Xでシェア',[],id));
  const share=await page.evaluate(()=>window.__hanabinTest.shareText());
  expect(share).toContain('https://chameleonjp-lab.github.io/hanabin/');
  expect(share).toContain(translate('HANABINプレイ結果',[],id));
  expect(writes).toEqual([]);
  await page.locator('#home-button').click();
  await page.reload();
  await expect(page.locator('#language-select')).toHaveValue(id);
 });
}

test('browser language fallback and module-load errors use the selected language',async({browser})=>{
 const context=await browser.newContext({locale:'fr-CA'});
 const page=await context.newPage();
 await page.goto('/?e2e=1');
 await expect(page.locator('html')).toHaveAttribute('lang','fr');
 await page.locator('#language-select').selectOption('th');
 await page.route('**/src/app.js',route=>route.abort());
 await page.reload();
 await expect(page.locator('#app-error')).toBeVisible();
 await expect(page.locator('[data-error-detail]')).toHaveText(translate('ページの読み込みに失敗しました。再読み込みしてください。',[],'th'));
 await context.close();
});
