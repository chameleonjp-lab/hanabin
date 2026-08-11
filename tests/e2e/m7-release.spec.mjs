import { expect, test } from "@playwright/test";

test("M7 terminal flow is repeatable and records one result per run", async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("/hanabin/?e2e=1");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state", "loading");

  const callApi = (method, ...args) => page.evaluate(async ({ method: name, args: values }) => {
    const api = window.__hanabinTest;
    if (!api || typeof api[name] !== "function") throw new Error(`Missing test API: ${name}`);
    return api[name](...values);
  }, { method, args });

  await page.locator("#start-button").click();
  await expect(page.locator("#practice-screen")).toBeVisible();
  await callApi("skipPractice");
  await callApi("advanceTicks", 1);
  await expect(page.locator("#play-screen")).toBeVisible();

  for (let run = 0; run < 3; run += 1) {
    if (run > 0) {
      await callApi("start", 5_000 + run);
      await callApi("advanceTicks", 1);
      await expect(page.locator("#play-screen")).toBeVisible();
    }
    await callApi("advanceTicks", 3_600);
    await callApi("settleTerminal");
    await expect(page.locator("#result-screen")).toBeVisible();

    const snapshot = await callApi("snapshot");
    expect(snapshot.actionCount).toBe(3_600);
    expect(snapshot.inputFrames).toHaveLength(3_600);
    expect(snapshot.simulationFault).toBeNull();

    const resultCount = (await callApi("transitions"))
      .filter((transition) => transition.to === "result").length;
    expect(resultCount).toBe(run + 1);

    await callApi("settleTerminal");
    const stableResultCount = (await callApi("transitions"))
      .filter((transition) => transition.to === "result").length;
    expect(stableResultCount).toBe(resultCount);

    if (run < 2) await page.locator("#home-button").click();
  }
});
