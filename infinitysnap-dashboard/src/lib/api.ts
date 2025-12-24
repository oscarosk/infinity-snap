// src/lib/api.ts

/**
 * Codespaces rule:
 * - If NEXT_PUBLIC_BACKEND_URL points to localhost / 127.0.0.1, the BROWSER will hit its own machine and fail.
 * - So we ignore those values and use the Next rewrite proxy at /api/v1 instead.
 */

function trimSlashEnd(s: string) {
  return String(s || "").replace(/\/+$/, "");
}

const RAW_ROOT = trimSlashEnd(process.env.NEXT_PUBLIC_BACKEND_URL || "");

// If env points to a local address, it's only valid inside the container, not in the browser.
// In Codespaces preview we must use same-origin proxy (/api/v1).
const isLocalRoot =
  /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(RAW_ROOT);

const ROOT = RAW_ROOT && !isLocalRoot ? RAW_ROOT : "";

// Always talk to /api/v1 (proxy) unless ROOT is a real reachable URL
export const API_BASE = ROOT ? `${ROOT}/api/v1` : "/api/v1";

// For display only (judge/debug panels)
export const BACKEND_URL = ROOT || "(proxied via Next /api/v1)";

/**
 * Fetch JSON-only endpoints.
 */
async function apiFetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch endpoint that may return:
 * - application/json
 * - text/plain
 *
 * Always returns a STRING.
 */
async function apiFetchTextMaybe(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API ${res.status}`);
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("application/json")) {
    const json = await res.json().catch(() => null);
    if (json == null) return "";
    try {
      return JSON.stringify(json, null, 2);
    } catch {
      return String(json);
    }
  }

  return res.text();
}

function unwrapRuns(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.runs)) return payload.runs;
  if (payload && payload.data && Array.isArray(payload.data.runs)) return payload.data.runs;
  return [];
}

// =====================================================
// Runs API
// =====================================================

export async function listRuns() {
  const payload = await apiFetchJSON<any>("/runs");
  return unwrapRuns(payload);
}

export async function getRun(runId: string) {
  return apiFetchJSON<any>(`/runs/${encodeURIComponent(runId)}`);
}

export async function getRunLogs(runId: string) {
  return apiFetchJSON<any>(`/runs/${encodeURIComponent(runId)}/logs`);
}

export async function getRunDiff(runId: string) {
  return apiFetchTextMaybe(`/runs/${encodeURIComponent(runId)}/diff`);
}

export async function getRunPatch(runId: string) {
  return apiFetchTextMaybe(`/runs/${encodeURIComponent(runId)}/patch`);
}

export async function getRunTimeline(runId: string) {
  return apiFetchTextMaybe(`/runs/${encodeURIComponent(runId)}/timeline`);
}

export async function getRunTimelineJson(runId: string) {
  return apiFetchJSON<any>(`/runs/${encodeURIComponent(runId)}/timeline.json`);
}
