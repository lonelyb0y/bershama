#!/usr/bin/env bash
#
# Run Strix against a LOCAL Bershama.
#
# ── why local and not production ──────────────────────────────────────────────
#
# Strix is an autonomous agent that finds and CONFIRMS vulnerabilities. Pointed
# at a live deployment it will issue real requests, mutate data, and trip alerts
# -- and it is not going to ask first. This script points it at a local
# instance with a local database, where the worst it can do is fill a disk.
#
# ── what it needs ─────────────────────────────────────────────────────────────
#
#   1. Docker, running. Rootless is fine.
#   2. STRIX_LLM and LLM_API_KEY. Any LiteLLM-routable provider:
#        export STRIX_LLM="openai/gpt-5"          LLM_API_KEY=sk-...
#        export STRIX_LLM="anthropic/claude-..."  LLM_API_KEY=sk-ant-...
#        export STRIX_LLM="gemini/gemini-2.0-flash" LLM_API_KEY=AIza...
#        export STRIX_LLM="groq/llama-3.3-70b"  LLM_API_KEY=gsk_...
#      A local Ollama works too:
#        export STRIX_LLM="ollama/qwen2.5-coder"  LLM_API_KEY=ollama
#   3. The app running on a port, with a seeded database.
#
# ── usage ─────────────────────────────────────────────────────────────────────
#
#   ./scripts/strix-scan.sh              # the default: quick scan, local app
#   ./scripts/strix-scan.sh --deep       # a deep scan instead of a quick one
#   ./scripts/strix-scan.sh --target http://127.0.0.1:3000/en
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SCAN_MODE="quick"   # quick | standard | deep
TARGET="http://127.0.0.1:3000/en"
RUN_DIR="$REPO_ROOT/strix_runs"

while [ $# -gt 0 ]; do
  case "$1" in
    --deep)   SCAN_MODE="deep"; shift ;;
    --standard) SCAN_MODE="standard"; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  FAIL\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }

# ── 1. the prerequisites, checked before anything is started ──────────────────
log "Checking the prerequisites"

command -v strix >/dev/null 2>&1 || die "strix is not installed. Try: pipx install strix-agent"
ok "strix $(strix --version 2>/dev/null | head -1)"

[ -n "${STRIX_LLM:-}" ] || die "STRIX_LLM is not set. See the header of this script."
[ -n "${LLM_API_KEY:-}" ] || die "LLM_API_KEY is not set. See the header of this script."
ok "the model is $STRIX_LLM"

if ! docker info >/dev/null 2>&1; then
  # The rootless daemon needs its environment, and it is not a systemd service
  # on a machine with no systemd.
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$HOME/.local/share/docker-rootless}"
  export DOCKER_HOST="${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}"
  export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
  if ! docker info >/dev/null 2>&1; then
    die "docker is not running. Start the rootless daemon with:
    XDG_RUNTIME_DIR=$HOME/.local/share/docker-rootless DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock dockerd-rootless.sh --storage-driver=vfs &"
  fi
fi
ok "docker $(docker version --format '{{.ServerVersion}}')"

# ── 2. the local app ─────────────────────────────────────────────────────────
if ! curl -fsS -o /dev/null --max-time 5 "$TARGET"; then
  log "The app is not answering at $TARGET -- starting it"
  # The seeded local database, so Strix has something real to look at.
  ./scripts/verify-db.sh >/dev/null 2>&1 || true
  (pnpm --filter @bershama/web dev > /tmp/bershama-strix-app.log 2>&1 &)
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null --max-time 3 "$TARGET" && break
    sleep 2
  done
  curl -fsS -o /dev/null --max-time 5 "$TARGET" || die "the app did not start. See /tmp/bershama-strix-app.log"
fi
ok "the app is answering at $TARGET"

# ── 3. the scan ──────────────────────────────────────────────────────────────
mkdir -p "$RUN_DIR"
log "Running the $SCAN_MODE scan against $TARGET"
log "  this is an autonomous agent; it can take a long time"

# The flags, from `strix --help`:
#   -n                    non-interactive, so it does not wait at the keyboard
#   -t                    the target
#   -m                    the scan depth: quick, standard or deep
#   --scope-mode full     everything, not just what changed in a diff
#   --max-budget          a ceiling on what the run may spend
#
# `--scope-mode full` matters here: the default is `auto`, which means "only what
# changed", and this is a scan of a whole product rather than of a pull request.
strix \
  -n \
  -t "$TARGET" \
  -m "$SCAN_MODE" \
  --scope-mode full \
  --max-budget 5 \
  2>&1 | tee "$RUN_DIR/last-scan.log"

log "Done. The findings are in $RUN_DIR"
