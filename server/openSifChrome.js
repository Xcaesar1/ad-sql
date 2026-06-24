import path from "node:path";
import { chromium } from "playwright";

const dataDir = process.env.DATA_DIR || path.resolve("data");
const profileDir = process.env.SIF_CHROME_PROFILE_DIR || path.join(dataDir, "chrome-profile");
const startUrl =
  process.env.SIF_START_URL ||
  "https://www.sif.com/reverse?country=US&from=commonAsinTab&asin=B0DM96Z44F&piece=latelyDay&date=7&isListingSearch=false&trafficType=";

const context = await chromium.launchPersistentContext(profileDir, {
  channel: process.env.SIF_CHROME_CHANNEL || "chrome",
  headless: false,
  acceptDownloads: true,
  downloadsPath: path.join(dataDir, "downloads")
});

const page = context.pages()[0] || (await context.newPage());
await page.goto(startUrl, { waitUntil: "domcontentloaded" });

console.log("Dedicated SIF Chrome is open.");
console.log(`Profile directory: ${profileDir}`);
console.log("Log in to SIF in the opened Chrome window, then press Ctrl+C here when finished.");

process.on("SIGINT", async () => {
  await context.close();
  process.exit(0);
});

await new Promise(() => {});
