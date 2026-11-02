import {test, expect} from '@playwright/test';
import {installPublicSmokeNetworkGuard} from './helpers/public-smoke-network.mjs';

for (const [locale, language, verified] of [
  ['ja-JP', 'ja', 'プレイ結果を確認しました'],
  ['en-US', 'en', 'Play result verified'],
]) {
  test.describe(`isolated public-flow locale ${locale}`, () => {
    test.use({locale, serviceWorkers: 'block'});
    test('anonymous result preserves translated verification without live score requests', async ({page, context, baseURL}) => {
      const network = await installPublicSmokeNetworkGuard(context, baseURL);
      await page.clock.install();
      await page.goto('/hanabin/?e2e=1');
      await expect(page.locator('#language-select')).toHaveValue(language);
      await page.locator('#player-name').fill('');
      await page.evaluate(() => {
        const api = window.__hanabinTest;
        api.start(1); api.advanceTicks(3600); api.settleTerminal();
      });
      await expect(page.locator('#result-screen')).toBeVisible();
      await expect(page.locator('#result-replay')).toContainText(verified);
      await expect(page.locator('#app')).toHaveAttribute('data-result-entries', '1');
      expect(network.unexpected).toEqual([]);
    });
  });
}
