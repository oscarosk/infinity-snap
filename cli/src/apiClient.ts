// cli/src/apiClient.ts
import fetch from "node-fetch"; // or global fetch in Node 22

const BASE_URL = process.env.INFINITY_BACKEND_URL || "http://localhost:4000/api/v1";

export async function apiSnap(payload: any) {
  const res = await fetch(`${BASE_URL}/snap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`snap failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function apiGenerate(runId: string) {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function apiApply(runId: string, apply = false) {
  const res = await fetch(`${BASE_URL}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, apply }),
  });
  if (!res.ok) throw new Error(`apply failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function apiVerify(runId: string, command?: string) {
  const res = await fetch(`${BASE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command ? { runId, command } : { runId }),
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status} ${await res.text()}`);
  return res.json();
}
