import { defineConfig } from "@playwright/test";
import { IPHONE_UA } from "./tests/e2e/fake";

const PORT = 3123;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.report" }]],
  outputDir: "tests/e2e/.results",
  use: { baseURL: `http://localhost:${PORT}`, screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions: { args: ["--autoplay-policy=user-gesture-required"] } },
  projects: [
    { name: "mobile", testIgnore: /prod\.spec/, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA } },
    { name: "desktop", testIgnore: /prod\.spec|api\.spec/, use: { viewport: { width: 1280, height: 800 } } },
    { name: "prod", testMatch: /prod\.spec/, use: { baseURL: "https://ai-rj.vercel.app" } },
  ],
  webServer: [
    { command: `npx next start -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 60_000 },
    // Second server with a broken Claude key: exercises the template fallback for real.
    { command: `ANTHROPIC_API_KEY=invalid npx next start -p 3124`, port: 3124, reuseExistingServer: true, timeout: 60_000 },
  ],
});
