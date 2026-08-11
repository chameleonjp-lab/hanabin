import { expect, test } from "@playwright/test";

const BOARD_WIDTH = 16_000;
const BOARD_HEIGHT = 9_000;
const REQUIRED_TEST_API = [
  "snapshot",
  "advanceTicks",
  "settleTerminal",
  "recordedReplay",
  "transitions",
  "renderModel",
  "setQuality",
];

const viewports = [
  { name: "667x375 landscape", width: 667, height: 375 },
  { name: "844x390 landscape", width: 844, height: 390 },
  { name: "1024x768 centered", width: 1024, height: 768 },
];

const diagnosticsFor = (page) => {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
    failedRequests: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown error"}`);
  });
  return diagnostics;
};

const assertClean = (diagnostics) => {
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedResponses).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
};

const callApi = (page, method, ...args) => page.evaluate(async ({ method: name, args: values }) => {
  const api = window.__hanabinTest;
  if (!api || typeof api[name] !== "function") {
    throw new Error(`Missing window.__hanabinTest.${name}`);
  }
  return await api[name](...values);
}, { method, args });

const openPage = async (page, viewport) => {
  const diagnostics = diagnosticsFor(page);
  // This clock is only for countdown/RAF presentation timers. Game ticks are
  // advanced through the fixed-tick test API below, never by waiting 60 sec.
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto("/?e2e=1");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");

  const apiKeys = await page.evaluate(() => Object.keys(window.__hanabinTest ?? {}));
  expect(
    apiKeys,
    "M3 production must expose a test-only fixed-tick/read-only window.__hanabinTest bridge",
  ).toEqual(expect.arrayContaining(REQUIRED_TEST_API));
  return diagnostics;
};

const beginPlaying = async (page) => {
  await page.locator("#start-button").click();
  // GameController.advanceTicks() bypasses the wall-clock countdown while
  // still exercising the real start button and session transition.
  await callApi(page, "advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();
};

const canvasBox = async (page) => {
  const rawBox = await page.locator("#game-canvas").boundingBox();
  expect(rawBox).not.toBeNull();
  return {
    ...rawBox,
    left: rawBox.x,
    top: rawBox.y,
    right: rawBox.x + rawBox.width,
    bottom: rawBox.y + rawBox.height,
  };
};

const pointForAim = (target, box) => {
  const offset = Math.max(1, Math.min(box.width, box.height) * 0.1);
  const x = box.left + target.x / BOARD_WIDTH * box.width;
  const y = box.top + target.y / BOARD_HEIGHT * box.height + offset;
  return {
    x: Math.min(box.right - 2, Math.max(box.left + 2, x)),
    y: Math.min(box.bottom - 2, Math.max(box.top + 2, y)),
  };
};

const firstThreeTargets = async (page) => {
  const state = await callApi(page, "snapshot");
  const targets = (state?.fireworks ?? [])
    .filter((entity) => entity.status === "active" && entity.visible !== false)
    .slice(0, 3);
  expect(targets).toHaveLength(3);
  expect(new Set(targets.map((target) => target.color)).size).toBe(1);
  return targets;
};

const playFirstSelection = async (page) => {
  const box = await canvasBox(page);
  const targets = await firstThreeTargets(page);
  await page.mouse.move(...Object.values(pointForAim(targets[0], box)));
  await page.mouse.down();
  for (const target of targets) {
    await page.mouse.move(...Object.values(pointForAim(target, box)));
    await callApi(page, "advanceTicks", 3);
  }
  await page.mouse.up();
  await callApi(page, "advanceTicks", 1);
  return callApi(page, "snapshot");
};

const dispatchPointer = (page, type, {
  pointerId,
  clientX,
  clientY,
  pointerType = "touch",
}) => page.evaluate(({ type: eventType, pointerId: id, clientX: x, clientY: y, pointerType: kind }) => {
  const canvas = document.querySelector("#game-canvas");
  if (!canvas) throw new Error("#game-canvas is missing");
  canvas.dispatchEvent(new PointerEvent(eventType, {
    bubbles: true,
    cancelable: true,
    pointerId: id,
    pointerType: kind,
    clientX: x,
    clientY: y,
    isPrimary: false,
  }));
}, { type, pointerId, clientX, clientY, pointerType });

const readReticle = (page) => callApi(page, "renderModel").then((model) => {
  const dataset = model?.canvas?.dataset ?? {};
  return {
    width: Number(model?.canvas?.width),
    height: Number(model?.canvas?.height),
    reticleX: Number(dataset.reticleX),
    reticleY: Number(dataset.reticleY),
    pointerX: Number(dataset.pointerX),
    pointerY: Number(dataset.pointerY),
  };
});

for (const viewport of viewports) {
  test(`M3 game frame is a centered, overflow-free 16:9 region at ${viewport.name}`, async ({ page }) => {
    const diagnostics = await openPage(page, viewport);
    await beginPlaying(page);

    const frame = await page.locator("#game-frame").boundingBox();
    expect(frame).not.toBeNull();
    const frameLeft = frame.x;
    const frameTop = frame.y;
    const frameRight = frame.x + frame.width;
    const frameBottom = frame.y + frame.height;
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
    expect(frameLeft).toBeGreaterThanOrEqual(-1);
    expect(frameTop).toBeGreaterThanOrEqual(-1);
    expect(frameRight).toBeLessThanOrEqual(viewport.width + 1);
    expect(frameBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(Math.abs(frameLeft + frame.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(3);

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    assertClean(diagnostics);
  });
}

test("M3 portrait viewport shows guidance and blocks pointer input", async ({ page }) => {
  const viewport = { width: 375, height: 667 };
  const diagnostics = await openPage(page, viewport);
  await expect(page.locator("#orientation-guide")).toBeVisible();
  // The controller must refuse to start while the orientation guide is
  // active. Do not call beginPlaying here: that helper intentionally assumes
  // a landscape input surface and would turn a correct refusal into a test
  // setup failure.
  await page.locator("#start-button").click();

  const rawBox = await page.locator("#game-canvas").boundingBox();
  const box = rawBox && {
    ...rawBox,
    left: rawBox.x,
    top: rawBox.y,
    right: rawBox.x + rawBox.width,
    bottom: rawBox.y + rawBox.height,
  };
  if (box) {
    await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
    await page.mouse.down();
    const during = await callApi(page, "renderModel");
    expect(during?.pointer?.pointerId ?? null).toBeNull();
    await page.mouse.up();
  }
  const snapshot = await callApi(page, "snapshot");
  expect(snapshot).toBeNull();
  expect(snapshot?.pointerPressed ?? false).toBe(false);
  expect(snapshot?.selectedIds ?? []).toEqual([]);
  assertClean(diagnostics);
});

test("M3 mouse input selects and detonates through the browser adapter", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const snapshot = await playFirstSelection(page);

  expect(snapshot.score).toBeGreaterThan(0);
  expect(snapshot.stats.detonationCount).toBeGreaterThanOrEqual(1);
  expect(snapshot.simulationFault).toBeNull();
  assertClean(diagnostics);
});

test("M5 decoration quality changes do not change the deterministic game result", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);

  await callApi(page, "setQuality", "high");
  await callApi(page, "start", 777);
  await callApi(page, "advanceTicks", 180);
  const highState = await callApi(page, "snapshot");
  const highModel = await callApi(page, "renderModel");

  await callApi(page, "setQuality", "low");
  await callApi(page, "start", 777);
  await callApi(page, "advanceTicks", 180);
  const lowState = await callApi(page, "snapshot");
  const lowModel = await callApi(page, "renderModel");

  expect(lowState).toEqual(highState);
  expect(highModel.canvas.dataset.renderQuality).toBe("high");
  expect(lowModel.canvas.dataset.renderQuality).toBe("low");
  expect(lowModel.canvas.dataset.competitiveLayer).toBe("protected");
  expect(Number(lowModel.canvas.dataset.renderParticleBudget)).toBeLessThan(
    Number(highModel.canvas.dataset.renderParticleBudget),
  );
  assertClean(diagnostics);
});

test("M3 ignores a second pointer without changing the first pointer state", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const box = await canvasBox(page);
  const targets = await firstThreeTargets(page);
  const firstPoint = pointForAim(targets[0], box);

  await page.mouse.move(firstPoint.x, firstPoint.y);
  await page.mouse.down();
  const before = await callApi(page, "renderModel");
  const firstPointerId = before.pointer.pointerId;
  expect(firstPointerId).not.toBeNull();
  const secondPointerId = Number(firstPointerId) + 100;

  const secondPoint = pointForAim(targets[1], box);
  await dispatchPointer(page, "pointerdown", {
    pointerId: secondPointerId,
    clientX: secondPoint.x,
    clientY: secondPoint.y,
  });
  await dispatchPointer(page, "pointermove", {
    pointerId: secondPointerId,
    clientX: secondPoint.x,
    clientY: secondPoint.y,
  });
  await dispatchPointer(page, "pointerup", {
    pointerId: secondPointerId,
    clientX: secondPoint.x,
    clientY: secondPoint.y,
  });

  const after = await callApi(page, "renderModel");
  expect(after.pointer.pointerId).toBe(firstPointerId);
  expect(after.pointer.x).toBe(before.pointer.x);
  expect(after.pointer.y).toBe(before.pointer.y);
  expect(after.state.actionCount).toBe(before.state.actionCount);
  expect(after.state.inputFrames.length).toBe(before.state.inputFrames.length);

  await page.mouse.up();
  assertClean(diagnostics);
});

test("M3 pointercancel clears selection and records one cancellation marker", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const box = await canvasBox(page);
  const target = (await firstThreeTargets(page))[0];
  const point = pointForAim(target, box);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await callApi(page, "advanceTicks", 3);
  const selected = await callApi(page, "snapshot");
  expect(selected.selectedIds).toHaveLength(1);
  const pointerId = (await callApi(page, "renderModel")).pointer.pointerId;
  await dispatchPointer(page, "pointercancel", {
    pointerId,
    clientX: point.x,
    clientY: point.y,
  });
  await callApi(page, "advanceTicks", 1);
  const cancelled = await callApi(page, "snapshot");
  expect(cancelled.pointerPressed).toBe(false);
  expect(cancelled.selectedIds).toEqual([]);
  expect(cancelled.score).toBe(selected.score);
  expect(cancelled.inputFrames.filter((frame) => frame.cancelled === true)).toHaveLength(1);
  await callApi(page, "advanceTicks", 1);
  const following = await callApi(page, "snapshot");
  expect(following.inputFrames.filter((frame) => frame.cancelled === true)).toHaveLength(1);
  assertClean(diagnostics);
});

test("M3 rotation interrupts once, pauses fixed ticks, and resumes without catch-up", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const box = await canvasBox(page);
  const target = (await firstThreeTargets(page))[0];
  const point = pointForAim(target, box);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await callApi(page, "advanceTicks", 3);
  const beforeRotation = await callApi(page, "snapshot");
  expect(beforeRotation.selectedIds).toHaveLength(1);

  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator("#orientation-guide")).toBeVisible();
  const portraitBeforeAdvance = await callApi(page, "snapshot");
  await callApi(page, "advanceTicks", 120);
  const portraitAfterAdvance = await callApi(page, "snapshot");
  expect(portraitAfterAdvance.actionCount).toBe(portraitBeforeAdvance.actionCount);
  expect(portraitAfterAdvance.selectedIds).toEqual(portraitBeforeAdvance.selectedIds);

  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.locator("#orientation-guide")).toBeHidden();
  await callApi(page, "advanceTicks", 1);
  const afterResume = await callApi(page, "snapshot");
  expect(afterResume.actionCount).toBe(beforeRotation.actionCount + 1);
  expect(afterResume.selectedIds).toEqual([]);
  expect(afterResume.inputFrames.filter((frame) => frame.interrupted === true)).toHaveLength(1);

  await callApi(page, "advanceTicks", 5);
  const afterVisibleTicks = await callApi(page, "snapshot");
  expect(afterVisibleTicks.actionCount).toBe(beforeRotation.actionCount + 6);
  expect(afterVisibleTicks.inputFrames.filter((frame) => frame.interrupted === true)).toHaveLength(1);
  await page.mouse.up();
  assertClean(diagnostics);
});

test("M3 edge-aware reticle stays on-canvas and changes direction at edges", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[1]);
  await beginPlaying(page);
  const box = await canvasBox(page);

  const topLeft = { x: box.left + 1, y: box.top + 1 };
  const topRight = { x: box.right - 1, y: box.top + 1 };
  const bottomLeft = { x: box.left + 1, y: box.bottom - 1 };
  const bottomRight = { x: box.right - 1, y: box.bottom - 1 };
  const center = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  const pointerId = (await callApi(page, "renderModel")).pointer.pointerId;
  expect(pointerId).not.toBeNull();
  await dispatchPointer(page, "pointermove", {
    pointerId,
    clientX: topLeft.x,
    clientY: topLeft.y,
    pointerType: "mouse",
  });
  await callApi(page, "advanceTicks", 1);
  const leftTop = await readReticle(page);
  await dispatchPointer(page, "pointermove", {
    pointerId,
    clientX: topRight.x,
    clientY: topRight.y,
    pointerType: "mouse",
  });
  await callApi(page, "advanceTicks", 1);
  const rightTop = await readReticle(page);
  await dispatchPointer(page, "pointermove", {
    pointerId,
    clientX: bottomLeft.x,
    clientY: bottomLeft.y,
    pointerType: "mouse",
  });
  await callApi(page, "advanceTicks", 1);
  const leftBottom = await readReticle(page);
  await dispatchPointer(page, "pointermove", {
    pointerId,
    clientX: bottomRight.x,
    clientY: bottomRight.y,
    pointerType: "mouse",
  });
  await callApi(page, "advanceTicks", 1);
  const rightBottom = await readReticle(page);
  await dispatchPointer(page, "pointerup", {
    pointerId,
    clientX: bottomRight.x,
    clientY: bottomRight.y,
    pointerType: "mouse",
  });

  for (const point of [leftTop, rightTop, leftBottom, rightBottom]) {
    expect(Number.isFinite(point.reticleX)).toBe(true);
    expect(Number.isFinite(point.reticleY)).toBe(true);
    expect(point.reticleX).toBeGreaterThanOrEqual(0);
    expect(point.reticleX).toBeLessThanOrEqual(point.width);
    expect(point.reticleY).toBeGreaterThanOrEqual(0);
    expect(point.reticleY).toBeLessThanOrEqual(point.height);
  }
  expect(leftTop.reticleX).toBeGreaterThan(leftTop.pointerX);
  expect(rightTop.reticleX).toBeLessThan(rightTop.pointerX);
  expect(leftBottom.reticleY).toBeLessThan(leftBottom.pointerY);
  expect(rightBottom.reticleY).toBeLessThan(rightBottom.pointerY);
  assertClean(diagnostics);
});

test("M3 rejects pointer input after the 3,600-tick boundary", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  await callApi(page, "advanceTicks", 3_600);
  const before = await callApi(page, "snapshot");
  expect(before.actionCount).toBe(3_600);
  expect(before.inputFrames).toHaveLength(3_600);

  const rawBox = await page.locator("#game-canvas").boundingBox();
  const box = rawBox && {
    ...rawBox,
    left: rawBox.x,
    top: rawBox.y,
    right: rawBox.x + rawBox.width,
    bottom: rawBox.y + rawBox.height,
  };
  const clientX = box ? box.left + box.width / 2 : 1;
  const clientY = box ? box.top + box.height / 2 : 1;
  // The play screen may already be hidden by the finalizing screen. Dispatch
  // on the real Canvas anyway: the controller must reject it by phase, not
  // merely rely on CSS hit-testing.
  await dispatchPointer(page, "pointerdown", {
    pointerId: 707,
    clientX,
    clientY,
  });
  await dispatchPointer(page, "pointerup", {
    pointerId: 707,
    clientX,
    clientY,
  });
  await callApi(page, "advanceTicks", 1);
  await callApi(page, "settleTerminal");
  const after = await callApi(page, "snapshot");
  expect(after.actionCount).toBe(before.actionCount);
  expect(after.inputFrames).toHaveLength(before.inputFrames.length);
  expect(after.score).toBe(before.score);
  expect(after.simulationFault).toBeNull();
  assertClean(diagnostics);
});

test("M3 finalization stays live when a held pointer is released", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const box = await canvasBox(page);

  await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
  await page.mouse.down();
  await callApi(page, "advanceTicks", 3_600);
  await expect(page.locator("#finalizing-screen")).toBeVisible();
  await page.mouse.up();

  const afterRelease = await callApi(page, "renderModel");
  expect(afterRelease.clock.paused).toBe(false);
  await page.clock.runFor(100);
  await expect(page.locator("#result-screen")).toBeVisible();
  assertClean(diagnostics);
});

test("M3 finalization resumes after a page lifecycle interruption", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const box = await canvasBox(page);

  await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
  await page.mouse.down();
  await callApi(page, "advanceTicks", 3_600);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  expect((await callApi(page, "renderModel")).clock.paused).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  expect((await callApi(page, "renderModel")).clock.paused).toBe(false);

  await page.clock.runFor(100);
  await expect(page.locator("#result-screen")).toBeVisible();
  assertClean(diagnostics);
});

test("M3 finalization resumes after rotating through portrait", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  const box = await canvasBox(page);

  await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
  await page.mouse.down();
  await callApi(page, "advanceTicks", 3_600);
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator("#orientation-guide")).toBeVisible();
  expect((await callApi(page, "renderModel")).clock.paused).toBe(true);

  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.locator("#orientation-guide")).toBeHidden();
  expect((await callApi(page, "renderModel")).clock.paused).toBe(false);
  await page.clock.runFor(100);
  await expect(page.locator("#result-screen")).toBeVisible();
  assertClean(diagnostics);
});

test("M3 enters result exactly once after finalizing and remains idempotent", async ({ page }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  await callApi(page, "advanceTicks", 3_600);
  await expect(page.locator("#finalizing-screen")).toBeVisible();
  await callApi(page, "settleTerminal");
  await expect(page.locator("#result-screen")).toBeVisible();

  const firstTransitions = await callApi(page, "transitions");
  expect(firstTransitions.filter((transition) => transition.to === "result")).toHaveLength(1);
  await callApi(page, "settleTerminal");
  await callApi(page, "advanceTicks", 120);
  const secondTransitions = await callApi(page, "transitions");
  expect(secondTransitions.filter((transition) => transition.to === "result")).toHaveLength(1);
  await expect(page.locator("#app")).toHaveAttribute("data-result-entries", "1");
  assertClean(diagnostics);
});

test("M3 replay of recorded input has the same score in a fresh viewport", async ({ page, context }) => {
  const diagnostics = await openPage(page, viewports[0]);
  await beginPlaying(page);
  await playFirstSelection(page);
  await callApi(page, "advanceTicks", 3_600);
  await callApi(page, "settleTerminal");
  const live = await callApi(page, "snapshot");
  const replay = await callApi(page, "recordedReplay");
  expect(replay).not.toBeNull();
  expect(replay.maxTicks).toBe(3_600);
  expect(replay.frames).toHaveLength(3_600);

  const replayPage = await context.newPage();
  try {
    const replayDiagnostics = await openPage(replayPage, viewports[2]);
    const hasReplayApi = await replayPage.evaluate(() =>
      typeof window.__hanabinTest?.replay === "function",
    );
    expect(
      hasReplayApi,
      "M3 production must expose a fresh-session replay method on window.__hanabinTest",
    ).toBe(true);
    const replayResult = await callApi(replayPage, "replay", replay);
    const replayState = replayResult?.state ?? replayResult;
    expect(replayResult?.simulationFault ?? null).toBeNull();
    expect(replayState.finalScore ?? replayState.score).toBe(live.finalScore ?? live.score);
    assertClean(replayDiagnostics);
  } finally {
    await replayPage.close();
  }
  assertClean(diagnostics);
});
