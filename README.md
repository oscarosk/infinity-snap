# InfinitySnap — AI-assisted Sandbox + CI Pre-commit Checks

**One-line:** InfinitySnap runs quick sandboxed commands on a copied repo and analyzes logs to produce actionable findings. CLI + backend + Git hooks ready.

---

## Architecture (quick)

[Developer Machine / CI] -> infinitysnap CLI (npm link global)  
CLI -> POST /api/v1/snap -> Backend (Express)  
-> sandboxRunner copies repo -> runs command -> returns stdout/stderr  
-> analyzer extracts errors/stack/warnings -> JSON result  
-> CLI shows result and can fail (exit code) for CI/pre-commit

Optional: Docker execution in sandbox (docker image configured)  
Optional: Frontend dashboard (Vercel) to show recent analyses & history

---

## Features implemented
- Backend HTTP API:
  - `GET /api/v1/health`
  - `POST /api/v1/analyze` — analyze pasted logs
  - `POST /api/v1/snap` — copy repo to sandbox and run a command (returns stdout/stderr + analysis)
- CLI (`infinitysnap`) with commands:
  - `infinitysnap analyze --file some.log`
  - `infinitysnap snap --path <absPath> --command "npm test"`
- Git pre-commit hook sample that:
  - Runs `npm test`
  - Runs `infinitysnap analyze --file some.log` (optional)
  - Prevents commit on failure

---

## Quickstart (local dev)
1. Install Node (LTS), git, and (optionally) Docker.
2. From project root:

```bash
# backend
cd backend
npm install
npm run dev
# backend runs at: http://localhost:4000

# CLI:
cd ../cli
npm install
npm run build
npm link             # makes `infinitysnap` available globally on your machine
