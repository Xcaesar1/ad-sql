import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeAsin } from "./repository.js";

const SIF_REVERSE_URL =
  "https://www.sif.com/reverse?country=US&from=commonAsinTab&asin=:asin&piece=latelyDay&date=7&isListingSearch=false&trafficType=";

function getChromeProfileDir(dataDir) {
  return process.env.SIF_CHROME_PROFILE_DIR || path.join(dataDir, "chrome-profile");
}

function getDownloadDir(dataDir) {
  const dir = process.env.SIF_DOWNLOAD_DIR || path.join(dataDir, "downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function findDownloadButton(page) {
  const candidates = [
    page.locator("button", { hasText: /^流量词$/ }).locator("..").locator("button, span, i, svg").last(),
    page.locator("text=流量词").locator("..").locator("button, span, i, svg").last(),
    page.locator("[class*='download'], [aria-label*='下载'], button:has-text('下载')").first()
  ];
  for (const candidate of candidates) {
    try {
      if ((await candidate.count()) > 0 && (await candidate.isVisible({ timeout: 1000 }))) {
        return candidate;
      }
    } catch {
      // Try next candidate. SIF is an external page and its DOM can change.
    }
  }
  return null;
}

export class Collector {
  constructor({ repository, dataDir }) {
    this.repository = repository;
    this.dataDir = dataDir;
    this.running = false;
  }

  isDisabled() {
    return process.env.SIF_COLLECTOR_DISABLED === "true";
  }

  async collectAsin(inputAsin) {
    if (this.isDisabled()) {
      throw Object.assign(new Error("自动采集已禁用。容器模式请使用上传 XLSX 兜底, 或在 Windows 采集主机原生运行。"), {
        statusCode: 503
      });
    }
    const asin = normalizeAsin(inputAsin);
    try {
      const filePath = await this.downloadWorkbook(asin);
      return this.repository.importWorkbook({
        asin,
        sourcePath: filePath,
        sourceType: "sif_auto"
      });
    } catch (error) {
      const collectionId = this.repository.createCollection({
        asin,
        sourceType: "sif_auto",
        status: "failed",
        errorMessage: error.message
      });
      this.repository.failCollection(collectionId, error.message);
      throw error;
    }
  }

  async runQueue(asins) {
    if (this.isDisabled()) {
      throw Object.assign(new Error("自动采集已禁用。容器模式请使用上传 XLSX 兜底, 或在 Windows 采集主机原生运行。"), {
        statusCode: 503
      });
    }
    if (this.running) {
      throw Object.assign(new Error("采集任务正在运行中"), { statusCode: 409 });
    }
    this.running = true;
    try {
      const results = [];
      for (const asin of asins) {
        try {
          results.push({ asin, status: "completed", result: await this.collectAsin(asin) });
        } catch (error) {
          results.push({ asin, status: "failed", error: error.message });
        }
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  async downloadWorkbook(asin) {
    const profileDir = getChromeProfileDir(this.dataDir);
    const downloadDir = getDownloadDir(this.dataDir);
    fs.mkdirSync(profileDir, { recursive: true });

    const context = await chromium.launchPersistentContext(profileDir, {
      channel: process.env.SIF_CHROME_CHANNEL || "chrome",
      headless: false,
      acceptDownloads: true,
      downloadsPath: downloadDir
    });

    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(SIF_REVERSE_URL.replace(":asin", asin), {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      const loginVisible = await page
        .locator("text=/登录|Sign in|Login/i")
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (loginVisible) {
        throw new Error("SIF 登录态失效, 请在采集主机专用 Chrome 中重新登录");
      }

      await page.locator("text=流量词").first().waitFor({ state: "visible", timeout: 60000 });
      const button = await findDownloadButton(page);
      if (!button) {
        throw new Error("未找到 SIF 流量词下载按钮, 可能页面结构已变化");
      }

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        button.click()
      ]);
      const suggested = download.suggestedFilename();
      const target = path.join(downloadDir, `${asin}-${Date.now()}-${suggested || "sif-keywords.xlsx"}`);
      await download.saveAs(target);
      return target;
    } finally {
      await context.close();
    }
  }
}
