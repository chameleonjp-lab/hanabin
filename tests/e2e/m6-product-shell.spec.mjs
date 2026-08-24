import { expect, test } from "@playwright/test";

const BOARD_WIDTH = 16_000;
const BOARD_HEIGHT = 9_000;

const openPage = async (page, viewport = null) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  if (viewport) await page.setViewportSize(viewport);
  await page.goto("/?e2e=1");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
};

const completePracticeGesture = async (page) => {
  const canvas = page.locator("#practice-canvas");
  const targets = await practicePoints(canvas);
  await page.mouse.move(targets[0].x, targets[0].y);
  await page.mouse.down();
  for (const target of targets) {
    await page.mouse.move(target.x, target.y);
    await page.clock.runFor(60);
  }
  await page.mouse.up();
  await page.clock.runFor(20);
  await expect(canvas).toHaveAttribute("data-practice-state", "success");
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

const practicePoints = async (canvas) => {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const encodedTargets = await canvas.getAttribute("data-practice-targets");
  const mouseAimOffset = Math.min(box.width, box.height) * 0.1;
  return encodedTargets.split("|").map((value) => {
    const [x, y] = value.split(",").map(Number);
    return {
      x: box.x + x * box.width,
      y: box.y + y * box.height + mouseAimOffset,
    };
  });
};

const dispatchPracticePointer = (page, type, {
  pointerId,
  clientX,
  clientY,
  pointerType = "touch",
}) => page.evaluate(({ type: eventType, pointerId: id, clientX: x, clientY: y, pointerType: kind }) => {
  document.querySelector("#practice-canvas")?.dispatchEvent(new PointerEvent(eventType, {
    bubbles: true,
    cancelable: true,
    pointerId: id,
    pointerType: kind,
    clientX: x,
    clientY: y,
    isPrimary: false,
  }));
}, { type, pointerId, clientX, clientY, pointerType });

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

  await expect(canvas).toHaveAttribute("data-practice-board-width", "16000");
  await expect(canvas).toHaveAttribute("data-practice-board-height", "9000");
  await expect(canvas).toHaveAttribute("data-practice-hit-radius", "520");
  await expect(canvas).toHaveAttribute("data-practice-min-hold-ticks", "3");
  await completePracticeGesture(page);

  await expect(canvas).toHaveAttribute("data-practice-state", "success");
  await expect(page.locator("#practice-progress")).toHaveText("3 / 3");
  await expect(page.locator("#practice-start")).toBeVisible();
  await expect(page.locator("#practice-continue")).toBeVisible();
  const practiceTargetRadius = Number(await canvas.getAttribute("data-practice-target-radius"));
  expect((await callApi(page, "profile"))).toMatchObject({
    practiceCompleted: false,
    practiceSkipped: false,
  });
  await page.locator("#practice-continue").click();
  await expect(page.locator("#countdown-screen")).toBeVisible({ timeout: 3_000 });
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
  const playTargetRadius = Number(
    await page.locator("#game-canvas").getAttribute("data-display-entity-radius"),
  );
  expect(Math.abs(practiceTargetRadius - playTargetRadius)).toBeLessThanOrEqual(2);
  expect((await callApi(page, "profile"))).toMatchObject({
    practiceCompleted: true,
    practiceSkipped: false,
  });
});

test("M6 home practice can return home, repeat twice, and then enter the real game", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hanabin:profile:v1", JSON.stringify({
      name: "",
      bestScore: 0,
      bestChain: 0,
      bestRuleVersion: "m4-gameplay-2",
      quality: "high",
      qualityManual: false,
      soundEnabled: false,
      practiceCompleted: true,
      practiceSkipped: false,
    }));
  });
  await openPage(page);

  await page.locator("#practice-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
  await page.locator("#practice-home").click();
  await expect(page.locator("#home-screen")).toBeVisible();

  await page.locator("#practice-button").click();
  await page.locator("#practice-start").click();
  await completePracticeGesture(page);
  await page.locator("#practice-start").click();
  await expect(page.locator("#practice-canvas")).toHaveAttribute("data-practice-state", "running");
  await expect(page.locator("#practice-progress")).toHaveText("0 / 3");
  await completePracticeGesture(page);
  await page.locator("#practice-continue").click();
  await expect(page.locator("#countdown-screen")).toBeVisible();
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
});

test("M6 landscape practice fits the viewport and portrait retry stays blocked", async ({ page }) => {
  await openPage(page, { width: 844, height: 390 });
  await page.locator("#start-button").click();
  const canvas = page.locator("#practice-canvas");
  for (const locator of [canvas, page.locator("#practice-start"), page.locator("#practice-skip")]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(390);
  }
  for (const locator of [page.locator("#practice-start"), page.locator("#practice-skip")]) {
    expect((await locator.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox.width / canvasBox.height).toBeCloseTo(16 / 9, 1);
  expect(Number(await canvas.getAttribute("data-practice-css-width"))).toBeCloseTo(canvasBox.width, 0);
  const backingWidth = await canvas.evaluate((element) => element.width);
  const practiceDpr = Number(await canvas.getAttribute("data-practice-device-pixel-ratio"));
  expect(backingWidth).toBeCloseTo(canvasBox.width * practiceDpr, 0);

  await page.locator("#practice-start").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#orientation-guide")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-practice-state", "expired");
  await expect(page.locator("#practice-start")).toBeDisabled();
  await expect(page.locator("#practice-skip")).toBeDisabled();
  await page.locator("#practice-start").evaluate((element) => element.click());
  await expect(canvas).toHaveAttribute("data-practice-state", "expired");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#orientation-guide")).toBeHidden();
  await expect(page.locator("#practice-start")).toBeEnabled();
  await page.locator("#practice-start").click();
  await expect(canvas).toHaveAttribute("data-practice-state", "running");
});

test("M6 practice rejects an unsampled fast sweep and ignores a second pointer", async ({ page }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-start").click();
  const canvas = page.locator("#practice-canvas");
  const targets = await practicePoints(canvas);

  await page.mouse.move(targets[0].x, targets[0].y);
  await page.mouse.down();
  const owner = Number(await canvas.getAttribute("data-active-pointer-id"));
  await dispatchPracticePointer(page, "pointerdown", {
    pointerId: owner + 100,
    clientX: targets[1].x,
    clientY: targets[1].y,
  });
  await expect(canvas).toHaveAttribute("data-secondary-pointer-ignored", "1");
  await expect(canvas).toHaveAttribute("data-last-pointer-change", "secondary-pointer-ignored");

  for (const target of targets) await page.mouse.move(target.x, target.y);
  await page.mouse.up();
  await page.clock.runFor(20);

  await expect(canvas).toHaveAttribute("data-practice-state", "running");
  await expect(canvas).toHaveAttribute("data-practice-selected-count", "0");
  await expect(page.locator("#practice-progress")).toHaveText("0 / 3");
});

test("M6 practice safely stops and clears progress on page lifecycle interruption", async ({ page }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-start").click();
  const canvas = page.locator("#practice-canvas");
  const targets = await practicePoints(canvas);

  await page.mouse.move(targets[0].x, targets[0].y);
  await page.mouse.down();
  await page.clock.runFor(60);
  await expect(canvas).toHaveAttribute("data-practice-selected-count", "1");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

  await expect(canvas).toHaveAttribute("data-practice-state", "expired");
  await expect(canvas).toHaveAttribute("data-practice-selected-count", "0");
  await expect(canvas).toHaveAttribute("data-practice-last-interrupt", "pagehide");
  await expect(page.locator("#practice-start")).toBeVisible();
  await page.mouse.up();
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

test("M6 forecast success is announced during play and counted in the result", async ({ page }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-skip").click();
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();

  const initial = await callApi(page, "snapshot");
  const initialNextWave = initial.upcomingWaves[0];
  await callApi(page, "advanceTicks", Math.max(
    0,
    initialNextWave.fireTick - initial.tick - 45,
  ));
  const state = await callApi(page, "snapshot");
  const nextWave = state.upcomingWaves[0];
  expect(nextWave.fireTick - state.tick).toBeGreaterThanOrEqual(1);
  expect(nextWave.fireTick - state.tick).toBeLessThanOrEqual(60);
  const targets = state.fireworks
    .filter((entity) => entity.status === "active" && entity.visible !== false)
    .filter((entity) => entity.forecastForWaveIndex === nextWave.waveIndex)
    .filter((entity) => entity.color === nextWave.primaryColor)
    .slice(0, 5);
  expect(targets).toHaveLength(5);

  const box = await page.locator("#game-canvas").boundingBox();
  expect(box).not.toBeNull();
  const pointForTarget = (target) => ({
    x: box.x + target.x / BOARD_WIDTH * box.width,
    y: Math.min(
      box.y + box.height - 2,
      box.y + target.y / BOARD_HEIGHT * box.height + Math.min(box.width, box.height) * 0.1,
    ),
  });
  const targetIds = targets.map((target) => target.id);
  await page.mouse.move(pointForTarget(targets[0]).x, pointForTarget(targets[0]).y);
  await page.mouse.down();
  for (const targetId of targetIds) {
    const target = (await callApi(page, "snapshot")).fireworks
      .find((entity) => String(entity.id) === String(targetId));
    expect(target).toBeDefined();
    const point = pointForTarget(target);
    await page.mouse.move(point.x, point.y);
    await callApi(page, "advanceTicks", 3);
  }
  await page.mouse.up();
  await callApi(page, "advanceTicks", 1);

  await expect(page.locator("#play-message")).toHaveText("予告成功！次の波を先回りしました");
  const forecastEvent = (await callApi(page, "snapshot")).bonusEvents
    .find((event) => event.forecastPlanAmount > 0);
  expect(forecastEvent).toBeDefined();
  expect(forecastEvent.forecastLeadTicks).toBeGreaterThanOrEqual(1);
  expect(forecastEvent.forecastLeadTicks).toBeLessThanOrEqual(60);

  await callApi(page, "settleTerminal");
  await expect(page.locator("#result-screen")).toBeVisible();
  await expect(page.locator("#result-forecast-successes")).toHaveText("1");
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
  await expect(page.locator("#quality-select")).toHaveValue("auto");
  expect(await page.locator("#sound-toggle").isChecked()).toBe(false);
});

test("M6 resets an old-rule best while preserving player preferences", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hanabin:profile:v1", JSON.stringify({
      name: "花子",
      bestScore: 99_999,
      bestChain: 99,
      bestRuleVersion: "m4-gameplay-1",
      quality: "medium",
      qualityManual: true,
      soundEnabled: true,
      practiceCompleted: true,
      practiceSkipped: false,
    }));
  });
  await openPage(page);
  await expect(page.locator("#player-name")).toHaveValue("花子");
  await expect(page.locator("#quality-select")).toHaveValue("medium");
  expect(await page.locator("#sound-toggle").isChecked()).toBe(true);
  await expect(page.locator("#home-best-score")).toHaveText("0");
  await expect(page.locator("#home-best-chain")).toHaveText("0");
  expect(await callApi(page, "profile")).toMatchObject({
    name: "花子",
    bestScore: 0,
    bestChain: 0,
    bestRuleVersion: "m4-gameplay-2",
    quality: "medium",
    qualityManual: true,
    soundEnabled: true,
    practiceCompleted: true,
  });
});
