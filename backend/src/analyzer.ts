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
  raw?: string;
};

export type Analysis = {
  errorDetected: boolean;
  stackDetected: boolean;
  errors: string[];
  warnings: string[];
  stack: string[];
  summary: string;
  confidence: number; // 0..100

  primaryErrorLine?: string;
  primaryErrorKind?: ErrorKind;
  primaryLocations?: ErrorLocation[];
  languageGuess?: string;

  // Optional extra signals (non-breaking)
  confidenceSignals?: {
    reproduction?: boolean;
    coverage?: number;
    certainty?: number;
  };
};

// --------------------------
// Regex helpers
// --------------------------

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

const STACK_LINE_RE = /^\s*at\s+/i;

// keep warnings but avoid too many false positives
const WARNING_RE = /^\s*(warn|warning)\b/i;

const TEST_FAIL_HINTS = [
  /\bTest Suites?:\s*\d+\s*failed/i,
  /\bTests?:\s*\d+\s*failed/i,
  /\bFAIL\s+/i, // Jest puts "FAIL  path/to/test"
  /\bexpected\b.*\breceived\b/i,
];

const TIMEOUT_HINTS = [
  /\btimeout\b/i,
  /\btimed out\b/i,
  /did not exit one second after the test run/i,
];

const FILE_LOC_PATTERNS: RegExp[] = [
  /(?<file>[^\s:()]+?\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|java|cpp|cc|c|hpp|h)):(?<line>\d+):(?<col>\d+)/,
  /(?<file>[^\s:()]+?\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|java|cpp|cc|c|hpp|h)):(?<line>\d+)/,
  /(?<file>[^\s()]+?\.(?:ts|tsx|js|jsx))\((?<line>\d+),(?<col>\d+)\)/,
];

// --------------------------
// Language heuristics
// --------------------------

function guessLanguage(allText: string): string {
  const t = allText.toLowerCase();

  if (t.includes("traceback (most recent call last)") || t.includes(".py")) return "python";
  if (t.includes("typescript") || t.includes(".ts(") || t.includes("tsc ") || t.includes(".tsx")) return "typescript";
  if (t.includes("node:internal") || t.includes("node:") || t.includes(".js:") || t.includes("typeerror:") || t.includes("referenceerror:")) return "javascript";
  if (t.includes("java.lang.") || t.includes(".java:")) return "java";
  if (t.includes("fatal error:") || t.includes(".cpp:") || t.includes(".hpp:")) return "cpp";

  return "unknown";
}

// --------------------------
// Error kind classification
// --------------------------

function classifyErrorKind(line: string, allText: string): ErrorKind {
  const l = (line || "").toLowerCase();
  const t = (allText || "").toLowerCase();

  if (
    l.includes("syntaxerror") ||
    l.includes("parse error") ||
    l.includes("unexpected token") ||
    l.includes("unexpected end of input")
  ) return "syntax";

  if (l.includes("typeerror") || (l.includes("ts") && l.includes("type"))) return "type";

  if (l.includes("referenceerror") || l.includes("is not defined") || l.includes("cannot find name")) return "reference";

  if (TIMEOUT_HINTS.some((re) => re.test(l)) || TIMEOUT_HINTS.some((re) => re.test(t))) return "timeout";

  if (
    l.includes("assertionerror") ||
    (l.includes("expected") && l.includes("received")) ||
    TEST_FAIL_HINTS.some((re) => re.test(l)) ||
    TEST_FAIL_HINTS.some((re) => re.test(t))
  ) return "test-failure";

  if (l.includes("error") || l.includes("exception")) return "runtime";
  if (t.includes("error") || t.includes("exception")) return "runtime";

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
      // @ts-ignore
      const groups = m?.groups as { file?: string; line?: string; col?: string } | undefined;
      if (groups?.file) {
        const lineNum = groups.line ? parseInt(groups.line, 10) : undefined;
        const colNum = groups.col ? parseInt(groups.col, 10) : undefined;

        out.push({
          file: groups.file,
          line: lineNum && !Number.isNaN(lineNum) ? lineNum : undefined,
          column: colNum && !Number.isNaN(colNum) ? colNum : undefined,
          raw: line,
        });
        break;
      }
    }
  }

  return out;
}

// --------------------------
// Core analysis
// --------------------------

function analyzeCombinedText(stdout: string, stderr: string): Analysis {
  const combined = `${stdout || ""}\n${stderr || ""}`.trim();
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);

  const errors: string[] = [];
  const warnings: string[] = [];
  const stack: string[] = [];

  for (const l of lines) {
    // treat test hints as errors too
    if (ERROR_REGEXES.some((re) => re.test(l)) || TEST_FAIL_HINTS.some((re) => re.test(l))) {
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

  // don't mark errorDetected just because stderr has content (stderr can contain warnings/info)
  const errorDetected = errors.length > 0;
  const stackDetected = stack.length > 0;

  let confidence = 50;
  if (errorDetected && stackDetected) confidence = 90;
  else if (errorDetected) confidence = 75;
  else if (stackDetected) confidence = 60;
  else if (warnings.length) confidence = 55;

  const summaryParts: string[] = [];
  if (errorDetected) summaryParts.push(`Detected ${errors.length} error line${errors.length > 1 ? "s" : ""}.`);
  if (stackDetected) summaryParts.push(`Stack trace depth: ${stack.length}.`);
  if (!summaryParts.length) summaryParts.push("No explicit error lines detected; inspect warnings.");

  const primaryErrorLine =
    errors[0] ||
    lines.find((x) => ERROR_REGEXES.some((re) => re.test(x)) || TEST_FAIL_HINTS.some((re) => re.test(x))) ||
    warnings[0] ||
    "";

  const languageGuess = guessLanguage(combined);
  const primaryErrorKind = classifyErrorKind(primaryErrorLine || "", combined);

  const primaryLocations = extractLocations(errors.concat(stack).slice(0, 50));

  const summary = `${summaryParts.join(" ")} Primary: ${primaryErrorLine || "No primary error found."}`;

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

export function analyzeFromStdoutStderr(stdout: string, stderr: string): Analysis {
  return analyzeCombinedText(stdout || "", stderr || "");
}

export function analyzeLogs(raw: string): Analysis {
  // IMPORTANT: raw logs should NOT automatically be treated as stderr
  return analyzeCombinedText(raw || "", "");
}
