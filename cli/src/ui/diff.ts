import chalk from "chalk";

export function printUnifiedDiff(diffText: string, maxLines = 200) {
  const lines = diffText.split("\n");
  const view = lines.slice(0, maxLines);

  for (const line of view) {
    if (line.startsWith("diff --git")) {
      console.log(chalk.bold(line));
    } else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      console.log(chalk.bold(line));
    } else if (line.startsWith("@@")) {
      console.log(chalk.cyan(line));
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      console.log(chalk.green(line));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      console.log(chalk.red(line));
    } else {
      console.log(chalk.gray(line));
    }
  }

  if (lines.length > maxLines) {
    console.log(
      chalk.yellow(
        `… truncated (${lines.length - maxLines} more lines). Use --diff-full to show all.`
      )
    );
  }
}
