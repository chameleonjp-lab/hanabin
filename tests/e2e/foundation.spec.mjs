import { expect, test } from "@playwright/test";

const openAndTrack = async (page, path) => {
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown error"}`);
  });
  await page.goto(path);
  return { consoleErrors, pageErrors, failedResponses, failedRequests };
};

const assertNoHorizontalOverflow = async (page) => {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
};

const assertCleanPage = ({ consoleErrors, pageErrors, failedResponses, failedRequests }) => {
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(failedRequests).toEqual([]);
};

test("loads cleanly in the 667x375 landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  const diagnostics = await openAndTrack(page, "/");

  await expect(page.locator("#app-status")).toHaveText("静的ページの読み込みが完了しました");
  await expect(page.locator("#app-error")).toBeHidden();
  await assertNoHorizontalOverflow(page);
  assertCleanPage(diagnostics);
});

test("loads cleanly in the 375x667 portrait viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const diagnostics = await openAndTrack(page, "/");

  await expect(page.locator("#orientation-guide")).toBeVisible();
  await expect(page.locator("#app-status")).toHaveText("静的ページの読み込みが完了しました");
  await assertNoHorizontalOverflow(page);
  assertCleanPage(diagnostics);
});

test("loads from the GitHub Pages-style /hanabin/ subpath", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  const diagnostics = await openAndTrack(page, "/hanabin/");

  await expect(page.locator("#app-status")).toHaveText("静的ページの読み込みが完了しました");
  await assertNoHorizontalOverflow(page);
  assertCleanPage(diagnostics);
});

test("keeps an alert visible when app.js cannot load", async ({ page }) => {
  await page.route("**/src/app.js", (route) => route.abort());
  await page.goto("/");

  await expect(page.locator("#app-error")).toBeVisible();
  await expect(page.locator("#app-error")).toHaveAttribute("role", "alert");
});
