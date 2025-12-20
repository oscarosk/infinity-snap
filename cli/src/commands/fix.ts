// cli/src/commands/fix.ts
import type { OutputFormat } from "../types";
import { runStart } from "./start";

/**
 * Shortcut for fix pipeline (snap + analyze + fix + verify)
 * Keep this thin: real UX is in start.ts.
 */
export async function runFix(opts: {
  repoPath?: string;
  command?: string;
  verify?: boolean;
  format?: OutputFormat;
}) {
  return runStart({
    repoPath: opts.repoPath,
    command: opts.command,
    fix: true,
    verify: opts.verify,
    format: opts.format,
  });
}
