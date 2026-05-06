#!/usr/bin/env bash
# Run coverage across all backend services and print the four required
# metrics — statement, decision, condition, decision/condition —
# computed by scripts/coverage-metrics.js from each service's
# istanbul-format coverage-final.json.
#
# Unlike the previous version, none of the four metrics are proxied: see
# scripts/coverage-metrics.js for the methodology.
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

  # Use node to extract each metric from the JSON we already computed,
  # rather than re-invoking jq (not present on every dissertation reviewer's box).
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

echo ""
echo "${BOLD}Running coverage across all backend services...${RESET}"
echo "${DIM}(this typically takes 20–40 seconds)${RESET}"
echo ""

# Run each service. Vitest services use the istanbul provider configured in
# their vitest.config.js; jest reads its own jest.config.js.
VIOLATION_JSON=$(run_service services/violation-analysis-service \
  npx vitest run --coverage)

NOTIFICATION_JSON=$(run_service services/notification-service \
  npx vitest run --coverage)

# Auth-service: the unit suite is the only one that runs without a live DB.
# That means index.js (the express routes) is partly uncovered here — the
# integration suite covers it, but it requires a Postgres reachable on
# localhost:5432. We deliberately keep this run unit-only so the script
# works on any machine without environment setup; reviewers who want the
# full picture run `npm test --coverage` from the auth-service directory
# with their DB env vars set.
AUTH_JSON=$(run_service services/authentication-service \
  node --experimental-vm-modules node_modules/.bin/jest \
    --selectProjects unit --coverage)

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
  "Authentication Service (unit suite)" \
  "$AUTH_JSON" \
  "Run \`cd services/authentication-service && npm test -- --coverage\` with DB env vars to include integration coverage."

echo ""
divider
echo "${DIM}Methodology: every metric is computed from Istanbul's"
echo "coverage-final.json (branchMap.type), not derived as a proxy."
echo "See docs/coverage-methodology.md for definitions and limitations.${RESET}"
divider
echo ""
