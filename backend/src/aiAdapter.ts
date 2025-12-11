// backend/src/aiAdapter.ts

/**
 * AI adapter for InfinitySnap:
 * - mockGeneratePatch: simple local demo patch generator
 * - generatePatch: generic patch generator hook (currently demo-only)
 *
 * This file no longer depends on Oumi or any external AI service.
 * In the future, generatePatch can be wired to Cline, an LLM, or any
 * external patch engine as needed.
 */

import fs from "fs/promises";
import path from "path";

export type PatchFile = {
  path: string;
  before: string;
  after: string;
};

export type PatchSuggestion = {
  id?: string; // optional candidate id (used for Kestra + aggregation)
  files: PatchFile[];
  message?: string;
  confidence?: number;
  notes?: string;
  provenance?: { sourceRepos?: string[] };
};

// Explicit demo mode flag: only then we use mockGeneratePatch.
const DEMO_MODE = process.env.INFINITYSNAP_DEMO_MODE === "true";

// --------------------------
// Demo / local: mockGeneratePatch
// --------------------------
/**
 * mockGeneratePatch:
 * - Demo-only: only returns a suggestion if repoPath/index.js contains "throw new Error("
 * - Returns a PatchSuggestion that comments out the explicit throw.
 */
export async function mockGeneratePatch(opts: {
  repoPath: string;
  primaryError: string;
  logs?: string;
}): Promise<PatchSuggestion | null> {
  const { repoPath } = opts;
  const target = path.join(repoPath, "index.js");

  try {
    const before = await fs.readFile(target, "utf8");

    // Demo heuristic: only produce patch if explicit throw exists
    if (!/throw new Error\(/.test(before)) return null;

    const after = before.replace(
      /throw new Error\([^)]*\);?/,
      "// InfinitySnap (demo): commented out throw"
    );

    const suggestion: PatchSuggestion = {
      id: "demo-1",
      files: [{ path: target, before, after }],
      message: "Demo: comment out explicit throw in index.js",
      confidence: 0.82,
      notes:
        "Demo patch — only applied when index.js contains an explicit `throw new Error(...)`.",
      provenance: { sourceRepos: [] },
    };

    // Simulate small latency
    await new Promise((r) => setTimeout(r, 300));
    return suggestion;
  } catch {
    // If file read fails or anything else happens, return null (no suggestion)
    return null;
  }
}

// --------------------------
// Helpers for payload safety (kept for future use)
// --------------------------

const MAX_CONTEXT_FILES = 8;
const MAX_FILE_CONTENT_CHARS = 4000;

/**
 * Clamp context files to avoid sending huge payloads to any future external engine.
 */
function sanitizeContextFiles(
  contextFiles: { path: string; content: string }[] = []
) {
  return contextFiles.slice(0, MAX_CONTEXT_FILES).map((f) => ({
    path: f.path,
    content:
      f.content.length > MAX_FILE_CONTENT_CHARS
        ? f.content.slice(0, MAX_FILE_CONTENT_CHARS) +
          "\n/* [InfinitySnap] truncated for context */"
        : f.content,
  }));
}

function uniqueStrings(values: string[] = []): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// --------------------------
// Main: generatePatch (no external deps)
// --------------------------
/**
 * generatePatch:
 * - Generic patch generator hook.
 * - Currently:
 *   - If INFINITYSNAP_DEMO_MODE=true → uses mockGeneratePatch.
 *   - Otherwise → returns null (no suggestion).
 *
 * In the future, this function can be extended to call Cline,
 * a local LLM, or any external patch engine.
 */
export async function generatePatch(opts: {
  repoPath: string;
  primaryError: string;
  contextFiles?: { path: string; content: string }[]; // small snippets
  topRepos?: string[]; // optional list of related official repos (from Cline)
}): Promise<PatchSuggestion[] | null> {
  const { repoPath, primaryError, contextFiles = [], topRepos = [] } = opts;

  // Currently unused, but kept to show future use for payload limiting:
  void sanitizeContextFiles(contextFiles);
  void uniqueStrings(topRepos);

  if (!DEMO_MODE) {
    // Real backend mode: no external patch engine wired yet.
    return null;
  }

  const mock = await mockGeneratePatch({ repoPath, primaryError });
  return mock ? [mock] : null;
}

// --------------------------
// Backwards-compatibility exports
// --------------------------

/**
 * isOumiConfigured is kept for compatibility but always false now,
 * since we no longer integrate Oumi.
 */
export const isOumiConfigured = false;

/**
 * generatePatchWithOumi is kept as an alias for generatePatch so any
 * existing imports keep working. It no longer talks to Oumi.
 */
export async function generatePatchWithOumi(opts: {
  repoPath: string;
  primaryError: string;
  contextFiles?: { path: string; content: string }[];
  topRepos?: string[];
}): Promise<PatchSuggestion[] | null> {
  return generatePatch(opts);
}
