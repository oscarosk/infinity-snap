// backend/src/index.ts
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import cors from "cors";
import routes from "./routes";

dotenv.config();

function validateEnv() {
  const warns: string[] = [];
  if (!process.env.BACKEND_API_KEY)
    warns.push("BACKEND_API_KEY not set → API endpoints are open.");
  if (!process.env.OPENAI_API_KEY && !process.env.OUMI_API_KEY)
    warns.push(
      "OPENAI_API_KEY / OUMI_API_KEY missing → patch generation may fail (depends on your aiAdapter)."
    );
  if (warns.length) console.warn("[env]", warns.join(" | "));
}

validateEnv();

const app = express();

// Trust reverse proxies (Render/Vercel/Nginx)
app.set("trust proxy", true);

// CORS
const origins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origins.includes("*") ? true : origins,
    credentials: true,
  })
);

// Body parsing + logging
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// API routes (IMPORTANT: CLI expects /api/v1)
app.use("/api/v1", routes);

// Root endpoints
app.get("/", (_req, res) => {
  res.send("InfinitySnap backend — up and running");
});

// Keep a root /health for convenience
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), service: "InfinitySnap backend" });
});

// ✅ IMPORTANT FIX:
// Bind to 0.0.0.0 so WSL/containers/other devices can reach it if needed.
const port = parseInt(process.env.PORT || "4000", 10);
const host = (process.env.HOST || "0.0.0.0").trim();

app.listen(port, host, () => {
  console.log(`InfinitySnap backend running → http://${host}:${port}`);
  console.log(`API base → http://${host}:${port}/api/v1`);
});

export default app;
