// backend/src/analyzer.ts

export type ErrorKind =
  | "syntax"
  | "type"
  | "reference"
  | "runtime"
  | "timeout"
  | "test-failure"
  | "unknown";

export type ErrorLocation = {
  file: string;
  line?: number;
  column?: number;
  raw?: string; // raw line where we saw this location
};

export type Analysis = {
  // original fields (kept for compatibility)
  errorDetected: boolean;
  stackDetected: boolean;
  errors: string[];
  warnings: string[];
  stack: string[];
  summary: string;
  confidence: number; // 0..100

  // new richer metadata (all optional so nothing breaks)
  primaryErrorLine?: string;
  primaryErrorKind?: ErrorKind;
  primaryLocations?: ErrorLocation[];
  languageGuess?: string; // "javascript" | "typescript" | "python" | "cpp" | "java" | "unknown"
};

// --------------------------
// Regex helpers
// --------------------------

// generic error tokens
const ERROR_REGEXES = [
  /Error:/i,
  /\bException\b/i,
  /\bTypeError\b/i,
  /\bReferenceError\b/i,
  /\bSyntaxError\b/i,
  /\bUnhandledRejection\b/i,
  /\bAssertionError\b/i,
  /\bFAIL\b/i,
  /\bEADDRINUSE\b/i,
  /\bENOENT\b/i,
];

// node / js stack lines: "    at func (file:line:col)" or "at file:line:col"
const STACK_LINE_RE = /^\s*at\s+/i;

// warnings
const WARNING_RE = /\bwarn(?:ing)?\b/i;

// explicit test failure / timeout hints (Jest, Vitest, etc.)
const TEST_FAIL_HINTS = [
  /\bTest Suites?:\s*failed/i,
  /\bTests?:\s*failed/i,
  /\bexpected\b.*\breceived\b/i,
];

const TIMEOUT_HINTS = [
  /\btimeout\b/i,
  /\btimed out\b/i,
  /did not exit one second after the test run/i,
];

// file:line[:column] patterns (Node, TS, GCC, Jest, etc.)
const FILE_LOC_PATTERNS: RegExp[] = [
  // /path/to/file.js:12:34
  /(?<file>[^\s:()]+?\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|java|cpp|cc|c|hpp|h)):(?<line>\d+):(?<col>\d+)/,
  // /path/to/file.js:12
  /(?<file>[^\s:()]+?\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|java|cpp|cc|c|hpp|h)):(?<line>\d+)/,
  // TypeScript style: file.ts(12,34)
  /(?<file>[^\s()]+?\.(?:ts|tsx|js|jsx))\((?<line>\d+),(?<col>\d+)\)/,
];

// --------------------------
// Language heuristics
// --------------------------

function guessLanguage(allText: string): string {
  const t = allText.toLowerCase();

  if (t.includes("traceback (most recent call last)") || t.includes(".py")) {
    return "python";
  }
  if (
    t.includes("typescript") ||
    t.includes(".ts(") ||
    t.includes("tsc ") ||
    t.includes(".tsx")
  ) {
    return "typescript";
  }
  if (
    t.includes("node:internal") ||
    t.includes("node:") ||
    t.includes(".js:") ||
    t.includes("typeerror:") ||
    t.includes("referenceerror:")
  ) {
    return "javascript";
  }
  if (t.includes("java.lang.") || t.includes(".java:")) {
    return "java";
  }
  if (
    t.includes("error: expected") ||
    t.includes("fatal error:") ||
    t.includes(".cpp:") ||
    t.includes(".hpp:")
  ) {
    return "cpp";
  }

  return "unknown";
}

// --------------------------
// Error kind classification
// --------------------------

function classifyErrorKind(line: string, allText: string): ErrorKind {
  const l = line.toLowerCase();
  const t = allText.toLowerCase();

  if (
    l.includes("syntaxerror") ||
    l.includes("parse error") ||
    l.includes("unexpected token") ||
    l.includes("unexpected end of input")
  ) {
    return "syntax";
  }

  if (l.includes("typeerror") || (l.includes("ts") && l.includes("type"))) {
    return "type";
  }

  if (
    l.includes("referenceerror") ||
    l.includes("is not defined") ||
    l.includes("cannot find name")
  ) {
    return "reference";
  }

  if (
    TIMEOUT_HINTS.some((re) => re.test(l)) ||
    TIMEOUT_HINTS.some((re) => re.test(t))
  ) {
    return "timeout";
  }

  if (
    l.includes("assertionerror") ||
    (l.includes("expected") && l.includes("received")) ||
    (l.includes("expected:") && l.includes("received:")) ||
    TEST_FAIL_HINTS.some((re) => re.test(l)) ||
    TEST_FAIL_HINTS.some((re) => re.test(t))
  ) {
    return "test-failure";
  }

  if (l.includes("error") || l.includes("exception")) {
    return "runtime";
  }

  if (t.includes("error") || t.includes("exception")) {
    return "runtime";
  }

  return "unknown";
}

// --------------------------
// Location extraction
// --------------------------

function extractLocations(lines: string[]): ErrorLocation[] {
  const out: ErrorLocation[] = [];

  for (const line of lines) {
    for (const re of FILE_LOC_PATTERNS) {
      const m = line.match(re);
      if (m && (m as any).groups && (m as any).groups.file) {
        const groups = (m as any).groups as {
          file: string;
          line?: string;
          col?: string;
        };

        const file = groups.file;
        const lineNum = groups.line ? parseInt(groups.line, 10) : undefined;
        const colNum = groups.col ? parseInt(groups.col, 10) : undefined;

        out.push({
          file,
          line: lineNum && !Number.isNaN(lineNum) ? lineNum : undefined,
          column: colNum && !Number.isNaN(colNum) ? colNum : undefined,
          raw: line,
        });

        // at most one location per line
        break;
      }
    }
  }

  return out;
}

// --------------------------
// Core analysis helpers
// --------------------------

function analyzeCombinedText(stdout: string, stderr: string): Analysis {
  const combined = `${stdout || ""}\n${stderr || ""}`;
  const trimmed = combined.trim();
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);

  const errors: string[] = [];
  const warnings: string[] = [];
  const stack: string[] = [];

  for (const l of lines) {
    if (ERROR_REGEXES.some((re) => re.test(l))) {
      errors.push(l);
      continue;
    }
    if (STACK_LINE_RE.test(l)) {
      stack.push(l);
      continue;
    }
    if (WARNING_RE.test(l)) {
      warnings.push(l);
      continue;
    }
  }

  const errorDetected = errors.length > 0 || stderr.trim().length > 0;
  const stackDetected = stack.length > 0;

  // base confidence: same logic, slightly tuned
  let confidence = 50;
  if (errorDetected && stackDetected) confidence = 90;
  else if (errorDetected) confidence = 75;
  else if (stackDetected) confidence = 60;
  else if (warnings.length) confidence = 55;

  const summaryParts: string[] = [];
  if (errorDetected) {
    summaryParts.push(
      `Detected ${errors.length} error line${errors.length > 1 ? "s" : ""}.`
    );
  }
  if (stackDetected) {
    summaryParts.push(`Stack trace depth: ${stack.length}.`);
  }
  if (!summaryParts.length) {
    summaryParts.push("No explicit error lines detected; inspect warnings.");
  }

  const primaryErrorLine = errors[0] || stderr.split(/\r?\n/).find(Boolean) || warnings[0] || "";
  const primary =
    primaryErrorLine || "No primary error found (only logs & warnings).";

  const languageGuess = guessLanguage(trimmed);
  const primaryErrorKind = classifyErrorKind(primaryErrorLine || "", trimmed);

  // prefer locations from error lines first, then from stack
  const locationLines = errors.concat(stack).slice(0, 50);
  const primaryLocations = extractLocations(locationLines);

  const summary = `${summaryParts.join(" ")} Primary: ${primary}`;

  return {
    errorDetected,
    stackDetected,
    errors,
    warnings,
    stack,
    summary,
    confidence,
    primaryErrorLine: primaryErrorLine || undefined,
    primaryErrorKind,
    primaryLocations: primaryLocations.length ? primaryLocations : undefined,
    languageGuess,
  };
}

// --------------------------
// Public API
// --------------------------

/**
 * New preferred API: analyze stdout + stderr separately.
 * This is ideal for use in /snap and /verify, where you already
 * have both streams from sandboxRunner.
 */
export function analyzeFromStdoutStderr(
  stdout: string,
  stderr: string
): Analysis {
  return analyzeCombinedText(stdout || "", stderr || "");
}

/**
 * Backwards-compatible API: analyze a single raw log string.
 * You can still call this from CLI "analyze logfile" endpoint.
 */
export function analyzeLogs(raw: string): Analysis {
  return analyzeCombinedText("", raw || "");
}
