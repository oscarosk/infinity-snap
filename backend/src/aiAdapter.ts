// backend/src/aiAdapter.ts
/**
 * Real patch generation adapter for InfinitySnap (OpenAI-only)
 *
 * Goals:
 * - Never hang: hard HTTP timeout (AbortController)
 * - Fail-fast if not configured
 * - Return deterministic JSON-only suggestions
 *
 * Required env:
 *   OPENAI_API_KEY
 *
 * Optional:
 *   OPENAI_PATCH_MODEL (default: gpt-5-mini)
 *   PATCH_MAX_CONTEXT_FILES (default: 6)
 *   PATCH_MAX_CHARS_PER_FILE (default: 12000)
 *   PATCH_MAX_TOKENS (default: 1800)
 *   PATCH_MAX_CANDIDATES (default: 3)
 *   OPENAI_TIMEOUT_MS (default: 12000)
 */

export type PatchFile = {
  path: string;   // repo-relative path
  before: string; // best-effort
  after: string;  // required
};

export type PatchSuggestion = {
  id?: string;
  files: PatchFile[];
  message?: string;
  confidence?: number; // 0..100
  notes?: string;
  provenance?: { sourceRepos?: string[] };
};

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function mustEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing ${name}. Patch engine is not configured.`);
  return v;
}

function intEnv(name: string, def: number): number {
  const n = Number(env(name));
  if (!Number.isFinite(n) || n <= 0) return def;
  return n;
}

/** Keep prompt small & deterministic */
function buildPrompt(opts: {
  repoPath: string;
  primaryError: string;
  contextFiles?: { path: string; content: string }[];
  topRepos?: string[];
}) {
  const maxFiles = intEnv("PATCH_MAX_CONTEXT_FILES", 6);
  const maxCharsPerFile = intEnv("PATCH_MAX_CHARS_PER_FILE", 12000);

  const ctx = (opts.contextFiles || [])
    .slice(0, maxFiles)
    .map((f) => ({
      path: f.path,
      content: (f.content || "").slice(0, maxCharsPerFile),
    }));

  const system = [
    "You are InfinitySnap, an expert software repair agent.",
    "Return ONLY valid JSON. No markdown. No commentary.",
    "Propose minimal safe edits that fix the error.",
    "Use repo-relative file paths only. Never absolute paths.",
    'If uncertain, return {"suggestions": []}.',
  ].join(" ");

  const user = {
    task: "Generate code patches to fix the failing project.",
    repoPath: opts.repoPath,
    primaryError: (opts.primaryError || "").slice(0, 2000),
    contextFiles: ctx,
    sourceRepos: (opts.topRepos || []).slice(0, 6),
    outputSchema: {
      suggestions: [
        {
          id: "string-optional",
          confidence: "number-0-to-100-optional",
          message: "string-optional",
          notes: "string-optional",
          provenance: { sourceRepos: ["string"] },
          files: [{ path: "repo-relative-path", before: "string", after: "string" }],
        },
      ],
    },
  };

  return { system, user };
}

/** Parse JSON safely from model output */
function parseSuggestions(raw: string): PatchSuggestion[] {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Model did not return valid JSON.");
    obj = JSON.parse(m[0]);
  }

  const suggestions = Array.isArray(obj?.suggestions) ? obj.suggestions : [];

  const cleaned: PatchSuggestion[] = [];
  for (const s of suggestions) {
    if (!s || !Array.isArray(s.files) || !s.files.length) continue;

    const files: PatchFile[] = [];
    for (const f of s.files) {
      if (!f?.path || typeof f.after !== "string") continue;
      if (typeof f.path !== "string") continue;

      // repo-relative only; no traversal
      if (f.path.startsWith("/") || f.path.includes("..")) continue;

      files.push({
        path: f.path,
        before: typeof f.before === "string" ? f.before : "",
        after: f.after,
      });
    }
    if (!files.length) continue;

    cleaned.push({
      id: typeof s.id === "string" ? s.id : undefined,
      confidence: typeof s.confidence === "number" ? s.confidence : undefined,
      message: typeof s.message === "string" ? s.message : undefined,
      notes: typeof s.notes === "string" ? s.notes : undefined,
      provenance:
        s.provenance && typeof s.provenance === "object"
          ? {
              sourceRepos: Array.isArray(s.provenance.sourceRepos)
                ? s.provenance.sourceRepos
                : undefined,
            }
          : undefined,
      files,
    });
  }

  return cleaned;
}

async function callOpenAI(prompt: { system: string; user: any }): Promise<string> {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const model = (env("OPENAI_PATCH_MODEL") || "gpt-5-mini").trim();
  const timeoutMs = intEnv("OPENAI_TIMEOUT_MS", 12_000);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: prompt.system },
          { role: "user", content: JSON.stringify(prompt.user) },
        ],
        max_output_tokens: intEnv("PATCH_MAX_TOKENS", 1800),
        temperature: 0.2,
        store: false,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`OpenAI error ${resp.status}: ${t.slice(0, 600)}`);
    }

    const data: any = await resp.json();

    // Prefer `output_text`, fallback to scanning output blocks
    const text =
      data?.output_text ||
      (Array.isArray(data?.output)
        ? data.output
            .flatMap((it: any) => it?.content || [])
            .filter((c: any) => c?.type === "output_text" && typeof c?.text === "string")
            .map((c: any) => c.text)
            .join("\n")
        : "");

    return String(text || "");
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`OpenAI timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function generatePatch(opts: {
  repoPath: string;
  primaryError: string;
  contextFiles?: { path: string; content: string }[];
  topRepos?: string[];
}): Promise<PatchSuggestion[]> {
  const prompt = buildPrompt(opts);
  const raw = await callOpenAI(prompt);
  const suggestions = parseSuggestions(raw);

  const max = intEnv("PATCH_MAX_CANDIDATES", 3);
  return suggestions.slice(0, Math.max(1, max));
}

/**
 * Backwards compatibility alias.
 * routes.ts already imports this name.
 */
export async function generatePatchWithOumi(opts: {
  repoPath: string;
  primaryError: string;
  contextFiles?: { path: string; content: string }[];
  topRepos?: string[];
}): Promise<PatchSuggestion[]> {
  return generatePatch(opts);
}
