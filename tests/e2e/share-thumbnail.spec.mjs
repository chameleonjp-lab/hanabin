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

