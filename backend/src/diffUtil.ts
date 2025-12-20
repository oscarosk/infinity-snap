// backend/src/diffUtil.ts

function lcsTable(a: string[], b: string[]) {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function backtrackDiff(a: string[], b: string[], dp: number[][]) {
  const out: { type: " " | "+" | "-"; line: string }[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.push({ type: " ", line: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.push({ type: "+", line: b[j - 1] });
      j--;
    } else if (i > 0) {
      out.push({ type: "-", line: a[i - 1] });
      i--;
    }
  }
  out.reverse();
  return out;
}

export function unifiedDiff(before: string, after: string, filePath = "file"): string {
  const a = (before ?? "").split("\n");
  const b = (after ?? "").split("\n");
  const dp = lcsTable(a, b);
  const chunks = backtrackDiff(a, b, dp);

  let removed = 0, added = 0;
  for (const c of chunks) {
    if (c.type === "-") removed++;
    if (c.type === "+") added++;
  }

  const header =
    `diff --git a/${filePath} b/${filePath}\n` +
    `--- a/${filePath}\n` +
    `+++ b/${filePath}\n` +
    `@@ -1,${a.length} +1,${b.length} @@\n`;

  const body = chunks
    .filter(c => c.type !== " " || (c.line.trim() !== "")) // reduce noise
    .map(c => `${c.type}${c.line}`)
    .join("\n");

  return header + body + `\n\n# summary: +${added} -${removed}\n`;
}

export function buildPatchDiff(
  files: { path: string; before?: string; after: string }[]
): string {
  return files
    .map(f => unifiedDiff(f.before ?? "", f.after ?? "", f.path))
    .join("\n");
}
