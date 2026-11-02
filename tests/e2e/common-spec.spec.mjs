import {test,expect} from '@playwright/test';

test('named play can begin while every ranking request fails',async({page})=>{
 await page.clock.install();
 const requests=[];
 await page.route('**/rest/v1/**',route=>{requests.push(route.request().url());return route.abort();});
 await page.goto('/');
 await expect(page.locator('#app')).toHaveAttribute('data-state','home');
 await page.locator('#player-name').fill('通信なし');
 await page.locator('#start-button').click();
 await page.locator('#practice-skip').click();
 await expect(page.locator('#app')).toHaveAttribute('data-phase','countdown');
 await page.clock.runFor(3200);
 await expect(page.locator('#play-screen')).toBeVisible();
 expect(requests.some(url=>url.includes('start_game_play_v1'))).toBe(true);
});

test('result shows thirty aggregate rows and keeps long names as text',async({page})=>{
 await page.setViewportSize({width:393,height:600});
 await page.goto('/?e2e=1');
 await page.evaluate(async()=>{
  window.__hanabinTest.start(9);window.__hanabinTest.settleTerminal();
  const {renderResult}=await import('/src/ui/result.js');
  const state=window.__hanabinTest.snapshot();
  renderResult(document.querySelector('#app'),state,{isReplayValid:true,rankingMode:'remote',ranking:Array.from({length:30},(_,index)=>({rankNo:index===1?1:index+1,name:index===29?'<img src=x onerror=alert(1)> Long name '.repeat(3):`Player ${index+1}`,score:1000-index,playCount:index+1}))});
 });
 await expect(page.locator('#result-screen')).toBeVisible();
 const rows=page.locator('#result-ranking-list li');
 await expect(rows).toHaveCount(30);
 await expect(rows.nth(1).locator('.result-ranking__rank')).toHaveText('1');
 await expect(rows.last().locator('img')).toHaveCount(0);
 await rows.last().scrollIntoViewIfNeeded();await expect(rows.last()).toBeVisible();
 await page.locator('#share-button').scrollIntoViewIfNeeded();await expect(page.locator('#share-button')).toBeVisible();
});

test('sound volume zero and saved off survive language, replay and reload',async({page})=>{
 await page.goto('/?e2e=1');
 await expect(page.locator('#sound-toggle')).toBeChecked();
 await expect(page.locator('#sound-volume')).toHaveValue('0.5');
 await page.locator('#sound-volume').evaluate(input=>{input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#sound-toggle').uncheck();
 await page.locator('#language-select').selectOption('de');
 await page.evaluate(()=>{window.__hanabinTest.start(8);window.__hanabinTest.settleTerminal();});
 await page.locator('#home-button').click();
 await page.reload();
 await expect(page.locator('#sound-volume')).toHaveValue('0');
 await expect(page.locator('#sound-toggle')).not.toBeChecked();
 await expect(page.locator('#language-select')).toHaveValue('de');
});

test('clearing a saved home name persists and Japanese composition does not start play',async({page})=>{
 await page.goto('/?e2e=1');
 const input=page.locator('#player-name');
 await input.fill('保存する名前');await page.reload();await expect(input).toHaveValue('保存する名前');
 await input.evaluate(element=>{element.dispatchEvent(new CompositionEvent('compositionstart'));element.value='変換';element.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));element.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true}));element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
 await expect(page.locator('#home-screen')).toBeVisible();
 await input.fill('');await page.reload();await expect(input).toHaveValue('');
});

test('blocked X and clipboard keep the result and offer selectable copy text',async({page})=>{
 await page.goto('/?e2e=1');
 await page.evaluate(()=>{window.open=()=>null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}});document.execCommand=()=>false;window.__hanabinTest.start(7);window.__hanabinTest.settleTerminal();});
 const before=await page.locator('#result-score').textContent();
 const dialogPromise=page.waitForEvent('dialog');
 const click=page.locator('#share-button').click({noWaitAfter:true});
 const dialog=await dialogPromise;expect(dialog.type()).toBe('prompt');expect(dialog.defaultValue()).toContain('https://chameleonjp-lab.github.io/hanabin/');await dialog.dismiss();await click;
 await expect(page.locator('#result-score')).toHaveText(before);await expect(page.locator('#result-screen')).toBeVisible();
});
