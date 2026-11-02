import {test, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';

test.use({serviceWorkers: 'block'});
test('capture the real anonymous game canvas without external traffic', async ({page, context, baseURL}, testInfo) => {
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
  await page.setViewportSize({width:1200,height:800});
  await page.clock.install();
  await page.goto('/hanabin/?e2e=1');
  await expect(page.locator('#player-name')).toHaveValue('');
  await page.evaluate(()=>{const api=window.__hanabinTest;api.start(7);api.advanceTicks(120);});
  await expect(page.locator('#play-screen')).toBeVisible();
  const canvas=page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  const box=await canvas.boundingBox();
  expect(box.width).toBeGreaterThan(600);expect(box.height).toBeGreaterThan(300);
  // Canvas only: no name field, score HUD, browser chrome or fabricated artwork.
  await mkdir('test-results/share-thumbnail',{recursive:true});
  await canvas.screenshot({path:`test-results/share-thumbnail/${testInfo.project.name}-source.png`});
  expect(blocked).toEqual([]);
  await writeFile(`test-results/share-thumbnail/${testInfo.project.name}-receipt.json`,JSON.stringify({seed:7,ticks:120,box,blocked,scope:'real game canvas only; anonymous; external traffic denied'},null,2));
});
