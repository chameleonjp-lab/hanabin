import { expect, test } from "@playwright/test";
import { DEFAULT_RULES } from "../../src/config/index.js";
import { generateWave } from "../../src/core/wave-generator.js";

// Public smoke always starts the production controller's default seed. The
// first wave is fixed and its first three targets form the guaranteed same
// colour group. Keeping the fixture in the test process lets the browser use
// real pointer coordinates without exposing a production test API.
const PUBLIC_SMOKE_SEED = 1;
const PUBLIC_SMOKE_TARGETS = generateWave(
  PUBLIC_SMOKE_SEED,
  0,
  DEFAULT_RULES,
).entities.slice(0, 3);
const BOARD_WIDTH = DEFAULT_RULES.boardWidth;
const BOARD_HEIGHT = DEFAULT_RULES.boardHeight;

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

const canvasPointFor = (target, box) => ({
  x: box.x + target.x / BOARD_WIDTH * box.width,
  y: box.y + target.y / BOARD_HEIGHT * box.height,
});

test("published Pages reaches the result screen through the real terminal flow", async ({ page }) => {
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

  await expect(page.locator("#result-screen")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#result-score")).toBeVisible();
  await expect(page.locator("#result-chain")).toBeVisible();
  await expect(page.locator("#result-replay")).toContainText("入力記録の再生一致を確認しました");
  await expect(page.locator("#app")).toHaveAttribute("data-result-entries", "1");

  assertClean(diagnostics);
});

test("published Pages accepts a natural centre gesture and awards score", async ({ page }) => {
  const diagnostics = diagnosticsFor(page);

  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("./?public-smoke=1", { waitUntil: "networkidle", timeout: 30_000 });
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
  await page.locator("#player-name").fill("公開操作テスト");
  await page.locator("#start-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
  await page.locator("#practice-skip").click();
  await expect(page.locator("#play-screen")).toBeVisible({ timeout: 10_000 });

  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const points = PUBLIC_SMOKE_TARGETS.map((target) => canvasPointFor(target, box));

  // The coordinates are the visible target centres. No historical mouse aim
  // offset is added here: this is the same centre press a player makes.
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    await page.mouse.move(point.x, point.y);
    await expect(page.locator("#hud-selection-count")).toHaveText(String(index + 1), {
      timeout: 2_000,
    });
  }
  await page.mouse.up();

  await expect(page.locator("#hud-score")).not.toHaveText("0", { timeout: 3_000 });
  const score = Number((await page.locator("#hud-score").textContent()).replace(/[^0-9]/gu, ""));
  expect(score).toBeGreaterThan(0);
  await expect(page.locator("#hud-selection-count")).toHaveText("0");
  await expect(page.locator("#hud-score")).toHaveText(String(score));

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
