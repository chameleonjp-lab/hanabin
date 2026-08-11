import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /m7-public-release\\.spec\\.mjs/,
  timeout: 110_000,
  fullyParallel: false,
  retries: 2,
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-public-report" }],
  ],
  use: {
    baseURL: "https://chameleonjp-lab.github.io/hanabin/",
    headless: true,
    trace: "retain-on-failure",
  },
});
