import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../server/app.js";

const sampleWorkbook = path.resolve(
  "C:/Users/god/Downloads/asinKeywords_B0DM96Z44F_1782265683901.xlsx"
);

describe("API", () => {
  let dataDir;
  let app;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sql-test-"));
    app = await createApp({ dataDir, useVite: false });
  });

  afterEach(() => {
    app?.locals?.db?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("creates ASINs idempotently and soft deletes without deleting history", async () => {
    await request(app).post("/api/asins").send({ asin: "B0DM96Z44F" }).expect(201);
    await request(app).post("/api/asins").send({ asin: "b0dm96z44f" }).expect(200);

    const asins = await request(app).get("/api/asins").expect(200);
    expect(asins.body.items).toHaveLength(1);
    expect(asins.body.items[0]).toMatchObject({ asin: "B0DM96Z44F", isEnabled: true });

    await request(app).patch("/api/asins/B0DM96Z44F").send({ isDeleted: true }).expect(200);
    const afterDelete = await request(app).get("/api/asins?includeDeleted=true").expect(200);
    expect(afterDelete.body.items[0].isDeleted).toBe(true);
  });

  test("does not expose a manual XLSX upload fallback endpoint", async () => {
    await request(app).post("/api/import/xlsx").expect(404);
  });

  test("rejects duplicate collection runs while a collection is already running", async () => {
    app.locals.collector.running = true;

    const response = await request(app).post("/api/collections/run").send({ asins: ["B0DM96Z44F"] }).expect(409);

    expect(response.body.error).toContain("采集任务正在运行中");
  });

  test("runs collection for all enabled ASINs when no ASIN list is provided", async () => {
    await request(app).post("/api/asins").send({ asin: "B0DM96Z44F" }).expect(201);
    await request(app).post("/api/asins").send({ asin: "B0FFSRD3DG" }).expect(201);
    await request(app).patch("/api/asins/B0FFSRD3DG").send({ isEnabled: false }).expect(200);
    const runQueue = vi.fn(async () => []);
    app.locals.collector.runQueue = runQueue;

    const response = await request(app).post("/api/collections/run").send({}).expect(202);

    expect(response.body.accepted).toEqual(["B0DM96Z44F"]);
    expect(runQueue).toHaveBeenCalledWith(["B0DM96Z44F"]);
  });

  test("reads an imported SIF batch and filters blocked keywords from dashboard and detail", async () => {
    await request(app).post("/api/asins").send({ asin: "B0DM96Z44F" }).expect(201);
    await request(app).post("/api/block-words").send({ word: "black" }).expect(201);
    app.locals.repository.importWorkbook({
      asin: "B0DM96Z44F",
      sourcePath: sampleWorkbook,
      sourceType: "sif_auto"
    });

    const dashboard = await request(app).get("/api/dashboard?asin=B0DM96Z44F").expect(200);
    expect(dashboard.body.summary.totalKeywords).toBe(412);
    expect(dashboard.body.summary.blockedKeywords).toBeGreaterThan(0);
    expect(dashboard.body.summary.visibleKeywords).toBeLessThan(412);
    expect(dashboard.body.distributions.organicByPage.p1).toBe(165);
    expect(dashboard.body.distributions.spByPage.p1).toBe(41);
    expect(dashboard.body.opportunities.counts.bothStrong).toBeGreaterThan(0);

    const visible = await request(app).get("/api/keywords?asin=B0DM96Z44F&search=black").expect(200);
    expect(visible.body.items).toHaveLength(0);

    const blocked = await request(app)
      .get("/api/keywords?asin=B0DM96Z44F&search=black&showBlocked=true")
      .expect(200);
    expect(blocked.body.items.length).toBeGreaterThan(0);
    expect(blocked.body.items[0].isBlocked).toBe(true);
    expect(blocked.body.items[0].blockedBy).toBe("black");
  });

  test("selects persisted collection data by collection date within the 180 day history window", async () => {
    await request(app).post("/api/asins").send({ asin: "B0DM96Z44F" }).expect(201);
    const first = app.locals.repository.importWorkbook({
      asin: "B0DM96Z44F",
      sourcePath: sampleWorkbook,
      sourceType: "sif_auto"
    });
    const second = app.locals.repository.importWorkbook({
      asin: "B0DM96Z44F",
      sourcePath: sampleWorkbook,
      sourceType: "sif_auto"
    });
    app.locals.db
      .prepare("UPDATE collections SET created_at = ?, completed_at = ? WHERE id = ?")
      .run("2026-06-01T03:00:00.000Z", "2026-06-01T03:05:00.000Z", first.collection.id);
    app.locals.db
      .prepare("UPDATE collections SET created_at = ?, completed_at = ? WHERE id = ?")
      .run("2026-06-18T03:00:00.000Z", "2026-06-18T03:05:00.000Z", second.collection.id);

    const collections = await request(app).get("/api/collections?asin=B0DM96Z44F&date=2026-06-18").expect(200);
    expect(collections.body.retentionDays).toBe(180);
    expect(collections.body.items.map((item) => item.id)).toEqual([second.collection.id]);

    const dashboard = await request(app).get("/api/dashboard?asin=B0DM96Z44F&date=2026-06-01").expect(200);
    expect(dashboard.body.collection.id).toBe(first.collection.id);

    const keywords = await request(app).get("/api/keywords?asin=B0DM96Z44F&date=2026-06-01").expect(200);
    expect(keywords.body.items[0].collectionId).toBe(first.collection.id);
  });
});
