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

function getDiagnosticsDir(dataDir) {
  const dir = path.join(dataDir, "diagnostics");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function findDownloadButton(page) {
  const keywordFilterAnchor =
    "//*[contains(normalize-space(text()),'当前筛选') or (contains(normalize-space(.),'当前筛选') and not(.//*[contains(normalize-space(.),'当前筛选')]))]";
  const candidates = [
    {
      name: "keyword-toolbar-flow-sibling-download",
      locator: page.locator(
        `xpath=${keywordFilterAnchor}/preceding::*[normalize-space(.)='流量词'][1]/following-sibling::*[not(contains(@class,'downloadPolorBtn')) and not(contains(@class,'downloadPolarBtn')) and (self::button or self::a or self::div or self::span or @role='button') and (contains(@class,'download') or contains(@class,'Download') or contains(@class,'icon-xiazai') or contains(@aria-label,'下载') or contains(@title,'下载') or .//*[contains(@class,'download') or contains(@class,'Download') or contains(@class,'icon-xiazai')])][1]`
      )
    },
    {
      name: "keyword-toolbar-flow-following-download-icon",
      locator: page.locator(
        `xpath=${keywordFilterAnchor}/preceding::*[normalize-space(.)='流量词'][1]/following::*[contains(@class,'download_icon') or contains(@class,'icon-xiazai')][not(ancestor-or-self::*[contains(@class,'downloadPolorBtn') or contains(@class,'downloadPolarBtn')])][1]`
      )
    },
    {
      name: "keyword-filter-nearest-preceding-download",
      locator: page.locator(
        `xpath=${keywordFilterAnchor}/preceding::*[not(contains(@class,'downloadPolorBtn')) and not(contains(@class,'downloadPolarBtn')) and (contains(@class,'download_icon') or contains(@class,'icon-xiazai') or contains(@class,'download') or contains(@class,'Download') or contains(@aria-label,'下载') or contains(@title,'下载'))][1]`
      )
    }
  ];

  for (const candidate of candidates) {
    try {
      if (
        (await candidate.locator.count()) > 0 &&
        (await candidate.locator.isVisible({ timeout: 1000 })) &&
        !(await isRejectedDownloadCandidate(candidate.locator))
      ) {
        return candidate;
      }
    } catch {
      // Try next candidate. SIF is an external page and its DOM can change.
    }
  }
  return null;
}

async function isRejectedDownloadCandidate(locator) {
  if (typeof locator.evaluate !== "function") return false;
  return locator
    .evaluate((node) => {
      const className = typeof node.className === "string" ? node.className : "";
      const closestClass = node.closest?.(".downloadPolorBtn,.downloadPolarBtn")?.className || "";
      const html = node.outerHTML || "";
      const text = `${node.innerText || node.textContent || ""} ${node.closest?.("button,a,[role='button'],.modal,.el-dialog,.ant-modal")?.innerText || ""}`;
      return /downloadPolorBtn|downloadPolarBtn|使用指南|视频教程|秒懂视频|下载插件|购买会员|购买积分|AI工具/i.test(
        `${className} ${closestClass} ${html} ${text}`
      );
    })
    .catch(() => false);
}

async function saveDiagnosticScreenshot(page, dataDir, asin, reason) {
  if (!page?.screenshot) return "";
  const safeReason = String(reason || "failure").replace(/[^a-z0-9-]+/gi, "-").slice(0, 40);
  const target = path.join(getDiagnosticsDir(dataDir), `${asin}-${Date.now()}-${safeReason}.png`);
  try {
    await page.screenshot({ path: target, fullPage: true });
    return target;
  } catch {
    return "";
  }
}

function isDownloadTimeout(error) {
  return /Timeout .*download|waiting for event "download"/i.test(error?.message || "");
}

function isBrowserClosed(error) {
  return /Target page, context or browser has been closed|Browser has been closed/i.test(error?.message || "");
}

function withManualHandoff(message) {
  return `${message}。请转人工到 office-pc 检查 SIF 登录态, Chrome 窗口或 data/diagnostics 诊断截图`;
}

async function waitForDownloadButton(page, timeout = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const candidate = await findDownloadButton(page);
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function describeDownloadCandidate(candidate) {
  if (!candidate) return "";
  const base = { source: candidate.name };
  if (typeof candidate.locator.evaluate !== "function") return JSON.stringify(base);
  const element = await candidate.locator
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        tagName: node.tagName,
        text: (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        className: typeof node.className === "string" ? node.className.slice(0, 120) : "",
        title: node.getAttribute("title") || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        html: node.outerHTML.slice(0, 240)
      };
    })
    .catch((error) => ({ inspectError: error.message }));
  return JSON.stringify({ ...base, ...element });
}

function formatLaunchError(error, profileDir) {
  const message = error?.message || "";
  if (/ProcessSingleton|profile.*in use|user data directory.*in use|already running/i.test(message)) {
    return new Error(withManualHandoff(`SIF 专用 Chrome 配置目录正在被另一个 Chrome 使用。请关闭使用该配置目录的 Chrome 后重试: ${profileDir}`));
  }
  return error;
}

export class Collector {
  constructor({ repository, dataDir }) {
    this.repository = repository;
    this.dataDir = dataDir;
    this.running = false;
    this.context = null;
    this.launchPromise = null;
  }

  async collectAsin(inputAsin) {
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

  isRunning() {
    return this.running;
  }

  async getContext() {
    const profileDir = getChromeProfileDir(this.dataDir);
    const downloadDir = getDownloadDir(this.dataDir);
    fs.mkdirSync(profileDir, { recursive: true });

    if (this.context) return this.context;
    if (!this.launchPromise) {
      this.launchPromise = chromium
        .launchPersistentContext(profileDir, {
          channel: process.env.SIF_CHROME_CHANNEL || "chrome",
          headless: false,
          acceptDownloads: true,
          downloadsPath: downloadDir
        })
        .then((context) => {
          context.once?.("close", () => {
            if (this.context === context) this.context = null;
          });
          this.context = context;
          return context;
        })
        .catch((error) => {
          throw formatLaunchError(error, profileDir);
        })
        .finally(() => {
          this.launchPromise = null;
        });
    }
    return this.launchPromise;
  }

  async close() {
    const context = this.context;
    this.context = null;
    this.launchPromise = null;
    if (context) await context.close();
  }

  async getPage() {
    const context = await this.getContext();
    const existing = context.pages().find((page) => !page.isClosed?.());
    return existing || context.newPage();
  }

  async downloadWorkbook(asin) {
    const downloadDir = getDownloadDir(this.dataDir);
    const page = await this.getPage();

    try {
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
        throw new Error(withManualHandoff("SIF 登录态失效, 请在采集主机专用 Chrome 中重新登录"));
      }

      const candidate = await waitForDownloadButton(page, 60000);
      if (!candidate) {
        const screenshotPath = await saveDiagnosticScreenshot(page, this.dataDir, asin, "download-button-missing");
        throw new Error(
          withManualHandoff(`未找到 SIF 流量词下载按钮, 可能页面结构已变化${screenshotPath ? `。诊断截图: ${screenshotPath}` : ""}`)
        );
      }
      const buttonDebug = await describeDownloadCandidate(candidate);
      const button = candidate.locator;

      let download;
      try {
        [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), button.click()]);
      } catch (error) {
        if (isDownloadTimeout(error)) {
          const screenshotPath = await saveDiagnosticScreenshot(page, this.dataDir, asin, "download-timeout");
          throw new Error(
            withManualHandoff(`点击 SIF 流量词下载按钮后 60 秒内没有生成 XLSX。可能是页面弹窗, 验证码, 权限限制或按钮定位错误${
              screenshotPath ? `。诊断截图: ${screenshotPath}` : ""
            }${buttonDebug ? `。点击目标: ${buttonDebug}` : ""}`)
          );
        }
        throw error;
      }

      const suggested = download.suggestedFilename();
      const target = path.join(downloadDir, `${asin}-${Date.now()}-${suggested || "sif-keywords.xlsx"}`);
      await download.saveAs(target);
      return target;
    } catch (error) {
      if (isBrowserClosed(error)) await this.close();
      throw error;
    }
  }
}
