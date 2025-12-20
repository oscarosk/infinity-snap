// backend/src/clineClient.ts
import { exec as _exec } from "child_process";
import util from "util";
import axios from "axios";

const exec = util.promisify(_exec);

// Default to "cline" (Cline CLI) – override via env if needed
const CLINE_CLI_PATH = process.env.CLINE_CLI_PATH || "cline";

// Optional HTTP MCP proxy base URL, e.g. http://localhost:8787
const CLINE_MCP_BASE_URL = process.env.CLINE_MCP_BASE_URL || "";

/**
 * clineSearchDocs:
 * - First tries an HTTP MCP endpoint (if CLINE_MCP_BASE_URL is set).
 * - Fallback: shell out to Cline CLI to perform a search.
 * - Returns a list of repo identifiers/URLs (strings).
 */
export async function clineSearchDocs(query: string): Promise<string[]> {
  const q = (query || "").trim();
  if (!q) return [];

  // 1) Try HTTP MCP first if configured
  if (CLINE_MCP_BASE_URL) {
    try {
      const resp = await axios.get(`${CLINE_MCP_BASE_URL}/search`, {
        params: { q },
        timeout: 15_000,
      });

      const results: any[] = Array.isArray(resp.data?.results)
        ? resp.data.results
        : [];

      return results
        .map((r: any) => r?.repo || r?.url || "")
        .filter(Boolean);
    } catch (e: any) {
      console.warn(
        "[clineClient] MCP http search failed, falling back to CLI:",
        e?.message || e
      );
    }
  }

  // 2) Fallback: shell out to Cline CLI
  try {
    // Example: cline search "<query>" --output-format json --no-interactive
    // Escape double quotes inside query to keep shell happy.
    const safeQuery = q.replace(/"/g, '\\"');

    // NOTE: modern Cline uses -F/--output-format instead of --format
    const cmd = `${CLINE_CLI_PATH} search "${safeQuery}" --output-format json --no-interactive`;

    const { stdout } = await exec(cmd, { timeout: 15_000 });

    let parsed: any = null;
    try {
      // trim just in case there is extra whitespace / newlines
      parsed = JSON.parse((stdout || "").trim());
    } catch (parseErr: any) {
      console.warn(
        "[clineClient] clineSearchDocs: failed to parse CLI JSON:",
        parseErr?.message || parseErr
      );
      return [];
    }

    const results: any[] = Array.isArray(parsed?.results)
      ? parsed.results
      : [];

    return results
      .map((r: any) => r?.repo || r?.url || "")
      .filter(Boolean);
  } catch (e: any) {
    console.warn("[clineClient] Cline CLI search failed:", e?.message || e);
    return [];
  }
}

/**
 * clineFetchExample:
 * - Tries to fetch sample files from a repo using HTTP MCP (if configured).
 * - Fallback: for GitHub repos, fetches a couple of raw files like package.json / README.md.
 */
export async function clineFetchExample(
  repoUrl: string,
  path = ""
): Promise<{ path: string; content: string }[]> {
  const repo = (repoUrl || "").trim();
  if (!repo) return [];

  // 1) Try HTTP MCP files endpoint
  if (CLINE_MCP_BASE_URL) {
    try {
      const resp = await axios.get(`${CLINE_MCP_BASE_URL}/repo/files`, {
        params: { repo, path },
        timeout: 15_000,
      });

      const files: any[] = Array.isArray(resp.data?.files)
        ? resp.data.files
        : [];

      return files.map((f: any) => ({
        path: f?.path ?? "unknown",
        content: f?.content ?? "",
      }));
    } catch (e: any) {
      console.warn(
        "[clineClient] Cline MCP repo/files failed:",
        e?.message || e
      );
    }
  }

  // 2) Fallback: try fetching raw from GitHub (if repoUrl is GitHub)
  try {
    if (repo.includes("github.com")) {
      // Convert standard GitHub URL to raw content base
      const rawBase = repo
        .replace("github.com", "raw.githubusercontent.com")
        .replace(/\/tree\//, "/");

      // We'll attempt to fetch package.json and README.md as simple context
      const targets = ["/package.json", "/README.md"].map(
        (p) => rawBase + p
      );

      const files: { path: string; content: string }[] = [];

      for (const t of targets) {
        try {
          const r = await axios.get(t, { timeout: 8_000 });
          files.push({
            path: t,
            content:
              typeof r.data === "string"
                ? r.data
                : JSON.stringify(r.data, null, 2),
          });
        } catch {
          // ignore per-file fetch errors; just skip that file
        }
      }

      return files;
    }
  } catch {
    // ignore outer errors; fall through to empty array
  }

  // No MCP, no usable GitHub pattern, or everything failed.
  return [];
}
