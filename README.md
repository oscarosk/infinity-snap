# ♾️ InfinitySnap

**InfinitySnap turns the Cline CLI into a supervised autonomous coding agent with policy enforcement, verification, rollback, and replay.**

InfinitySnap is built for **auditability and restraint**, not blind auto-fixing.
Every action is logged, every refusal is explained, every fix is verified, and every run is replayable.

> **Correctness > speed. Transparency > magic.**

---

## What InfinitySnap does

InfinitySnap wraps autonomous code execution inside a **strict, judge-safe control loop**.

A single run follows this lifecycle:

1. **Sandbox execution**  
   Run a command in an isolated copy of the repository.

2. **Analysis**  
   Extract errors, stack traces, and failure signals from stdout/stderr.

3. **Confidence gate**  
   If confidence is below threshold → **refuse** (no code changes).

4. **Patch generation / execution**  
   Generate or apply a fix using a supervised agent (Cline).

5. **Verification**  
   Re-run the command after changes.

6. **Rollback (if needed)**  
   If verification fails or policy blocks changes → repository is restored.

7. **Replay**  
   Every step is recorded as a timeline with artifacts.

---

## Why this is different

InfinitySnap is **not** a blind “auto-fix” tool.

It demonstrates:
- Confidence-gated autonomy  
- Explicit policy enforcement  
- Deterministic rollback  
- End-to-end replayability  

Judges can inspect **everything**:
- logs
- diffs
- patches
- refusal reasons
- execution timeline

No hidden state. No silent edits.

---

## Architecture (real)

Developer / CI / Judge
|
v
InfinitySnap CLI (optional)
|
v
Backend API (Express)
|
+--> Sandbox Runner (copy repo, run command)
|
+--> Analyzer (errors, stack, confidence signals)
|
+--> Policy Engine (command / patch / exfil rules)
|
+--> Cline Executor (supervised)
|
+--> Verifier
|
+--> Artifact Store (logs, patch, diff, timeline)

yaml
Copy code

Artifacts are stored on disk and served through explicit HTTP endpoints.

---

## Quickstart (local)

### 1️⃣ Start the backend

```bash
cd backend
npm install
npm run dev
Backend runs at:

arduino
Copy code
http://localhost:4000
Health checks:

bash
Copy code
curl -s http://localhost:4000/health
curl -s http://localhost:4000/api/v1/health
Core API (used in demos)
1️⃣ Start a run (sandbox + analysis)
bash
Copy code
curl -s -X POST "http://localhost:4000/api/v1/runs/start" \
  -H "Content-Type: application/json" \
  -d '{"repoPathOnHost":"./samples/demo-repo","command":"node failing-test.js"}'
Creates a run containing:

sandbox stdout/stderr

analysis summary

metrics

timeline

2️⃣ List runs
bash
Copy code
curl -s http://localhost:4000/api/v1/runs
3️⃣ Artifact index (single demo-friendly endpoint)
bash
Copy code
RUN_ID="PUT_RUN_ID_HERE"
curl -s "http://localhost:4000/api/v1/runs/$RUN_ID/artifacts"
Returns:

which logs exist

whether patch/diff exist

whether timeline exists

artifact paths

This endpoint exists purely to make demos smoother.

4️⃣ Logs (judge-friendly)
List available logs:

bash
Copy code
curl -s "http://localhost:4000/api/v1/runs/$RUN_ID/logs"
Combined view:

bash
Copy code
curl -s "http://localhost:4000/api/v1/runs/$RUN_ID/logs?view=combined" | head -n 120
Single log:

bash
Copy code
curl -s "http://localhost:4000/api/v1/runs/$RUN_ID/logs/sandbox.stderr"
5️⃣ Timeline replay
Human-readable timeline:

bash
Copy code
curl -s "http://localhost:4000/api/v1/runs/$RUN_ID/timeline"
Structured timeline:

bash
Copy code
curl -s "http://localhost:4000/api/v1/runs/$RUN_ID/timeline.json"
Example output:

csharp
Copy code
[0.00s] run.init → start
[0.06s] sandbox.run → start
[1.04s] sandbox.run → ok
[1.16s] analysis.complete → ok
[1.21s] run.complete → ok
6️⃣ Fix pipeline (supervised autonomy)
bash
Copy code
curl -s -X POST "http://localhost:4000/api/v1/runs/$RUN_ID/fix" \
  -H "Content-Type: application/json" \
  -d '{"timeoutMs":180000}'
Possible outcomes:

verified → fix applied and verification passed

rolled_back → verification failed or policy blocked changes

refused_not_git → repository is not a git repo

refused_low_confidence → confidence below threshold

Refusals are intentional. Judges must see restraint.

Policy & safety guarantees
InfinitySnap enforces:

Command policy

blocks destructive or unsafe commands

optional allowlist mode

Patch policy

limits number of modified files

blocks sensitive paths (.env, .ssh, credentials, infra)

Confidence gate

below threshold → no execution

Exfiltration detection

suspicious network/token patterns → rollback

All decisions are:

logged

timestamped

replayable

Cold start (transparent by design)
Initial runs may incur cold start costs (container startup, executor initialization).

InfinitySnap:

measures cold start

records it

shows it in the timeline

Cold start is not hidden or optimized away for demos.

Recommended demo flow (judges)
Start a failing run

Open combined logs

Trigger /fix

Show:

artifact index

timeline replay

refusal or rollback (if it happens)

Key takeaway:

InfinitySnap never hides what happened.

Project status
Phase 1–7: ✅ complete

Phase 8 (demo & narrative): ✅ complete

No mock data

No fake UI paths

License
MIT

markdown
Copy code

---

### ✅ This README is **final**
- Matches **your real endpoints**
- Matches **your current behavior**
- Judge-friendly wording
- Zero over-claiming
- No missing features

If you want, next we can:
- add **screenshots** to this README, or  
- move to **Phase 9 (final demo script + submission checklist)**