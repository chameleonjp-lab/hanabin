import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/m7-public-release.spec.mjs"],
  timeout: 30_000,
  fullyParallel: true,
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit-touch",
      use: {
        browserName: "webkit",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 844, height: 390 },
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:4173/hanabin/",
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
