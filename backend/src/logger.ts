// backend/src/logger.ts
import fs from "fs/promises";
import path from "path";

function safeJson(x: any) {
  try {
    return JSON.stringify(x);
  } catch {
    return '"[unserializable]"';
  }
}

/**
 * Append a single trace line to a file.
 * This must never crash the server.
 */
export async function trace(filePath: string | null | undefined, event: string, data: any = {}) {
  if (!filePath) return;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = `[${new Date().toISOString()}] ${event} ${safeJson(data)}\n`;
    await fs.appendFile(filePath, line, "utf8");
  } catch {
    // best-effort only
  }
}
