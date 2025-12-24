// cli/src/apiClient.ts
import axios from "axios";
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  ResponseType,
} from "axios";
import { API_BASE, API_KEY } from "./config";

type ApiOk<T> = T;
type AnyObj = Record<string, any>;

function isAxiosError(e: any): e is AxiosError {
  return !!e?.isAxiosError;
}

function isTimeoutError(e: any): boolean {
  // axios timeout typically sets code = 'ECONNABORTED'
  return !!(
    e &&
    (e.code === "ECONNABORTED" ||
      String(e.message || "").toLowerCase().includes("timeout"))
  );
}

function isConnRefused(e: any): boolean {
  const code = String((e as any)?.code || "");
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH";
}

function briefAxiosError(e: unknown, label: string, url: string) {
  if (!isAxiosError(e)) {
    return `${label}: ${String((e as any)?.message || e)} (${url})`;
  }

  const status = e.response?.status;
  const statusText = e.response?.statusText;
  const code = (e as any)?.code;

  const body: any = e.response?.data;
  const backendMsg =
    typeof body === "object" && body && (body.error || body.message)
      ? String(body.error || body.message)
      : null;

  const parts = [
    `${label}: request failed`,
    isTimeoutError(e) ? `(timeout)` : null,
    status ? `HTTP ${status}${statusText ? ` ${statusText}` : ""}` : null,
    code && !isTimeoutError(e) ? `(${code})` : null,
    backendMsg ? `→ ${backendMsg}` : null,
  ].filter(Boolean);

  return `${parts.join(" ")} — ${url}`;
}

// ---- Timeout helpers ----
function toMs(v: unknown, fallbackMs: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallbackMs;
}

function makeClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE,
    // Default for normal calls; per-request overrides below.
    timeout: toMs(process.env.INFINITYSNAP_HTTP_TIMEOUT_MS, 60_000),
    headers: {
      "Content-Type": "application/json",
      "X-InfinitySnap-Client": "cli",
    },
    validateStatus: () => true,
  });

  // Inject X-Request-Id + x-api-key (if configured)
  client.interceptors.request.use((cfg) => {
    const rid = `${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2, 8)}`;

    cfg.headers = cfg.headers || {};
    const h = cfg.headers as AnyObj;

    h["X-Request-Id"] = rid;

    if (API_KEY) {
      h["x-api-key"] = API_KEY;
    }

    return cfg;
  });

  return client;
}

const http = makeClient();

async function getJson<T>(path: string, cfg: AxiosRequestConfig = {}): Promise<ApiOk<T>> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await http.get(path, cfg);

    if (res.status >= 200 && res.status < 300) return res.data as T;

    const msg =
      res.data &&
      typeof res.data === "object" &&
      (res.data.error || res.data.message)
        ? String(res.data.error || res.data.message)
        : `HTTP ${res.status}`;

    throw new Error(`${msg} — ${url}`);
  } catch (e) {
    throw new Error(briefAxiosError(e, "GET", url));
  }
}

async function postJson<T>(path: string, body: any, cfg: AxiosRequestConfig = {}): Promise<ApiOk<T>> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await http.post(path, body, cfg);

    if (res.status >= 200 && res.status < 300) return res.data as T;

    const msg =
      res.data &&
      typeof res.data === "object" &&
      (res.data.error || res.data.message)
        ? String(res.data.error || res.data.message)
        : `HTTP ${res.status}`;

    throw new Error(`${msg} — ${url}`);
  } catch (e) {
    throw new Error(briefAxiosError(e, "POST", url));
  }
}

// -------------------------
// API surface
// -------------------------

export async function apiSnap(payload: any) {
  const httpTimeout = toMs(process.env.INFINITYSNAP_SNAP_HTTP_TIMEOUT_MS, 20 * 60_000);
  return postJson<any>("/snap", payload, { timeout: httpTimeout });
}

export async function apiAnalyze(payload: any) {
  const timeout = toMs(process.env.INFINITYSNAP_ANALYZE_TIMEOUT_MS, 120_000);
  return postJson<any>("/analyze", payload, { timeout });
}

export async function apiGenerate(runId: string) {
  const timeout = toMs(process.env.INFINITYSNAP_GEN_TIMEOUT_MS, 300_000);
  return postJson<any>("/generate", { runId }, { timeout });
}

export async function apiApply(runId: string, apply = false) {
  const timeout = toMs(process.env.INFINITYSNAP_APPLY_TIMEOUT_MS, 300_000);
  return postJson<any>("/apply", { runId, apply }, { timeout });
}

export async function apiVerify(runId: string, command?: string) {
  const timeout = toMs(process.env.INFINITYSNAP_VERIFY_TIMEOUT_MS, 20 * 60_000);
  const body = command ? { runId, command } : { runId };
  return postJson<any>("/verify", body, { timeout });
}

/**
 * ✅ FIXED FOR YOUR ISSUE:
 * apiFix should NOT time out by default, because backend fix can legitimately take minutes.
 *
 * - axios timeout: 0 (no timeout) by default
 * - you can still override via INFINITYSNAP_FIX_HTTP_TIMEOUT_MS if you want
 *
 * IMPORTANT:
 * - Only fall back to local Cline on REAL backend errors / unreachable backend,
 *   NOT because the request took too long.
 */
export async function apiFix(
  runId: string,
  opts?: { command?: string; timeoutMs?: number; dockerImage?: string; task?: string }
) {
  // 0 = no timeout in axios
  const httpTimeout = toMs(process.env.INFINITYSNAP_FIX_HTTP_TIMEOUT_MS, 0);

  // send timeoutMs only if caller explicitly sets it
  const body: any = { ...(opts || {}) };
  if (opts?.timeoutMs != null) body.timeoutMs = opts.timeoutMs;

  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/fix`;

  try {
    // we call postJson but with explicit timeout override
    return await postJson<any>(`/runs/${encodeURIComponent(runId)}/fix`, body, {
      timeout: httpTimeout,
    });
  } catch (e: any) {
    // If backend is unreachable/refused, that's a valid reason to fall back.
    if (isAxiosError(e) && (isConnRefused(e) || isTimeoutError(e))) {
      throw e;
    }
    // Otherwise bubble the error: CLI should treat as backend failure (not "timeout")
    throw e;
  }
}

export async function apiResults() {
  return getJson<any>("/results", { timeout: 15_000 });
}

export async function apiResultFile(file: string) {
  return getJson<any>(`/results/${encodeURIComponent(file)}`, { timeout: 15_000 });
}

export async function apiTimelineTxt(runId: string) {
  const cfg: AxiosRequestConfig = {
    timeout: toMs(process.env.INFINITYSNAP_TIMELINE_TIMEOUT_MS, 30_000),
    responseType: "text" as ResponseType,
    transformResponse: (x) => x,
  };

  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/timeline`;
  try {
    const res = await http.get(`/runs/${encodeURIComponent(runId)}/timeline`, cfg);
    if (res.status >= 200 && res.status < 300) return String(res.data ?? "");
    throw new Error(`HTTP ${res.status} — ${url}`);
  } catch (e) {
    throw new Error(briefAxiosError(e, "GET", url));
  }
}

export async function apiTimelineJson(runId: string) {
  const timeout = toMs(process.env.INFINITYSNAP_TIMELINE_TIMEOUT_MS, 30_000);
  return getJson<any>(`/runs/${encodeURIComponent(runId)}/timeline.json`, { timeout });
}
