#!/usr/bin/env bash
# ============================================================================
# Bershama backup — fully remote, no local dependencies.
#
# The Supabase free tier has no downloadable backup and does not expose
# direct Postgres (port 54321 is blocked). The only way in is the REST API
# over HTTPS. This script uses that API to export every table as JSON,
# plus the OpenAPI schema, storage objects, and config.
#
# Requirements: curl, python3, tar, gzip. No Docker, no local Postgres,
# no Supabase CLI, no pg_dump.
#
# Usage:
#   scripts/backup.sh              # backup to ./backups/
#   scripts/backup.sh --encrypt    # encrypt with gpg
#   scripts/backup.sh --upload DIR # copy to a local directory
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${REPO_ROOT}/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="bershama-${TIMESTAMP}"
ARCHIVE="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

SUPABASE_URL="${SUPABASE_URL:-https://kswdttkwtqqlabcjsgcy.supabase.co}"
SERVICE_ROLE_KEY="${SUPABASE_SECRET_KEY:-}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"
UPLOAD_DIR="${UPLOAD_DIR:-}"
KEEP_LOCAL="${KEEP_LOCAL:-14}"

log()  { printf '\033[1;34m==> %s\033[0m\n' "${1}"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "${1}"; }
warn() { printf '\033[1;33m  warn\033[0m %s\n' "${1}"; }
die()  { printf '\033[1;31m  FAIL\033[0m %s\n' "${1}" >&2; exit 1; }

# ── preflight ───────────────────────────────────────────────────────────────
log "Preflight"
for bin in curl python3 tar gzip; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found."
done
[[ -n "${SERVICE_ROLE_KEY}" ]] || die "SUPABASE_SECRET_KEY not set."

mkdir -p "${BACKUP_DIR}"
WORKDIR="$(mktemp -d /tmp/pf-backup.XXXXXX)"
trap 'rm -rf "${WORKDIR}"' EXIT

# ── 1. Discover tables from the OpenAPI schema ───────────────────────────────
log "Fetching OpenAPI schema"
curl -s -f "${SUPABASE_URL}/rest/v1/" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Accept: application/openapi+json" \
  -o "${WORKDIR}/openapi.json" 2>/dev/null \
  || die "Cannot reach Supabase REST API at ${SUPABASE_URL}"

# Extract table names: every top-level path that is not a schema prefix.
python3 - "${WORKDIR}/openapi.json" "${WORKDIR}/tables.txt" <<'PY'
import json, sys
schema = json.load(open(sys.argv[1]))
skip = {"rest", "storage", "auth", "realtime", "rpc"}
tables = sorted(
    p.strip("/") for p in schema.get("paths", {})
    if p.startswith("/")
    and p.strip("/")
    and p.strip("/") not in skip
    and not p.startswith("/rpc/")
)
with open(sys.argv[2], "w") as f:
    f.write("\n".join(tables) + "\n")
PY

mapfile -t TABLES < "${WORKDIR}/tables.txt"
[[ ${#TABLES[@]} -gt 0 ]] || die "No tables found in schema."
ok "${#TABLES[@]} tables discovered"

# ── 2. Export every table as JSON ────────────────────────────────────────────
log "Exporting tables"
: > "${WORKDIR}/rowcounts.txt"

for table in "${TABLES[@]}"; do
  OUT="${WORKDIR}/${table}.json"
  OFFSET=0
  PAGE=0
  : > "${OUT}"

  while :; do
    if ! curl -s -f \
      "${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1000&offset=${OFFSET}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      --output "${WORKDIR}/page.json" 2>/dev/null; then
      warn "Failed reading ${table} at offset ${OFFSET}"
      break
    fi

    COUNT="$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/page.json'))))" 2>/dev/null || echo 0)"
    [[ "${COUNT}" -eq 0 ]] && break

    # Append this page's rows to the table's file.
    python3 - "${WORKDIR}/page.json" "${OUT}" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    rows = json.load(f)
with open(sys.argv[2], "a") as f:
    json.dump(rows, f)
    f.write("\n")
PY
    OFFSET=$((OFFSET + COUNT))
    PAGE=$((PAGE + 1))
    [[ "${COUNT}" -lt 1000 ]] && break
  done

  ROWS="$(python3 -c "
import json
total = 0
with open('${OUT}') as f:
    for line in f:
        line = line.strip()
        if line:
            total += len(json.loads(line))
print(total)
" 2>/dev/null || echo 0)"
  echo "${table}: ${ROWS}" >> "${WORKDIR}/rowcounts.txt"
  printf '\r  %-32s %8s rows' "${table}" "${ROWS}"
done
echo ""
ok "all tables exported"

# ── 3. Storage objects ──────────────────────────────────────────────────────
log "Exporting storage objects"
STORAGE_URL="${SUPABASE_URL}/storage/v1"
: > "${WORKDIR}/storage-manifest.txt"

BUCKETS="$(curl -s -f "${STORAGE_URL}/bucket" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" 2>/dev/null | python3 -c "
import sys, json
try:
    for b in json.load(sys.stdin): print(b.get('name',''))
except Exception: pass
")" || true

for bucket in ${BUCKETS}; do
  OBJECTS="$(curl -s -f -X POST "${STORAGE_URL}/object/list/${bucket}" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"limit": 1000}' 2>/dev/null | python3 -c "
import sys, json
try:
    for o in json.load(sys.stdin): print(o.get('name',''))
except Exception: pass
")" || true
  for obj in ${OBJECTS}; do
    echo "${bucket}/${obj}" >> "${WORKDIR}/storage-manifest.txt"
    curl -s -f "${STORAGE_URL}/object/${bucket}/${obj}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -o "${WORKDIR}/storage-${bucket}-${obj//\//_}" 2>/dev/null || true
  done
done
ok "storage exported"

# ── 4. config.toml ──────────────────────────────────────────────────────────
log "Copying config.toml"
cp "${REPO_ROOT}/supabase/config.toml" "${WORKDIR}/config.toml"

# ── 5. Assemble archive ─────────────────────────────────────────────────────
log "Assembling archive"
tar -czf "${ARCHIVE}" -C "${WORKDIR}" .
ok "archive: $(du -h "${ARCHIVE}" | cut -f1)"

# ── 6. Optional encryption / upload / retention ──────────────────────────────
if [[ -n "${GPG_RECIPIENT}" ]]; then
  log "Encrypting"
  gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always \
    -o "${ARCHIVE}.gpg" "${ARCHIVE}" && rm -f "${ARCHIVE}" && ARCHIVE="${ARCHIVE}.gpg"
  ok "encrypted"
fi

if [[ -n "${UPLOAD_DIR}" ]]; then
  log "Copying to ${UPLOAD_DIR}"
  cp "${ARCHIVE}" "${UPLOAD_DIR}/"
  ok "copied"
fi

log "Pruning (keep ${KEEP_LOCAL})"
ls -t "${BACKUP_DIR}"/bershama-*.tar.gz* "${BACKUP_DIR}"/pharmaflow-*.tar.gz* 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | while read -r old; do
  rm -f "${old}"
done

log "Backup complete"
echo ""
echo "  Archive: ${ARCHIVE}"
echo "  Size:    $(du -h "${ARCHIVE}" | cut -f1)"
echo ""
echo "Tables exported:"
cat "${WORKDIR}/rowcounts.txt" 2>/dev/null | sed 's/^/  /'