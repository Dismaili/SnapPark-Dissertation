#!/usr/bin/env bash
# Run coverage across all backend services and print the four required
# metrics — statement, decision, condition, decision/condition —
# computed by scripts/coverage-metrics.js from each service's
# istanbul-format coverage-final.json.
#
# None of the four metrics are proxied: see scripts/coverage-metrics.js
# for the methodology.
#
# Usage: ./coverage.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
ANALYZER="$ROOT/scripts/coverage-metrics.js"

BOLD=$'\033[1m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

divider() { echo "${CYAN}──────────────────────────────────────────────────────${RESET}"; }

# Render the four metrics from a JSON blob produced by the analyzer.
print_metrics() {
  local title="$1"
  local json="$2"
  local note="$3"

  echo ""
  echo "${BOLD}${title}${RESET}"
  divider

  if [ -z "$json" ]; then
    echo "  ${YELLOW}Coverage report missing — no metrics to display.${RESET}"
    return
  fi

  node -e "
    const m = JSON.parse(process.argv[1]).metrics;
    const fmt = (k, name) => {
      const x = m[k];
      const pad = name.padEnd(32);
      const pct = String(x.pct).padStart(6);
      const tally = x.total === 0 ? '(no constructs of this type)' : '(' + x.hit + '/' + x.total + ')';
      console.log('  ' + pad + ' \x1b[32m' + pct + '%\x1b[0m  \x1b[2m' + tally + '\x1b[0m');
    };
    fmt('statement',         'Statement coverage:');
    fmt('decision',          'Decision coverage:');
    fmt('condition',         'Condition coverage:');
    fmt('decisionCondition', 'Decision/Condition coverage:');
  " "$json"

  if [ -n "$note" ]; then
    echo "  ${DIM}${note}${RESET}"
  fi
}

# Run a service's test suite with coverage and capture the metrics, returning
# the analyzer JSON on stdout. Failures are non-fatal: missing reports show
# up as empty strings and the print step degrades gracefully.
run_service() {
  local dir="$1"
  shift
  local cmd="$*"

  (cd "$ROOT/$dir" && eval "$cmd" > /dev/null 2>&1) || true

  local report="$ROOT/$dir/coverage/coverage-final.json"
  if [ -f "$report" ]; then
    node "$ANALYZER" "$report" "$dir"
  fi
}

# Detect whether the auth-service Postgres is reachable. If so we run the
# integration suite (which exercises ~80% of routes); otherwise we fall back
# to the unit-only suite so the script still works on machines that don't
# have a database stood up.
auth_db_reachable() {
  local host="${DB_HOST:-localhost}"
  local port="${DB_PORT:-5432}"
  if command -v nc > /dev/null 2>&1; then
    nc -z "$host" "$port" > /dev/null 2>&1
  else
    # Fall back to a python one-liner if nc is not installed.
    python3 - <<EOF > /dev/null 2>&1
import socket, sys
s = socket.socket()
s.settimeout(1)
try:
    s.connect(("$host", $port))
    sys.exit(0)
except Exception:
    sys.exit(1)
EOF
  fi
}

echo ""
echo "${BOLD}Running coverage across the frontend, three backend services and the api-gateway...${RESET}"
echo "${DIM}(this typically takes 30–60 seconds)${RESET}"
echo ""

VIOLATION_JSON=$(run_service services/violation-analysis-service \
  npx vitest run --coverage)

NOTIFICATION_JSON=$(run_service services/notification-service \
  npx vitest run --coverage)

GATEWAY_JSON=$(run_service services/api-gateway \
  npx vitest run --coverage)

FRONTEND_JSON=$(run_service frontend \
  npx vitest run --coverage)

AUTH_NOTE=""
if auth_db_reachable; then
  AUTH_NOTE="Includes unit + integration suite (Postgres detected on ${DB_HOST:-localhost}:${DB_PORT:-5432})."
  AUTH_JSON=$(run_service services/authentication-service \
    "DB_HOST=${DB_HOST:-localhost} DB_PORT=${DB_PORT:-5432} \
     DB_NAME=${DB_NAME:-auth_db} DB_USER=${DB_USER:-postgres} DB_PASSWORD=${DB_PASSWORD:-postgres} \
     JWT_SECRET=${JWT_SECRET:-dev-secret-key} JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-dev-refresh-secret-key} \
     node --experimental-vm-modules node_modules/.bin/jest --runInBand --coverage")
else
  AUTH_NOTE="Unit suite only — Postgres not reachable on ${DB_HOST:-localhost}:${DB_PORT:-5432}. Start it (\`docker compose up -d auth-db\`) for full coverage."
  AUTH_JSON=$(run_service services/authentication-service \
    node --experimental-vm-modules node_modules/.bin/jest \
      --selectProjects unit --coverage)
fi

# ── Print the report ─────────────────────────────────────────────────────────

echo "${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}║              SNAPPARK COVERAGE REPORT                ║${RESET}"
echo "${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"

print_metrics \
  "Violation Analysis Service" \
  "$VIOLATION_JSON" \
  ""

print_metrics \
  "Notification Service" \
  "$NOTIFICATION_JSON" \
  ""

print_metrics \
  "API Gateway" \
  "$GATEWAY_JSON" \
  ""

print_metrics \
  "Authentication Service" \
  "$AUTH_JSON" \
  "$AUTH_NOTE"

print_metrics \
  "Frontend (lib + components)" \
  "$FRONTEND_JSON" \
  "Page components (src/app/**) are excluded; they integrate Next.js server-only utilities and are covered by the e2e suite."

echo ""
divider
echo "${DIM}Methodology: every metric is computed from Istanbul's"
echo "coverage-final.json (branchMap.type), not derived as a proxy."
echo "See docs/coverage-methodology.md for definitions and limitations.${RESET}"
divider
echo ""
