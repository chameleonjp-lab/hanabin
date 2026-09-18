import { expect, test } from "@playwright/test";
import { createGame } from "../../src/core/engine.js";

const BOARD_WIDTH = 16_000;
const BOARD_HEIGHT = 9_000;

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
    if (response.status() >= 400) {
      diagnostics.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText ?? "unknown error"}`,
    );
  });
  return diagnostics;
};

const assertClean = (diagnostics) => {
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedResponses).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
};

test("published Pages scores a real selection and reaches the result screen", async ({ page }) => {
  test.setTimeout(110_000);
  const diagnostics = diagnosticsFor(page);

  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("./?public-smoke=1", { waitUntil: "networkidle", timeout: 30_000 });
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
  await expect(page.locator("#start-button")).toBeVisible();
  await page.locator("#player-name").fill("公開テスト");

  await page.locator("#start-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
  await page.locator("#practice-skip").click();
  await expect(page.locator("#countdown-screen")).toBeVisible();
  await expect(page.locator("#play-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#hud-time")).toBeVisible();

  // The production page intentionally exposes no test-state bridge. Use the
  // documented deterministic first seed to perform a real pointer selection
  // against the same fixed-point targets the game renders.
  const initialState = createGame(1);
  const targets = initialState.fireworks
    .filter((entity) => entity.status === "active" &&
      entity.color === initialState.waves[0].primaryColor)
    .slice(0, 3);
  expect(targets).toHaveLength(3);
  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pointForTarget = (target) => ({
    x: box.x + target.x / BOARD_WIDTH * box.width,
    y: box.y + target.y / BOARD_HEIGHT * box.height,
  });

  await page.mouse.move(pointForTarget(targets[0]).x, pointForTarget(targets[0]).y);
  await page.mouse.down();
  for (const target of targets) {
    const point = pointForTarget(target);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(90);
  }
  await expect(page.locator("#hud-selection-count")).toHaveText("3", { timeout: 3_000 });
  await page.mouse.up();
  await expect(page.locator("#hud-score")).not.toHaveText("0", { timeout: 3_000 });

  await expect(page.locator("#result-screen")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#result-score")).toBeVisible();
  await expect(page.locator("#result-chain")).toBeVisible();
  await expect(page.locator("#result-replay")).toContainText("プレイ結果を確認しました");
  await expect(page.locator("#app")).toHaveAttribute("data-result-entries", "1");

  assertClean(diagnostics);
});

test("published Pages does not expose repository-only files", async ({ request }) => {
  const repositoryOnlyPaths = [
    "package.json",
    "README.md",
    "README.html",
    "docs/MVP_RELEASE_REPORT.md",
    "docs/MVP_RELEASE_REPORT.html",
    ".github/workflows/pages.yml",
  ];

  for (const path of repositoryOnlyPaths) {
    const response = await request.get(path, { failOnStatusCode: false });
    expect(response.status(), `${path} must not be part of the public artifact`).toBe(404);
  }
});
