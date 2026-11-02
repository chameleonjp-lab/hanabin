import {test, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';

async function isolateLocalGame(context, baseURL) {
  const blocked = [];
  const base = new URL(baseURL);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base.origin || !['GET','HEAD'].includes(request.method())) {
      blocked.push({method:request.method(),pathname:url.pathname});
      return route.abort('blockedbyclient');
    }
    const response=await route.fetch({maxRedirects:0});
    if(response.status()>=300&&response.status()<400){blocked.push({redirect:url.pathname});return route.abort('blockedbyclient');}
    return route.fulfill({response});
  });
  await context.routeWebSocket('**/*',socket=>{blocked.push({socket:true});socket.close();});
  return blocked;
}

test.use({serviceWorkers: 'block'});
test('capture the real anonymous game canvas without external traffic', async ({page, context, baseURL}, testInfo) => {
  const blocked = await isolateLocalGame(context, baseURL);
  await page.setViewportSize({width:1200,height:800});
  await page.clock.install();
  await page.goto('/hanabin/?e2e=1');
  await expect(page.locator('#player-name')).toHaveValue('');
  await page.evaluate(()=>{const api=window.__hanabinTest;api.start(7);api.advanceTicks(120);});
  await expect(page.locator('#play-screen')).toBeVisible();
  const canvas=page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  // Starting play changes the canvas box. Let ResizeObserver finish before
  // repainting the stopped deterministic renderer; resize clears canvas pixels.
  await page.clock.runFor(250);
  const pixels = await page.evaluate(() => {
    const api=window.__hanabinTest;
    api.advanceTicks(0);
    const canvas=document.querySelector('#game-canvas');
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let bright=0;
    for(let i=0;i<data.length;i+=4) if(data[i]>120||data[i+1]>120||data[i+2]>120) bright++;
    return {bright, actualTick:api.snapshot().tick, active:api.snapshot().fireworks.filter(item=>item.status==='active').length};
  });
  expect(pixels.active).toBeGreaterThan(0);
  expect(pixels.bright).toBeGreaterThan(100);
  const box=await canvas.boundingBox();
  expect(box.width).toBeGreaterThan(600);expect(box.height).toBeGreaterThan(300);
  // Canvas only: no name field, score HUD, browser chrome or fabricated artwork.
  await mkdir('test-results/share-thumbnail',{recursive:true});
  await canvas.screenshot({path:`test-results/share-thumbnail/${testInfo.project.name}-source.png`});
  // Presentation-only composition: crop actual renderer pixels, never synthesize
  // gameplay objects or modify the production renderer. Exclude its debug footer.
  const composition = await page.evaluate(() => {
    const source=document.querySelector('#game-canvas');
    const card=document.createElement('div');card.id='social-card-capture';
    Object.assign(card.style,{position:'fixed',inset:'0',width:'1200px',height:'630px',zIndex:'2147483647',background:'#080d1c',color:'#f5f8ff',display:'flex',alignItems:'center',padding:'36px',gap:'32px',boxSizing:'border-box',fontFamily:'sans-serif'});
    const intro=document.createElement('div');intro.style.cssText='width:356px;flex:none;';
    for(const [text,css] of [['HANABIN','font-size:30px;letter-spacing:6px;color:#84b6ff;margin:0 0 18px'],['ハナビン','font-size:64px;font-weight:800;line-height:1.3;white-space:nowrap;margin:0 0 40px'],['60秒 SCORE ATTACK','font-size:24px;color:#ffd16b;margin:0 0 18px'],['同じ色をつないで、','font-size:24px;line-height:1.7;margin:0'],['連鎖を広げよう。','font-size:24px;line-height:1.7;margin:0']]) {
      const line=document.createElement('p');line.textContent=text;line.style.cssText=css;intro.append(line);
    }
    const board=document.createElement('canvas');board.width=708;board.height=534;board.style.cssText='width:708px;height:534px;border-radius:20px;flex:none;';
    const crop={x:source.width*0.125,y:source.height*0.28,width:source.width*0.5,height:source.width*0.5*534/708};
    board.getContext('2d').drawImage(source,crop.x,crop.y,crop.width,crop.height,0,0,708,534);
    card.append(intro,board);document.body.append(card);
    return {width:1200,height:630,crop,sourceWidth:source.width,sourceHeight:source.height,scope:'actual renderer crop plus factual game title; no synthesized game objects'};
  });
  await page.locator('#social-card-capture').screenshot({path:`test-results/share-thumbnail/${testInfo.project.name}-card.png`});
  expect(blocked).toEqual([]);
  await writeFile(`test-results/share-thumbnail/${testInfo.project.name}-receipt.json`,JSON.stringify({seed:7,ticks:120,box,pixels,composition,blocked,scope:'real game canvas only; anonymous; external traffic denied'},null,2));
});

const languages=['ja','en','es','pt-BR','zh-Hans','fr','de','ko','ru','it','zh-Hant','id','tr','vi','th'];
const cases=[...languages.map(language=>({language,width:393,height:852})),...['ja','en','de'].map(language=>({language,width:852,height:393}))];
for(const {language,width,height} of cases) {
  test(`home and current-result X actions stay visible and tagged: ${language} ${width}x${height}`,async({page,context,baseURL},testInfo)=>{
    const blocked=await isolateLocalGame(context,baseURL);
    await page.setViewportSize({width,height});
    await page.clock.install();
    await page.goto('/hanabin/?e2e=1');
    await page.locator('#language-select').selectOption(language);
    await page.evaluate(()=>{window.__shareOpened=[];window.open=url=>{window.__shareOpened.push(url);return{opener:null};};});
    const verifyButton=async selector=>{
      const button=page.locator(selector);await button.scrollIntoViewIfNeeded();await expect(button).toBeVisible();
      if(language==='ja')await expect(button).toHaveText('Xでシェア');
      const style=await button.evaluate(el=>{
        const rect=el.getBoundingClientRect(),css=getComputedStyle(el);let opacity=1;
        for(let node=el;node;node=node.parentElement)opacity*=Number(getComputedStyle(node).opacity);
        const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        return{background:css.backgroundColor,color:css.color,width:rect.width,height:rect.height,opacity,centerHit:!!hit&&(hit===el||el.contains(hit)),inViewport:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight};
      });
      expect(style.background).toBe('rgb(0, 0, 0)');expect(style.color).toBe('rgb(255, 255, 255)');expect(style.width).toBeGreaterThanOrEqual(44);expect(style.height).toBeGreaterThanOrEqual(44);
      expect(style.opacity).toBeGreaterThanOrEqual(0.95);expect(style.centerHit).toBe(true);expect(style.inViewport).toBe(true);
      if(['ja','en','de'].includes(language)){
        await mkdir('test-results/share-thumbnail',{recursive:true});
        const screen=selector==='#home-share-button'?'home':'result';
        await page.screenshot({path:`test-results/share-thumbnail/${testInfo.project.name}-${language}-${width}x${height}-${screen}.png`});
      }
      const before=await page.evaluate(()=>window.__shareOpened.length);
      if(await page.evaluate(()=>navigator.maxTouchPoints>0))await button.tap();else await button.click();
      expect(await page.evaluate(()=>window.__shareOpened.length)).toBe(before+1);
      const intent=new URL(await page.evaluate(()=>window.__shareOpened.at(-1)));
      expect(intent.origin).toBe('https://x.com');expect(intent.pathname).toBe('/intent/tweet');
      const text=intent.searchParams.get('text');expect(text).toContain('https://chameleonjp-lab.github.io/hanabin/');expect(text.endsWith('#ハナビン #ゲーム制作')).toBe(true);
      return text;
    };
    const home=await verifyButton('#home-share-button');
    const expectedHome=await page.evaluate(async()=>{const{buildHomeShareText}=await import('/src/ui/result.js');return buildHomeShareText();});
    expect(home).toBe(expectedHome);
    await page.evaluate(()=>{const api=window.__hanabinTest;api.start(7);api.advanceTicks(3600);api.settleTerminal();});
    await expect(page.locator('#result-screen')).toBeVisible();
    const score=await page.locator('#result-score').textContent();
    const result=await verifyButton('#share-button');
    expect(result).toBe(await page.evaluate(()=>window.__hanabinTest.shareText()));
    await expect(page.locator('#result-score')).toHaveText(score);await expect(page.locator('#result-screen')).toBeVisible();
    expect(blocked).toEqual([]);
  });
}
