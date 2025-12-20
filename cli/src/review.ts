// cli/src/review.ts
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Severity = "info" | "warn" | "critical";

type Finding = {
  severity: Severity;
  rule: string;
  message: string;
  hint?: string;
};

type Report = {
  tool: "infinitysnap";
  mode: "precommit" | "ci";
  critical: boolean;
  summary: string;
  findings: Finding[];
  meta: {
    ts: string;
    repoRoot: string;
    diffChars: number;
    diffLines: number;
  };
};

function repoRoot(): string {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
}

function safeMkdir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p: string, content: string) {
  safeMkdir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function timelineLine(t0: number, step: string, status: "start" | "ok" | "fail", msg?: string) {
  const s = ((Date.now() - t0) / 1000).toFixed(2).padStart(6, " ");
  return `[${s}s] ${step} → ${status}${msg ? ` (${msg})` : ""}`;
}

function countLines(s: string) {
  if (!s) return 0;
  return s.split("\n").length;
}

/**
 * Very small, deterministic "review".
 * It flags obvious secret exfil / credential patterns and dangerous staged changes.
 * This is intentionally simple + judge-auditable.
 */
function scanDiff(diff: string): Finding[] {
  const findings: Finding[] = [];
  const lower = diff.toLowerCase();

  // Critical secret/credential patterns (fast + deterministic)
  const criticalNeedles: { rule: string; needle: RegExp; message: string; hint?: string }[] = [
    {
      rule: "secrets.private_key",
      needle: /-----begin (rsa|ec|ed25519)? ?private key-----/i,
      message: "Private key material appears in staged diff.",
      hint: "Remove the key and rotate it immediately.",
    },
    {
      rule: "secrets.aws_access_key",
      needle: /\bAKIA[0-9A-Z]{16}\b/,
      message: "Possible AWS Access Key ID detected in staged diff.",
      hint: "Remove it, rotate the key, use env/secret manager.",
    },
    {
      rule: "secrets.github_token",
      needle: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
      message: "Possible GitHub token detected in staged diff.",
      hint: "Remove it and rotate the token.",
    },
    {
      rule: "secrets.generic_token",
      needle: /\b(bearer|token|api[_-]?key|secret)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/i,
      message: "Possible API token/secret assignment detected in staged diff.",
      hint: "Move secrets to environment variables or a secret manager.",
    },
    {
      rule: "exfil.network_calls",
      needle: /\b(fetch\(|axios\b|xmlhttprequest\b|curl\s|wget\s|nc\s|netcat\b)/i,
      message: "Potential network exfiltration primitive detected in staged diff.",
      hint: "Ensure no code is sending data externally, especially in CI/hooks.",
    },
    {
      rule: "secrets.dotenv_mention",
      needle: /\.(env|ssh)\b/i,
      message: "Mentions .env/.ssh in staged diff; verify secrets are not committed.",
      hint: "Ensure .env/.ssh are gitignored and not referenced insecurely.",
    },
  ];

  for (const c of criticalNeedles) {
    if (c.needle.test(diff)) {
      findings.push({ severity: "critical", rule: c.rule, message: c.message, hint: c.hint });
    }
  }

  // Risky file touches (warn/critical depending)
  const fileTouchNeedles: { severity: Severity; rule: string; needle: RegExp; message: string }[] = [
    {
      severity: "warn",
      rule: "infra.workflow_changed",
      needle: /^\+\+\+ b\/\.github\/workflows\/.+/m,
      message: "GitHub Actions workflow changed. Ensure it does not expose secrets.",
    },
    {
      severity: "warn",
      rule: "hooks_changed",
      needle: /^\+\+\+ b\/\.git\/hooks\/.+/m,
      message: "Git hook path appears in diff. Ensure hooks are not committing secrets.",
    },
    {
      severity: "warn",
      rule: "scripts_changed",
      needle: /^\+\+\+ b\/scripts\/.+/m,
      message: "scripts/ changed. Ensure scripts do not leak tokens or run network exfil.",
    },
  ];

  for (const r of fileTouchNeedles) {
    if (r.needle.test(diff)) findings.push({ severity: r.severity, rule: r.rule, message: r.message });
  }

  // If diff is empty, be explicit (info)
  if (!diff.trim()) {
    findings.push({ severity: "info", rule: "diff.empty", message: "No staged changes detected." });
  }

  return findings;
}

function hasCritical(findings: Finding[]) {
  return findings.some((f) => f.severity === "critical");
}

function main() {
  const args = process.argv.slice(2);
  const mode: "precommit" | "ci" = (args.includes("--mode=ci") ? "ci" : "precommit");

  const t0 = Date.now();
  const root = repoRoot();
  const outDir = path.join(root, ".infinitysnap");
  const reportPath = path.join(outDir, "report.json");
  const timelinePath = path.join(outDir, "timeline.txt");

  const timeline: string[] = [];
  timeline.push(timelineLine(t0, "review.init", "start", mode));

  // Get diff source
  let diff = "";
  try {
    timeline.push(timelineLine(t0, "git.diff", "start", mode === "precommit" ? "--cached" : "HEAD"));
    if (mode === "precommit") {
      diff = execSync("git diff --cached --unified=0", { encoding: "utf8" });
    } else {
      // CI mode: compare against merge base if possible
      // Fallback: just show last commit diff
      try {
        const base = execSync("git merge-base origin/main HEAD", { encoding: "utf8" }).trim();
        diff = execSync(`git diff ${base}...HEAD --unified=0`, { encoding: "utf8" });
      } catch {
        diff = execSync("git diff HEAD~1..HEAD --unified=0", { encoding: "utf8" });
      }
    }
    timeline.push(timelineLine(t0, "git.diff", "ok", `chars=${diff.length}`));
  } catch (e: any) {
    timeline.push(timelineLine(t0, "git.diff", "fail", e?.message || "failed"));
    writeFile(timelinePath, timeline.join("\n") + "\n");
    process.exit(1);
  }

  timeline.push(timelineLine(t0, "review.scan", "start"));
  const findings = scanDiff(diff);
  timeline.push(timelineLine(t0, "review.scan", "ok", `findings=${findings.length}`));

  const critical = hasCritical(findings);
  const summary = critical
    ? "Critical issues detected in staged changes."
    : "No critical issues detected.";

  const report: Report = {
    tool: "infinitysnap",
    mode,
    critical,
    summary,
    findings,
    meta: {
      ts: nowIso(),
      repoRoot: root,
      diffChars: diff.length,
      diffLines: countLines(diff),
    },
  };

  writeFile(reportPath, JSON.stringify(report, null, 2));
  timeline.push(timelineLine(t0, "report.write", "ok", path.relative(root, reportPath)));

  writeFile(timelinePath, timeline.join("\n") + "\n");

  // Exit codes:
  // 0 = ok
  // 2 = block (critical)
  // 1 = tool error
  if (critical) process.exit(2);
  process.exit(0);
}

main();
