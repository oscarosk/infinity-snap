#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const axios_1 = __importDefault(require("axios"));
const chalk_1 = __importDefault(require("chalk"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const API_BASE = process.env.INFINITYSNAP_API ?? "http://localhost:4000/api/v1";
const program = new commander_1.Command();
program
    .name("infinitysnap")
    .description("InfinitySnap CLI")
    .version("0.1.0");
program
    .command("analyze")
    .description("Send a log file to InfinitySnap backend for analysis")
    .option("-f, --file <path>", "log file path")
    .action(async (opts) => {
    if (!opts.file)
        return console.error(chalk_1.default.red("Provide --file"));
    try {
        const filePath = path_1.default.resolve(opts.file);
        const logs = await promises_1.default.readFile(filePath, "utf-8");
        const resp = await axios_1.default.post(`${API_BASE}/analyze`, { logs });
        console.log(chalk_1.default.green("Analysis:"));
        console.log(JSON.stringify(resp.data.analysis, null, 2));
    }
    catch (e) {
        console.error(chalk_1.default.red("Error:"), e?.message || e);
    }
});
program
    .command("snap")
    .description("Copy a repo into a temp sandbox and run a command there (via backend)")
    .option("-p, --path <absPath>", "absolute repo path")
    .option("-c, --command <cmd>", "command to run in sandbox")
    .action(async (opts) => {
    if (!opts.path || !opts.command)
        return console.error(chalk_1.default.red("Provide --path and --command"));
    try {
        const resp = await axios_1.default.post(`${API_BASE}/snap`, { repoHostPath: opts.path, command: opts.command }, { timeout: 0 });
        console.log(chalk_1.default.green("Sandbox result:"));
        console.log(JSON.stringify(resp.data.result, null, 2));
    }
    catch (e) {
        console.error(chalk_1.default.red("Error:"), e?.message || e?.response?.data || e);
    }
});
program.parse(process.argv);
