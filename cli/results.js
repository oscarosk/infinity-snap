#!/usr/bin/env node
// cli/results.js - simple helper to list and fetch saved snap results
// Usage:
//   node cli/results.js --list
//   node cli/results.js --latest
//   node cli/results.js --file 1765270728851.json
//   node cli/results.js --backend http://localhost:4000

const axios = require("axios");

// robust yargs import that works across versions
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const argv = yargs(hideBin(process.argv)).argv;

const BASE = argv.backend || "http://localhost:4000";

async function list() {
  const r = await axios.get(`${BASE}/api/v1/results`);
  console.log(JSON.stringify(r.data, null, 2));
}

async function latest() {
  const r = await axios.get(`${BASE}/api/v1/results`);
  const file = r.data.results && r.data.results[0] && r.data.results[0].file;
  if (!file) {
    console.error("No results found");
    process.exit(1);
  }
  const d = await axios.get(`${BASE}/api/v1/results/${file}`);
  console.log(JSON.stringify(d.data, null, 2));
}

async function getFile(file) {
  const d = await axios.get(`${BASE}/api/v1/results/${file}`);
  console.log(JSON.stringify(d.data, null, 2));
}

(async () => {
  try {
    if (argv.list) return await list();
    if (argv.latest) return await latest();
    if (argv.file) return await getFile(argv.file);
    console.log("Usage: node cli/results.js --list | --latest | --file <name> [--backend http://...]");
  } catch (e) {
    // show helpful error
    if (e.response && e.response.data) {
      console.error("API error:", JSON.stringify(e.response.data, null, 2));
    } else {
      console.error("Error:", e.message || e);
    }
    process.exit(2);
  }
})();
