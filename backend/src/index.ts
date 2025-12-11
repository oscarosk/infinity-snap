// backend/src/index.ts
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import cors from "cors";
import routes from "./routes";

dotenv.config();

const app = express();

// Trust reverse proxies (useful on Render / Vercel / Nginx, harmless locally)
app.set("trust proxy", true);

// Body parsing, CORS & logging
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// API routes
app.use("/api/v1", routes);

// simple root
app.get("/", (_req, res) => {
  res.send("InfinitySnap backend — up and running");
});

// optional: simple health at root level too
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), service: "InfinitySnap backend" });
});

const port = parseInt(process.env.PORT || "4000", 10);
app.listen(port, () => {
  console.log(`InfinitySnap backend running → http://localhost:${port}`);
});

export default app;
