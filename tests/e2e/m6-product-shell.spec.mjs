import { expect, test } from "@playwright/test";

const BOARD_WIDTH = 16_000;
const BOARD_HEIGHT = 9_000;

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

const pointForTarget = (target, box) => ({
  x: Math.min(box.x + box.width - 2, Math.max(box.x + 2, box.x + target.x / BOARD_WIDTH * box.width)),
  y: Math.min(
    box.y + box.height - 2,
    Math.max(box.y + 2, box.y + target.y / BOARD_HEIGHT * box.height + Math.min(box.width, box.height) * 0.1),
  ),
});

test("M6 first practice can be skipped and then starts the real game", async ({ page }) => {
  await openPage(page);
  expect(await page.locator("#sound-toggle").isChecked()).toBe(false);
  await page.locator("#start-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
  await expect(page.locator("#practice-value")).toHaveText("12秒");
  await callApi(page, "skipPractice");
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
  expect((await callApi(page, "profile"))).toMatchObject({
    practiceCompleted: false,
    practiceSkipped: true,
  });
});

test("M6 first practice succeeds only after connecting three targets and releasing", async ({ page }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-start").click();
  const canvas = page.locator("#practice-canvas");
  await expect(canvas).toHaveAttribute("data-practice-state", "running");

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const encodedTargets = await canvas.getAttribute("data-practice-targets");
  const targets = encodedTargets.split("|").map((value) => {
    const [x, y] = value.split(",").map(Number);
    return { x: box.x + x * box.width, y: box.y + y * box.height };
  });

  await page.mouse.move(targets[0].x, targets[0].y);
  await page.mouse.down();
  for (const target of targets) await page.mouse.move(target.x, target.y);
  await page.mouse.up();

  await expect(canvas).toHaveAttribute("data-practice-state", "success");
  await expect(page.locator("#practice-progress")).toHaveText("3 / 3");
  await expect(page.locator("#countdown-screen")).toBeVisible({ timeout: 3_000 });
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
  expect((await callApi(page, "profile"))).toMatchObject({
    practiceCompleted: true,
    practiceSkipped: false,
  });
});

test("M6 practice timeout does not mark the practice as complete", async ({ page }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-start").click();
  await page.clock.runFor(12_500);
  await expect(page.locator("#practice-canvas")).toHaveAttribute("data-practice-state", "expired");
  expect((await callApi(page, "profile"))).toMatchObject({
    practiceCompleted: false,
    practiceSkipped: false,
  });
  await expect(page.locator("#practice-screen")).toBeVisible();
});

test("M6 profile name is rendered as text, best record is saved, and share URL is last", async ({ page }) => {
  await openPage(page);
  await callApi(page, "setPlayerName", "<b>A</b>");
  await callApi(page, "start", 404);
  await callApi(page, "advanceTicks", 1);
  const box = await page.locator("#game-canvas").boundingBox();
  const targets = (await callApi(page, "snapshot")).fireworks
    .filter((entity) => entity.status === "active" && entity.visible !== false)
    .slice(0, 3);
  expect(targets).toHaveLength(3);
  expect(new Set(targets.map((target) => target.color)).size).toBe(1);
  const first = pointForTarget(targets[0], box);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const target of targets) {
    const point = pointForTarget(target, box);
    await page.mouse.move(point.x, point.y);
    await callApi(page, "advanceTicks", 3);
  }
  await page.mouse.up();
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
