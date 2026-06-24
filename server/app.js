import express from "express";
import fs from "node:fs";
import path from "node:path";
import { Collector } from "./collector.js";
import { createDatabase, ensureDataDirs } from "./db.js";
import { COLLECTION_RETENTION_DAYS, Repository, normalizeAsin } from "./repository.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "1";
}

export async function createApp({ dataDir = path.resolve("data"), useVite = process.env.NODE_ENV !== "production" } = {}) {
  const startedAt = new Date().toISOString();
  ensureDataDirs(dataDir);
  const db = createDatabase(path.join(dataDir, "app.db"));
  const repository = new Repository({ db, dataDir });
  const collector = new Collector({ repository, dataDir });

  const app = express();
  app.locals.repository = repository;
  app.locals.db = db;
  app.locals.collector = collector;
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, startedAt });
  });

  app.get("/api/asins", (req, res) => {
    res.json({ items: repository.listAsins({ includeDeleted: parseBoolean(req.query.includeDeleted) }) });
  });

  app.post("/api/asins", (req, res) => {
    const result = repository.upsertAsin(req.body?.asin);
    res.status(result.created ? 201 : 200).json(result.item);
  });

  app.patch("/api/asins/:asin", (req, res) => {
    res.json(repository.patchAsin(req.params.asin, req.body || {}));
  });

  app.get("/api/block-words", (_req, res) => {
    res.json({ items: repository.listBlockWords() });
  });

  app.post("/api/block-words", (req, res) => {
    res.status(201).json(repository.addBlockWord(req.body?.word));
  });

  app.delete("/api/block-words/:id", (req, res) => {
    repository.deleteBlockWord(req.params.id);
    res.status(204).end();
  });

  app.get("/api/collections", (req, res) => {
    res.json({
      retentionDays: COLLECTION_RETENTION_DAYS,
      items: repository.listCollections({
        asin: req.query.asin,
        date: req.query.date,
        fromDate: req.query.fromDate,
        toDate: req.query.toDate
      })
    });
  });

  app.post(
    "/api/collections/run",
    asyncRoute(async (req, res) => {
      const requested = Array.isArray(req.body?.asins)
        ? req.body.asins.map(normalizeAsin)
        : repository
            .listAsins()
            .filter((asin) => asin.isEnabled && !asin.isDeleted)
            .map((asin) => asin.asin);
      if (!requested.length) {
        res.status(400).json({ error: "没有可采集的 ASIN" });
        return;
      }
      if (collector.isRunning()) {
        res.status(409).json({ error: "采集任务正在运行中, 请等待当前任务完成后再试" });
        return;
      }
      res.status(202).json({ accepted: requested });
      collector
        .runQueue(requested)
        .then((results) => {
          const failed = results.filter((result) => result.status === "failed");
          if (failed.length) console.error("[collector] failed", failed);
        })
        .catch((error) => {
          console.error("[collector] queue failed", error);
        });
    })
  );

  app.get("/api/keywords", (req, res) => {
    res.json({
      items: repository.getFilteredKeywords({
        asin: req.query.asin,
        collectionId: req.query.collectionId,
        date: req.query.date,
        search: req.query.search,
        showBlocked: parseBoolean(req.query.showBlocked),
        onlyFirstPage: parseBoolean(req.query.onlyFirstPage),
        spFilter: req.query.spFilter || ""
      })
    });
  });

  app.get("/api/dashboard", (req, res) => {
    res.json(repository.getDashboard({ asin: req.query.asin, collectionId: req.query.collectionId, date: req.query.date }));
  });

  if (useVite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const clientDir = path.resolve("dist/client");
    if (fs.existsSync(clientDir)) {
      app.use(express.static(clientDir));
      app.use((req, res, next) => {
        if (req.method === "GET" && !req.path.startsWith("/api/")) {
          res.sendFile(path.join(clientDir, "index.html"));
          return;
        }
        next();
      });
    }
  }

  app.use((error, _req, res, _next) => {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "服务器错误" });
  });

  return app;
}
