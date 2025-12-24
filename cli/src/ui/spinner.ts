// cli/src/ui/spinner.ts
import ora, { Ora } from "ora";

type StopMode = "stop" | "succeed" | "fail" | "warn" | "info";

/**
 * Start a spinner. Always pair with stopSpinner(...) in a finally block,
 * or use withSpinner(...) which guarantees cleanup.
 */
export function startSpinner(text: string): Ora {
  const sp = ora({
    text,
    spinner: "dots",
    discardStdin: false, // keeps interactive UX stable in some terminals
  }).start();

  // Ensure we never leave a spinner running on abrupt exits/errors.
  const cleanup = () => {
    try {
      if (sp.isSpinning) sp.stop();
      // Clear the line so we don't leave "⠸ ..." stuck in output
      sp.clear();
    } catch {}
  };

  // Only attach once per spinner instance
  const onSigint = () => {
    cleanup();
    process.exitCode = 130;
  };
  const onSigterm = () => {
    cleanup();
    process.exitCode = 143;
  };
  const onUncaught = () => cleanup();
  const onUnhandled = () => cleanup();

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.once("uncaughtException", onUncaught);
  process.once("unhandledRejection", onUnhandled);

  // Detach listeners when we stop (prevents leaks)
  const detach = () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
  };

  // Monkeypatch stop methods to always clear + detach.
  const origStop = sp.stop.bind(sp);
  sp.stop = () => {
    try {
      origStop();
      sp.clear();
    } finally {
      detach();
    }
    return sp;
  };

  const wrap = (fnName: keyof Ora, mode: StopMode) => {
    const fn = (sp as any)[fnName]?.bind(sp);
    if (!fn) return;

    (sp as any)[fnName] = (msg?: string) => {
      try {
        fn(msg);
        // ora's succeed/fail/etc usually stop, but we also clear to avoid ghosts
        sp.clear();
      } finally {
        detach();
      }
      return sp;
    };
  };

  wrap("succeed", "succeed");
  wrap("fail", "fail");
  wrap("warn", "warn");
  wrap("info", "info");

  return sp;
}

/**
 * Stop a spinner safely and clear its line.
 * Use this if you're not using withSpinner().
 */
export function stopSpinner(sp: Ora | null | undefined, mode: StopMode = "stop", msg?: string) {
  if (!sp) return;
  try {
    switch (mode) {
      case "succeed":
        sp.succeed(msg);
        break;
      case "fail":
        sp.fail(msg);
        break;
      case "warn":
        sp.warn(msg);
        break;
      case "info":
        sp.info(msg);
        break;
      default:
        sp.stop();
        break;
    }
  } catch {
    try {
      sp.stop();
      sp.clear();
    } catch {}
  }
}

/**
 * Helper that guarantees spinner cleanup (no more "stuck spinner" ever).
 */
export async function withSpinner<T>(
  text: string,
  fn: (sp: Ora) => Promise<T>,
  opts?: { successText?: string }
): Promise<T> {
  const sp = startSpinner(text);
  try {
    const out = await fn(sp);
    stopSpinner(sp, "succeed", opts?.successText);
    return out;
  } catch (e) {
    stopSpinner(sp, "fail");
    throw e;
  }
}
