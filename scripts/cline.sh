#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STATE_DIR="$ROOT_DIR/.infinitysnap"
mkdir -p "$STATE_DIR"
LOG_FILE="$STATE_DIR/cline_executor.log"

TASK="${1:-}"
if [[ -z "$TASK" ]]; then
  echo "Usage: echo \"context\" | scripts/cline.sh \"Do X\"" >&2
  exit 2
fi

# Optional: auto-load .env in InfinitySnap root
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env"
  set +a
fi

CLINE_BIN="${CLINE_CLI_PATH:-cline}"

# Capture stdin context so it never breaks cline (and so we can show judges)
CTX_FILE="$STATE_DIR/cline_context_$(date +%s)_$$.txt"
cat > "$CTX_FILE" || true

# Timeout for cline (seconds). Override with CLINE_TIMEOUT_SEC if you want.
CLINE_TIMEOUT_SEC="${CLINE_TIMEOUT_SEC:-180}"

{
  echo "-----"
  echo "$(date -Iseconds) | cwd=$ROOT_DIR"
  echo "TASK: $TASK"
  echo "CLINE_BIN: $CLINE_BIN"
  echo "CTX_FILE: $CTX_FILE ($(wc -c < "$CTX_FILE" 2>/dev/null || echo 0) bytes)"
  echo "TIMEOUT_SEC: $CLINE_TIMEOUT_SEC"
} >> "$LOG_FILE"

# STREAM output live (no command substitution).
# NOTE: when piping to tee, the actual cline exit code is PIPESTATUS[0].
set +e
timeout "${CLINE_TIMEOUT_SEC}s" \
  "$CLINE_BIN" \
    --no-interactive \
    -y \
    -m act \
    --output-format plain \
    "$TASK" \
  2>&1 | tee -a "$LOG_FILE"

CLINE_CODE="${PIPESTATUS[0]:-1}"   # exit code of cline (or timeout wrapper)
set -e

{
  echo "EXIT_CODE: $CLINE_CODE"
  if [[ "$CLINE_CODE" == "124" ]]; then
    echo "NOTE: cline timed out after ${CLINE_TIMEOUT_SEC}s"
  fi
} >> "$LOG_FILE"

# Important for InfinitySnap: return cline's real exit code
exit "$CLINE_CODE"
