import { expect, test } from "@playwright/test";

const BOARD_WIDTH = 16_000;
const BOARD_HEIGHT = 9_000;

const openPage = async (page, viewport = null) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  if (viewport) await page.setViewportSize(viewport);
  await page.goto("/?e2e=1");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
  const nameInput = page.locator("#player-name");
  if (!(await nameInput.inputValue())) await nameInput.fill("M6テスト");
};

const completePracticeGesture = async (page) => {
  const canvas = page.locator("#practice-canvas");
  const connectTargets = async () => {
    const targets = await practicePoints(canvas);
    await page.mouse.move(targets[0].x, targets[0].y);
    await page.mouse.down();
    for (const target of targets) {
      await page.mouse.move(target.x, target.y);
      await page.clock.runFor(60);
    }
    await page.mouse.up();
    await page.clock.runFor(20);
  };

  await connectTargets();
  await expect(canvas).toHaveAttribute("data-practice-state", "stage-transition");
  await expect(canvas).toHaveAttribute("data-practice-stage", "1");
  await page.clock.runFor(700);
  await expect(canvas).toHaveAttribute("data-practice-state", "running");
  await expect(canvas).toHaveAttribute("data-practice-stage", "2");
  await connectTargets();
  await expect(canvas).toHaveAttribute("data-practice-state", "success");
  await expect(canvas).toHaveAttribute("data-practice-stage", "2");
  await expect(canvas).toHaveAttribute("data-practice-chain-captured", "true");
  await expect(page.locator("#practice-feedback")).toContainText("巻き込み成功");
};

const callApi = (page, method, ...args) => page.evaluate(async ({ method: name, args }) => {
  const api = window.__hanabinTest;
  if (!api || typeof api[name] !== "function") throw new Error(`Missing test API: ${name}`);
  return api[name](...args);
}, { method, args });

const beginPlaying = async (page) => {
  await page.locator("#start-button").click();
  await page.locator("#practice-skip").click();
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
};

const pointForTarget = (target, box) => ({
  x: Math.min(box.x + box.width - 2, Math.max(box.x + 2, box.x + target.x / BOARD_WIDTH * box.width)),
  y: Math.min(
    box.y + box.height - 2,
    Math.max(box.y + 2, box.y + target.y / BOARD_HEIGHT * box.height),
  ),
});

const practicePoints = async (canvas) => {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const encodedTargets = await canvas.getAttribute("data-practice-targets");
  return encodedTargets.split("|").map((value) => {
    const [x, y] = value.split(",").map(Number);
    return {
      x: box.x + x * box.width,
      y: box.y + y * box.height,
    };
  });
};

const practiceTargetCenters = async (canvas) => {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const orientation = await canvas.getAttribute("data-orientation");
  const encodedTargets = await canvas.getAttribute("data-practice-targets");
  return encodedTargets.split("|").map((value) => {
    const [x, y] = value.split(",").map(Number);
    return orientation === "portrait"
      ? { x: box.x + (1 - y) * box.width, y: box.y + x * box.height }
      : { x: box.x + x * box.width, y: box.y + y * box.height };
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
  await expect(page.locator("#practice-value")).toHaveText("18秒");
  await callApi(page, "skipPractice");
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
  expect((await callApi(page, "profile"))).toMatchObject({
    practiceCompleted: false,
    practiceSkipped: true,
  });
});

test("M6 portrait keeps practice start and the play board inside the fixed viewport", async ({ page }) => {
  await openPage(page, { width: 393, height: 852 });
  await page.locator("#start-button").click();

  const startBox = await page.locator("#practice-start").boundingBox();
  expect(startBox).not.toBeNull();
  expect(startBox.y).toBeGreaterThanOrEqual(0);
  expect(startBox.y + startBox.height).toBeLessThanOrEqual(852);
  const practiceScroll = await page.evaluate(() => ({
    viewport: document.documentElement.clientHeight,
    documentHeight: document.documentElement.scrollHeight,
    scrollTop: document.scrollingElement?.scrollTop ?? 0,
  }));
  expect(practiceScroll.documentHeight).toBeLessThanOrEqual(practiceScroll.viewport);
  expect(practiceScroll.scrollTop).toBe(0);

  await page.locator("#practice-skip").click();
  await callApi(page, "advanceTicks", 1);
  const frame = await page.locator("#game-frame").boundingBox();
  expect(frame).not.toBeNull();
  expect(frame.y).toBeGreaterThanOrEqual(-1);
  expect(frame.y + frame.height).toBeLessThanOrEqual(853);
  expect(frame.width / frame.height).toBeCloseTo(9 / 16, 2);
  const playScroll = await page.evaluate(() => ({
    viewport: document.documentElement.clientHeight,
    documentHeight: document.documentElement.scrollHeight,
    scrollTop: document.scrollingElement?.scrollTop ?? 0,
  }));
  expect(playScroll.documentHeight).toBeLessThanOrEqual(playScroll.viewport);
  expect(playScroll.scrollTop).toBe(0);
});

for (const viewport of [
  { name: "402x874 portrait", width: 402, height: 874 },
  { name: "402x780 portrait", width: 402, height: 780 },
  { name: "402x700 portrait", width: 402, height: 700 },
  { name: "390x664 portrait", width: 390, height: 664 },
  { name: "320x568 portrait", width: 320, height: 568 },
  { name: "874x402 landscape", width: 874, height: 402 },
]) {
  test(`HBA-03 practice targets are visible without scrolling at ${viewport.name}`, async ({ page }) => {
    await openPage(page, viewport);
    await page.locator("#start-button").click();
    await page.locator("#practice-start").click();
    const canvas = page.locator("#practice-canvas");
    await expect(canvas).toHaveAttribute("data-practice-state", "running");

    const boardBox = await canvas.boundingBox();
    expect(boardBox).not.toBeNull();
    expect(boardBox.y).toBeGreaterThanOrEqual(0);
    expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(viewport.height);
    const centers = await practiceTargetCenters(canvas);
    expect(centers).toHaveLength(3);
    for (const center of centers) {
      expect(center.x).toBeGreaterThanOrEqual(0);
      expect(center.x).toBeLessThanOrEqual(viewport.width);
      expect(center.y).toBeGreaterThanOrEqual(0);
      expect(center.y).toBeLessThanOrEqual(viewport.height);
    }
    const scroll = await page.evaluate(() => ({
      viewport: document.documentElement.clientHeight,
      documentHeight: document.documentElement.scrollHeight,
      scrollTop: document.scrollingElement?.scrollTop ?? 0,
    }));
    expect(scroll.documentHeight).toBeLessThanOrEqual(scroll.viewport);
    expect(scroll.scrollTop).toBe(0);
  });
}

test("M6 first practice teaches basic selection and then a real nearby chain", async ({ page }) => {
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
      bestRuleVersion: "m4-gameplay-3",
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

test("M6 practice fits landscape and remains playable after portrait rotation", async ({ page }) => {
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
  await expect(canvas).toHaveAttribute("data-practice-state", "running");
  await expect(canvas).toHaveAttribute("data-orientation", "portrait");
  const portraitBox = await canvas.boundingBox();
  expect(portraitBox.width / portraitBox.height).toBeCloseTo(9 / 16, 1);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#orientation-guide")).toBeHidden();
  await expect(canvas).toHaveAttribute("data-practice-state", "running");
  await expect(canvas).toHaveAttribute("data-orientation", "landscape");
});

test("M6 practice keeps a one-tick press-and-sweep uncommitted and ignores a second pointer", async ({ page }) => {
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

test("M6 requires a player name before opening practice", async ({ page }) => {
  await openPage(page);
  await page.locator("#player-name").fill("");
  await page.locator("#start-button").click();
  await expect(page.locator("#profile-error")).toBeVisible();
  await expect(page.locator("#home-screen")).toBeVisible();

  await page.locator("#player-name").fill("名前あり");
  await page.locator("#start-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
});

test("M6 pause menu freezes ticks, explains rules, and supports retire", async ({ page }) => {
  await openPage(page);
  await beginPlaying(page);
  const before = await callApi(page, "snapshot");

  await page.locator("#pause-button").click();
  await expect(page.locator("#pause-menu")).toBeVisible();
  await expect(page.locator("#pause-resume-button")).toBeFocused();
  await callApi(page, "advanceTicks", 30);
  expect((await callApi(page, "snapshot")).actionCount).toBe(before.actionCount);

  await page.locator("#pause-rules-button").click();
  await expect(page.locator("#pause-rules-panel")).toBeVisible();
  await expect(page.locator("#pause-rules-panel")).toContainText("同じ色");
  await page.locator("#pause-resume-button").click();
  await expect(page.locator("#pause-menu")).toBeHidden();
  expect((await callApi(page, "renderModel")).clock.userPaused).toBe(false);

  await callApi(page, "advanceTicks", 1);
  expect((await callApi(page, "snapshot")).actionCount).toBe(before.actionCount + 1);
  await page.locator("#pause-button").click();
  await page.locator("#pause-retire-button").click();
  await expect(page.locator("#result-screen")).toBeVisible();
  await expect(page.locator("#result-status")).toHaveText("リタイアしました");
  await expect(page.locator("#result-replay")).toContainText("記録には残していません");
});

test("M6 result keeps the home route and local top-ten ranking visible", async ({ page }) => {
  await openPage(page);
  await beginPlaying(page);
  await expect(page.locator("#hud-choice-count")).toHaveText(/^[4-9][0-9]*$/);
  await expect(page.locator("#hud-choice-count")).toHaveAttribute("data-guaranteed", "true");
  await callApi(page, "settleTerminal");
  await expect(page.locator("#result-screen")).toBeVisible();
  await expect(page.locator("#home-button")).toBeVisible();
  await expect(page.locator("#result-experiment-link")).toHaveCount(0);
  await expect(page.locator("#result-ranking-list li")).toHaveCount(1);
  await expect(page.locator("#result-ranking-list")).toContainText("M6テスト");
  await page.locator("#home-button").click();
  await expect(page.locator("#home-screen")).toBeVisible();
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

test("M6 an uncompleted first practice step expires without marking practice complete", async ({ page }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-start").click();
  await page.clock.runFor(8_500);
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
  await expect(page.locator("#hud-forecast-items .forecast-item").first())
    .toHaveAttribute("data-forecast-window", "open");
  await expect(page.locator("#hud-forecast-items .forecast-item").first())
    .toContainText("予告準備");
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
    y: box.y + target.y / BOARD_HEIGHT * box.height,
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
  await expect(page.locator("#result-hint")).toContainText("4個目を足し");
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

test("HBA-02 an older tab cannot lower the latest same-rule best", async ({ page, context }) => {
  await openPage(page);
  await page.locator("#start-button").click();
  await page.locator("#practice-skip").click();
  await callApi(page, "advanceTicks", 1);

  const newerTab = await context.newPage();
  await newerTab.goto("/?e2e=1");
  await newerTab.evaluate(() => {
    const current = JSON.parse(localStorage.getItem("hanabin:profile:v1") ?? "{}");
    localStorage.setItem("hanabin:profile:v1", JSON.stringify({
      ...current,
      bestScore: 10_000,
      bestChain: 8,
      bestRuleVersion: "m4-gameplay-3",
    }));
  });

  await callApi(page, "advanceTicks", 3_600);
  await callApi(page, "settleTerminal");
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("hanabin:profile:v1")));
  expect(persisted).toMatchObject({
    bestScore: 10_000,
    bestChain: 8,
    bestRuleVersion: "m4-gameplay-3",
  });
  await newerTab.close();
});

test("HBA-05 keeps legacy ranking records out of the current-rule ranking", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hanabin:profile:v1", JSON.stringify({
      name: "現在のプレイヤー",
      bestScore: 10_000,
      bestChain: 8,
      bestRuleVersion: "m4-gameplay-1",
    }));
    localStorage.setItem("hanabin:ranking:v1", JSON.stringify([
      {
        name: "旧ルール",
        score: 10_000,
        maxChain: 8,
        createdAt: 1,
        ruleVersion: "m4-gameplay-1",
      },
      {
        name: "版不明",
        score: 9_000,
        maxChain: 7,
        createdAt: 2,
      },
    ]));
  });
  await openPage(page);
  await expect(page.locator("#home-best-score")).toHaveText("0");
  await page.locator("#start-button").click();
  await page.locator("#practice-skip").click();
  await callApi(page, "advanceTicks", 1);
  await callApi(page, "advanceTicks", 3_600);
  await callApi(page, "settleTerminal");
  await expect(page.locator("#result-screen")).toBeVisible();

  await expect(page.locator("#result-best-score")).toHaveText("0");
  await expect(page.locator("#result-ranking-list")).not.toContainText("旧ルール");
  await expect(page.locator("#result-ranking-list")).not.toContainText("版不明");
  await expect(page.locator("#legacy-ranking")).toBeVisible();
  await expect(page.locator("#legacy-ranking-list")).toContainText("旧ルール");
  await expect(page.locator("#legacy-ranking-list")).toContainText("m4-gameplay-1");
  await expect(page.locator("#legacy-ranking-list")).toContainText("版不明");

  const savedRanking = await page.evaluate(() => JSON.parse(localStorage.getItem("hanabin:ranking:v1")));
  expect(savedRanking).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "旧ルール", ruleVersion: "m4-gameplay-1" }),
    expect.objectContaining({ name: "版不明", ruleVersion: "" }),
    expect.objectContaining({ name: "現在のプレイヤー", ruleVersion: "m4-gameplay-3" }),
  ]));
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
    bestRuleVersion: "m4-gameplay-3",
    quality: "medium",
    qualityManual: true,
    soundEnabled: true,
    practiceCompleted: true,
  });
});
