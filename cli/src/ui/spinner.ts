// cli/src/ui/spinner.ts
import ora, { Ora } from "ora";

export function startSpinner(text: string): Ora {
  return ora({
    text,
    spinner: "dots",
    discardStdin: false, // keeps interactive UX stable in some terminals
  }).start();
}
