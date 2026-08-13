import { expect, test } from "@playwright/test";

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

test("published Pages reaches the result screen through the real terminal flow", async ({ page }) => {
  test.setTimeout(110_000);
  const diagnostics = diagnosticsFor(page);

  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("./?public-smoke=1", { waitUntil: "networkidle", timeout: 30_000 });
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");
  await expect(page.locator("#start-button")).toBeVisible();

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

test("published Pages does not expose repository-only files", async ({ request }) => {
  const repositoryOnlyPaths = [
    "package.json",
    "README.md",
    "docs/MVP_RELEASE_REPORT.md",
    ".github/workflows/pages.yml",
  ];

  for (const path of repositoryOnlyPaths) {
    const response = await request.get(path, { failOnStatusCode: false });
    expect(response.status(), `${path} must not be part of the public artifact`).toBe(404);
  }
});
