import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const download = {
  suggestedFilename: vi.fn(() => "keywords.xlsx"),
  saveAs: vi.fn(async (target) => {
    fs.writeFileSync(target, "xlsx");
  })
};

const workbookResponse = {
  url: vi.fn(() => "https://www.sif.com/api/updown/asinKeywordList/download?country=US"),
  status: vi.fn(() => 200),
  headers: vi.fn(() => ({ "content-type": "application/octet-stream" })),
  text: vi.fn(async () => ""),
  body: vi.fn(async () => Buffer.from("PK"))
};

const buttonLocator = {
  count: vi.fn(async () => 1),
  isVisible: vi.fn(async () => true),
  click: vi.fn(async () => undefined),
  first: vi.fn(function first() {
    return this;
  }),
  last: vi.fn(function last() {
    return this;
  }),
  locator: vi.fn(function locator() {
    return this;
  }),
  waitFor: vi.fn(async () => undefined)
};

const emptyLocator = {
  count: vi.fn(async () => 0),
  isVisible: vi.fn(async () => false),
  click: vi.fn(async () => undefined),
  first: vi.fn(function first() {
    return this;
  }),
  last: vi.fn(function last() {
    return this;
  }),
  locator: vi.fn(function locator() {
    return this;
  }),
  waitFor: vi.fn(async () => undefined)
};

const hiddenFlowTextLocator = {
  count: vi.fn(async () => 1),
  isVisible: vi.fn(async () => false),
  first: vi.fn(function first() {
    return this;
  }),
  last: vi.fn(function last() {
    return this;
  }),
  locator: vi.fn(function locator() {
    return this;
  }),
  waitFor: vi.fn(async () => {
    throw new Error("hidden reverse-nav flow text");
  })
};

const loginLocator = {
  first: vi.fn(function first() {
    return this;
  }),
  isVisible: vi.fn(async () => false)
};

function useDefaultLocatorMock() {
  page.locator.mockImplementation((selector) => {
    if (String(selector).includes("Sign in") || String(selector).includes("Login")) return loginLocator;
    if (selector === "text=流量词") return hiddenFlowTextLocator;
    if (String(selector).includes("当前筛选")) return buttonLocator;
    return buttonLocator;
  });
}

const page = {
  goto: vi.fn(async () => undefined),
  locator: vi.fn(),
  route: vi.fn(async () => undefined),
  unroute: vi.fn(async () => undefined),
  waitForFunction: vi.fn(async () => undefined),
  waitForResponse: vi.fn(async () => workbookResponse),
  waitForEvent: vi.fn(async () => download),
  screenshot: vi.fn(async () => undefined),
  url: vi.fn(() => "https://www.sif.com/reverse")
};

const context = {
  pages: vi.fn(() => [page]),
  newPage: vi.fn(async () => page),
  close: vi.fn(async () => undefined)
};

const launchPersistentContext = vi.fn(async () => context);

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext
  }
}));

const { Collector } = await import("../server/collector.js");

describe("Collector browser session", () => {
  let dataDir;

  beforeEach(() => {
    useDefaultLocatorMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("reuses the dedicated Chrome context across collection downloads", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");
    await collector.downloadWorkbook("B0DM96Z44F");

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();

    await collector.close();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  test("keeps the dedicated Chrome context open when SIF login expires", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    loginLocator.isVisible.mockResolvedValueOnce(true);
    const collector = new Collector({ repository: {}, dataDir });

    await expect(collector.downloadWorkbook("B0DM96Z44F")).rejects.toThrow("SIF 登录态失效");

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
    expect(collector.context).toBe(context);

    await collector.close();
  });

  test("does not wait on hidden reverse navigation text before clicking the visible download button", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");

    expect(hiddenFlowTextLocator.waitFor).not.toHaveBeenCalled();
    expect(buttonLocator.click).toHaveBeenCalled();
  });

  test("prefers the toolbar download button adjacent to the flow tab over generic download icons", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const genericDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined)
    };
    const toolbarDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined)
    };
    page.locator.mockImplementation((selector) => {
      const value = String(selector);
      if (value.includes("Sign in") || value.includes("Login")) return loginLocator;
      if (selector === "text=流量词") return hiddenFlowTextLocator;
      if (value.includes("keyword_list_table_wrap")) return emptyLocator;
      if (value.includes("当前筛选") && value.includes("preceding::*") && value.includes("following-sibling")) return toolbarDownloadLocator;
      if (value.includes("following::*") || value.includes("[class*='download']")) return genericDownloadLocator;
      return buttonLocator;
    });
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");

    expect(toolbarDownloadLocator.click).toHaveBeenCalled();
    expect(genericDownloadLocator.click).not.toHaveBeenCalled();
  });

  test("skips product polar download icons that do not export keyword workbooks", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const polarDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => true)
    };
    const workbookDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => false)
    };
    page.locator.mockImplementation((selector) => {
      const value = String(selector);
      if (value.includes("Sign in") || value.includes("Login")) return loginLocator;
      if (selector === "text=流量词") return hiddenFlowTextLocator;
      if (value.includes("keyword_list_table_wrap")) return emptyLocator;
      if (value.includes("当前筛选") && value.includes("preceding::*") && value.includes("following-sibling")) return polarDownloadLocator;
      if (value.includes("当前筛选") && value.includes("preceding::*") && value.includes("following::*")) return emptyLocator;
      if (value.includes("当前筛选") && value.includes("contains(@class,'download_icon')")) return workbookDownloadLocator;
      return buttonLocator;
    });
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");

    expect(polarDownloadLocator.click).not.toHaveBeenCalled();
    expect(workbookDownloadLocator.click).toHaveBeenCalled();
  });

  test("uses the keyword table toolbar download button even when it uses the polar download class", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const toolbarDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => false)
    };
    const genericDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined)
    };
    page.locator.mockImplementation((selector) => {
      const value = String(selector);
      if (value.includes("Sign in") || value.includes("Login")) return loginLocator;
      if (value.includes("keyword_list_table_wrap") && value.includes("downloadPolorBtn")) return toolbarDownloadLocator;
      if (value.includes("当前筛选")) return emptyLocator;
      return genericDownloadLocator;
    });
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");

    expect(toolbarDownloadLocator.click).toHaveBeenCalled();
    expect(genericDownloadLocator.click).not.toHaveBeenCalled();
  });

  test("patches SIF keyword download requests with the current ASIN and fixed 7 day period", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const continued = [];
    const route = {
      request: vi.fn(() => ({
        postData: vi.fn(() =>
          JSON.stringify({
            pageSize: 50,
            pageNum: 1,
            desc: true,
            conditions: ["totalPeriod.total"],
            keyword: "",
            sort: "scoreInfo.scoreRatio"
          })
        ),
        headers: vi.fn(() => ({ authorization: "keep-existing-auth" }))
      })),
      continue: vi.fn(async (options) => {
        continued.push(options);
      })
    };
    page.route.mockImplementationOnce(async (_pattern, handler) => {
      await handler(route);
    });
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");

    expect(page.route).toHaveBeenCalledWith("**/api/updown/asinKeywordList/download?**", expect.any(Function));
    expect(page.unroute).toHaveBeenCalledWith("**/api/updown/asinKeywordList/download?**", expect.any(Function));
    expect(continued).toHaveLength(1);
    expect(JSON.parse(continued[0].postData)).toMatchObject({
      asin: "B0DM96Z44F",
      listingSearch: false,
      timePieceType: "latelyDay",
      timePieceValue: "7",
      keywordSearch: "",
      sortBy: "scoreInfo.scoreRatio"
    });
    expect(continued[0].headers.authorization).toBe("keep-existing-auth");
  });

  test("skips SIF guide and tutorial controls instead of opening the help video", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-collector-"));
    const guideLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => true)
    };
    const workbookDownloadLocator = {
      ...buttonLocator,
      click: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => false)
    };
    page.locator.mockImplementation((selector) => {
      const value = String(selector);
      if (value.includes("Sign in") || value.includes("Login")) return loginLocator;
      if (selector === "text=流量词") return hiddenFlowTextLocator;
      if (value.includes("keyword_list_table_wrap")) return emptyLocator;
      if (value.includes("当前筛选") && value.includes("preceding::*") && value.includes("following-sibling")) return guideLocator;
      if (value.includes("当前筛选") && value.includes("preceding::*") && value.includes("following::*")) return emptyLocator;
      if (value.includes("当前筛选") && value.includes("contains(@class,'download_icon')")) return workbookDownloadLocator;
      return buttonLocator;
    });
    const collector = new Collector({ repository: {}, dataDir });

    await collector.downloadWorkbook("B0DM96Z44F");

    expect(guideLocator.click).not.toHaveBeenCalled();
    expect(workbookDownloadLocator.click).toHaveBeenCalled();
  });
});
