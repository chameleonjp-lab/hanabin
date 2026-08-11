import { expect, test } from "@playwright/test";

const openPage = async (page) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?e2e=1");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
};

const callApi = (page, method, ...args) => page.evaluate(async ({ method: name, args }) => {
  const api = window.__hanabinTest;
  if (!api || typeof api[name] !== "function") throw new Error(`Missing test API: ${name}`);
  return api[name](...args);
}, { method, args });

test("M6 first practice can be skipped and then starts the real game", async ({ page }) => {
  await openPage(page);
  expect(await page.locator("#sound-toggle").isChecked()).toBe(false);
  await page.locator("#start-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
  await expect(page.locator("#practice-value")).toHaveText("12秒");
  await callApi(page, "skipPractice");
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
  expect((await callApi(page, "profile")).practiceSkipped).toBe(true);
});

test("M6 profile name is rendered as text, best record is saved, and share URL is last", async ({ page }) => {
  await openPage(page);
  await callApi(page, "setPlayerName", "<b>A</b>");
  await callApi(page, "start", 404);
  await callApi(page, "advanceTicks", 1);
  await callApi(page, "settleTerminal");
  await expect(page.locator("#result-screen")).toBeVisible();
  await expect(page.locator("#result-player-name")).toHaveText("<b>A</b>");
  expect(await page.locator("#result-player-name b").count()).toBe(0);
  await expect(page.locator("#result-hint")).not.toHaveText("");
  const share = await callApi(page, "shareText");
  const expectedUrl = await page.evaluate(() => {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    return url.href;
  });
  expect(share.endsWith(expectedUrl)).toBe(true);

  await page.locator("#home-button").click();
  await expect(page.locator("#home-best-score")).not.toHaveText("0");
  expect((await callApi(page, "profile")).bestScore).toBeGreaterThan(0);
});

test("M6 damaged local profile data does not block startup", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("hanabin:profile:v1", "{broken"));
  await page.reload();
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
  await expect(page.locator("#home-best-score")).toHaveText("0");
  await expect(page.locator("#quality-select")).toHaveValue("high");
  expect(await page.locator("#sound-toggle").isChecked()).toBe(false);
});
