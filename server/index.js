import path from "node:path";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.DATA_DIR || path.resolve("data");

const app = await createApp({ dataDir });
app.listen(port, host, () => {
  console.log(`SIF ASIN dashboard listening on http://${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
});
