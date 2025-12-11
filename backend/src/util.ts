// backend/src/util.ts
import fs from "fs/promises";
import path from "path";

/**
 * Create a temporary sandbox directory for InfinitySnap.
 *
 * Instead of using the OS global temp directory (like C:\Users\Oscar\AppData\Local\Temp),
 * we store all sandboxes inside the project under:
 *
 *    backend/.data/sandbox/snap-XXXXXX
 *
 * This keeps everything organized, easy to debug, and safe for cleanup.
 */
export async function makeTempDir(prefix = "snap"): Promise<string> {
  // Base folder: backend/.data/sandbox
  const baseRoot = path.join(__dirname, "..", ".data", "sandbox");

  // Ensure the directory exists
  await fs.mkdir(baseRoot, { recursive: true });

  // mkdtemp requires a prefix. It will create a folder like:
  // backend/.data/sandbox/snap-abc123
  const base = path.join(baseRoot, `${prefix}-`);
  const tmp = await fs.mkdtemp(base);

  return tmp;
}
