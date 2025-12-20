// cli/src/commands/open.ts
import open from "open";
import { DASHBOARD_URL } from "../config";
import { printHeader, section, kv, ok, warn, err, badge, box, spacer } from "../ui/render";

export async function runOpen(runId: string) {
  const base = String(DASHBOARD_URL || "").replace(/\/$/, "");
  const url = `${base}/run/${encodeURIComponent(runId)}`;

  printHeader({
    status: [
      { label: "Command", value: "OPEN", tone: "info" },
      { label: "Dashboard", value: base || "(missing)", tone: base ? "muted" : "warn" },
    ],
  });

  section("Open Dashboard", "Launch run page in the default browser");

  kv("runId", runId, "info");
  kv("url", url, "muted");
  spacer(1);

  if (!base) {
    warn("DASHBOARD_URL is not configured.");
    box(
      "Fix",
      [
        `${badge("ENV", "warn")} Set DASHBOARD_URL in cli/src/config.ts or .env`,
        `Example: ${"DASHBOARD_URL=http://localhost:3000"}`,
      ],
      "warn"
    );
    return;
  }

  try {
    await open(url);
    ok("Opened in browser");
  } catch (e: any) {
    err("Failed to open browser automatically.");
    box(
      "Open manually",
      [
        `${badge("URL", "info")} ${url}`,
        `${badge("TIP", "muted")} Copy/paste into your browser`,
      ],
      "info"
    );
  }
}
