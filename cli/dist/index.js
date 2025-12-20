#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = __importDefault(require("node:readline"));
const package_json_1 = __importDefault(require("../package.json"));
const start_1 = require("./commands/start");
const fix_1 = require("./commands/fix");
const list_1 = require("./commands/list");
const view_1 = require("./commands/view");
const watch_1 = require("./commands/watch");
const open_1 = require("./commands/open");
const doctor_1 = require("./commands/doctor");
const render_1 = require("./ui/render");
const argv = process.argv.slice(2);
// ---------------------------------------------------------
// Fast-path: `infinitysnap review ...` (pre-commit/CI)
// ---------------------------------------------------------
if (argv[0] === "review") {
    const child = (0, node_child_process_1.spawnSync)(process.execPath, [require.resolve("./review"), ...argv.slice(1)], { stdio: "inherit" });
    process.exit(child.status ?? 1);
}
function resolveRepoPath(p) {
    const v = (p ?? "").trim();
    return v ? node_path_1.default.resolve(v) : process.cwd();
}
function dieUsage(program) {
    (0, render_1.printHeader)();
    program.outputHelp();
    process.exit(2);
}
const HOME_CHOICES = [
    { label: "Quick Snap — one-shot autonomous fix (analyze → patch → verify)", value: "quick" },
    { label: "Fix — full fix pipeline (same as: infinitysnap fix)", value: "fix" },
    { label: "Analyze Only — diagnose failures (no code changes)", value: "analyze" },
    { label: "Runs — list & inspect history", value: "runs" },
    { label: "Doctor — connectivity / env checks", value: "doctor" },
    { label: "Exit", value: "exit" },
];
function canRenderArrowMenu() {
    const term = (process.env.TERM || "").toLowerCase();
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return false;
    if (term === "dumb")
        return false;
    if (process.env.CI === "true")
        return false;
    if (process.env.INFINITYSNAP_SIMPLE_MENU === "1")
        return false;
    if (process.env.NO_COLOR === "1") {
        // not strictly required, but if someone forces no-color, their terminal setup is often “minimal”
        // and inquirer can look odd. Still allow unless forced simple.
    }
    return true;
}
function printHomeMenuNumbered() {
    (0, render_1.printHeader)();
    console.log("Select an option:\n");
    HOME_CHOICES.forEach((c, i) => {
        console.log(`  ${i + 1}) ${c.label}`);
    });
    console.log("");
}
function readLine(question) {
    const rl = node_readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(String(answer ?? "").trim());
        });
    });
}
async function promptNumberedChoice() {
    printHomeMenuNumbered();
    while (true) {
        const raw = await readLine(`? Enter choice [1-${HOME_CHOICES.length}] (default 1): `);
        const pick = raw === "" ? 1 : Number(raw);
        if (Number.isInteger(pick) && pick >= 1 && pick <= HOME_CHOICES.length) {
            return HOME_CHOICES[pick - 1].value;
        }
        (0, render_1.warn)(`Please enter a number between 1 and ${HOME_CHOICES.length}.`);
    }
}
async function promptArrowChoice() {
    // Arrow menu (premium) — only used when safe or explicitly forced
    const { value } = await inquirer_1.default.prompt([
        {
            type: "list",
            name: "value",
            message: "What do you want to do?",
            pageSize: 10,
            loop: false,
            choices: HOME_CHOICES.map((c) => ({ name: c.label, value: c.value })),
            default: "quick",
        },
    ]);
    return value;
}
async function promptHomeAction(opts) {
    const forceArrow = !!opts?.forceArrow;
    if (forceArrow)
        return promptArrowChoice();
    if (canRenderArrowMenu()) {
        try {
            return await promptArrowChoice();
        }
        catch {
            // fall back
            (0, render_1.info)("Interactive menu unavailable; falling back to stable numbered menu.");
        }
    }
    return promptNumberedChoice();
}
async function promptRepoAndCommand() {
    // Use inquirer here (works fine in most terminals, and it’s not the broken “list” case)
    const { repoPathRaw } = await inquirer_1.default.prompt([
        {
            type: "input",
            name: "repoPathRaw",
            message: "Repo path (press Enter for current directory):",
            default: process.cwd(),
            filter: (v) => resolveRepoPath(v),
            validate: (v) => (v.trim().length > 0 ? true : "Please enter a path."),
        },
    ]);
    const { commandRaw } = await inquirer_1.default.prompt([
        {
            type: "input",
            name: "commandRaw",
            message: 'Command to run (example: "npm test") — leave blank to auto-detect:',
            default: "",
            filter: (v) => String(v ?? "").trim(),
        },
    ]);
    const { verify } = await inquirer_1.default.prompt([
        {
            type: "confirm",
            name: "verify",
            message: "Run verification step?",
            default: true,
        },
    ]);
    return {
        repoPath: repoPathRaw,
        command: commandRaw || undefined,
        verify,
    };
}
// ---------------------------------------------------------
// Interactive home (runs when user types `infinitysnap`)
// ---------------------------------------------------------
async function interactiveHome(opts) {
    const action = await promptHomeAction({ forceArrow: !!opts?.forceArrow });
    if (action === "exit")
        process.exit(0);
    if (action === "runs") {
        await (0, list_1.runList)();
        return;
    }
    if (action === "doctor") {
        await (0, doctor_1.runDoctor)();
        return;
    }
    const { repoPath, command, verify } = await promptRepoAndCommand();
    console.log("");
    if (action === "quick") {
        await (0, start_1.runStart)({ repoPath, command, fix: true, verify });
        return;
    }
    if (action === "fix") {
        await (0, fix_1.runFix)({ repoPath, command, verify });
        return;
    }
    await (0, start_1.runStart)({ repoPath, command, fix: false, verify: false });
}
// ---------------------------------------------------------
// Commander program
// ---------------------------------------------------------
const program = new commander_1.Command();
program
    .name("infinitysnap")
    .description("InfinitySnap CLI — Autonomous Fix · Sandbox · Verify")
    .version(package_json_1.default.version);
// Forces arrow-key UI even in finicky terminals
program
    .command("ui")
    .description("Interactive UI (arrow menu). Use for local dev; may not work in all terminals.")
    .action(async () => {
    await interactiveHome({ forceArrow: true });
});
// Always-stable simple menu (judge mode)
program
    .command("menu")
    .description("Stable menu (numbered). Recommended for demos/judges.")
    .action(async () => {
    // Force numbered by env for this run
    process.env.INFINITYSNAP_SIMPLE_MENU = "1";
    await interactiveHome({ forceArrow: false });
});
// Aliases
program
    .command("quick")
    .description('One-shot autonomous fix. Example: infinitysnap quick . --command "npm test"')
    .option("--no-verify", "Skip verify step")
    .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
    .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
    .action(async (opts) => {
    await (0, start_1.runStart)({
        repoPath: resolveRepoPath(opts.path),
        command: opts.command,
        fix: true,
        verify: opts.verify !== false,
    });
});
program
    .command("analyze")
    .description("Analyze only (no code changes).")
    .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
    .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
    .action(async (opts) => {
    await (0, start_1.runStart)({
        repoPath: resolveRepoPath(opts.path),
        command: opts.command,
        fix: false,
        verify: false,
    });
});
program
    .command("runs")
    .description("Alias for list")
    .action(async () => {
    await (0, list_1.runList)();
});
// Original commands
program
    .command("snap")
    .description("Run once (snap + analyze). Use --fix to generate/apply/verify.")
    .option("--fix", "Run the full fix pipeline", false)
    .option("--no-verify", "Skip verify step")
    .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
    .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
    .action(async (opts) => {
    await (0, start_1.runStart)({
        repoPath: resolveRepoPath(opts.path),
        command: opts.command,
        fix: !!opts.fix,
        verify: opts.verify !== false,
    });
});
program
    .command("fix")
    .description('One-command fix pipeline. Example: infinitysnap fix . --command "npm test"')
    .option("--no-verify", "Skip verify step")
    .option("-c, --command <cmd>", "Command to run (auto-detect if omitted)")
    .option("-p, --path <repoPath>", "Repo path (defaults to current directory)")
    .action(async (opts) => {
    await (0, fix_1.runFix)({
        repoPath: resolveRepoPath(opts.path),
        command: opts.command,
        verify: opts.verify !== false,
    });
});
program
    .command("list")
    .description("List past InfinitySnap runs")
    .action(async () => {
    await (0, list_1.runList)();
});
program
    .command("view")
    .description("Show detailed information about a given run")
    .argument("<runIdOrFile>", "Run ID or filename (.json)")
    .action(async (runIdOrFile) => {
    await (0, view_1.runView)(runIdOrFile);
});
program
    .command("watch")
    .description("Watch a run live (polling results for now)")
    .argument("<runId>", "Run ID")
    .option("-i, --interval <sec>", "Polling interval (default 1s)", (v) => parseInt(v, 10), 1)
    .action(async (runId, opts) => {
    await (0, watch_1.runWatch)(runId, opts.interval);
});
program
    .command("open")
    .description("Open dashboard run page in browser")
    .argument("<runId>", "Run ID")
    .action(async (runId) => {
    await (0, open_1.runOpen)(runId);
});
program
    .command("doctor")
    .description("Check backend/Kestra connectivity and env configuration")
    .action(async () => {
    await (0, doctor_1.runDoctor)();
});
program.showHelpAfterError(true);
program.configureHelp({ sortSubcommands: true });
// ---------------------------------------------------------
// Entry behavior
// ---------------------------------------------------------
async function main() {
    // No args: default to the most stable experience
    if (argv.length === 0) {
        // If it’s a perfect terminal, you’ll still get arrows.
        // If not, you get numbered menu (and it’ll never “hide options” again).
        await interactiveHome();
        return;
    }
    if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
        dieUsage(program);
    }
    await program.parseAsync(process.argv);
}
main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    (0, render_1.err)(msg);
    process.exit(1);
});
