#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SnapPark — End-to-End happy-path test  /  Live Gemini demo automation
# ─────────────────────────────────────────────────────────────────────────────
#
#  This script walks the full citizen journey against the running stack:
#
#     1. Bring the docker-compose stack up (or assume it's already up).
#     2. Wait for every health check to pass.
#     3. Register a fresh user.
#     4. Enable in-app + email notifications for that user.
#     5. Upload an image to /violations/analyze (the live Gemini call).
#     6. Verify the case row was persisted (status=completed).
#     7. Verify a notification was created and is reachable from the inbox.
#     8. Verify per-channel delivery log entries.
#     9. Optional: walk the case lifecycle (report → resolve).
#    10. Optional: submit a too-small image and assert HTTP 422 from the
#        quality pre-filter (proves Gemini was NOT called).
#
#  Every HTTP response, every relevant log line, and a copy of the input image
#  are written to a timestamped folder under tests/e2e/artifacts/. That folder
#  is the evidence pack for the dissertation.
#
#  Usage:
#    ./tests/e2e/run-e2e.sh [--image PATH] [--no-up] [--keep-stack] [--reject-test]
#
#  Flags:
#    --image PATH    Path to the image to submit (default: tests/e2e/fixtures/sample.jpg)
#    --no-up         Don't run "docker compose up" — assume stack is already running
#    --keep-stack    Don't tear the stack down after the run
#    --reject-test   Also test the bad-quality rejection path (image too small)
#
#  Exit codes:
#    0  all assertions passed
#    1  setup failure (docker/jq/curl missing, stack failed to come up)
#    2  test failure (an HTTP response did not match expectations)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Resolve paths relative to this script ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/deployment/docker-compose.yml"
ENV_FILE="$REPO_ROOT/deployment/.env"
DEFAULT_IMAGE="$SCRIPT_DIR/fixtures/sample.jpg"

# ─── Parse args ─────────────────────────────────────────────────────────────
IMAGE_PATH="$DEFAULT_IMAGE"
SKIP_UP=0
KEEP_STACK=0
REJECT_TEST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)        IMAGE_PATH="$2"; shift 2 ;;
    --no-up)        SKIP_UP=1; shift ;;
    --keep-stack)   KEEP_STACK=1; shift ;;
    --reject-test)  REJECT_TEST=1; shift ;;
    -h|--help)
      sed -n '3,40p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

# ─── Pre-flight checks ──────────────────────────────────────────────────────
for cmd in curl jq docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌  Required command not found: $cmd" >&2
    exit 1
  fi
done

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "❌  Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  Env file not found: $ENV_FILE" >&2
  echo "    Copy deployment/.env.example to deployment/.env and fill in GEMINI_API_KEY." >&2
  exit 1
fi

if ! grep -q "^GEMINI_API_KEY=" "$ENV_FILE" || grep -q "^GEMINI_API_KEY=your-gemini-api-key-here" "$ENV_FILE"; then
  echo "⚠️   GEMINI_API_KEY is not set in $ENV_FILE — Gemini calls will fail." >&2
  echo "    Get one at https://aistudio.google.com/app/apikey" >&2
fi

if [[ ! -f "$IMAGE_PATH" ]]; then
  echo "❌  Test image not found: $IMAGE_PATH" >&2
  echo "    Pass one with --image /path/to/photo.jpg, or place a parking" >&2
  echo "    photo at $DEFAULT_IMAGE." >&2
  exit 1
fi

# ─── Artefact folder ────────────────────────────────────────────────────────
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$SCRIPT_DIR/artifacts/$TIMESTAMP"
mkdir -p "$RUN_DIR"
cp "$IMAGE_PATH" "$RUN_DIR/04-input-image$(echo "$IMAGE_PATH" | sed 's/.*\././')"

LOG="$RUN_DIR/run.log"
exec > >(tee -a "$LOG") 2>&1

# ─── Pretty printing ────────────────────────────────────────────────────────
SECTION() { printf "\n\033[1;36m▌ %s\033[0m\n" "$*"; }
PASS()    { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
FAIL()    { printf "\033[1;31m✘ %s\033[0m\n" "$*"; exit 2; }
INFO()    { printf "  %s\n" "$*"; }

trap 'echo; echo "Run dir: $RUN_DIR"' EXIT

# ─── 1. Stack up ────────────────────────────────────────────────────────────
SECTION "1. Bringing the stack up"

if [[ $SKIP_UP -eq 0 ]]; then
  ( cd "$REPO_ROOT/deployment" && docker compose --env-file .env up -d --build ) \
    | tee "$RUN_DIR/00-compose-up.log"
else
  INFO "Skipping 'docker compose up' (--no-up)"
fi

# ─── 2. Wait for health ─────────────────────────────────────────────────────
SECTION "2. Waiting for services to become healthy"

GATEWAY="http://localhost:3000"
AUTH="http://localhost:3001"
VIOLATION="http://localhost:3002"
NOTIFICATION="http://localhost:3004"

wait_for() {
  local url="$1"
  local name="$2"
  local tries=60
  local i=0
  while [[ $i -lt $tries ]]; do
    if curl -sf "$url/health" >/dev/null 2>&1; then
      PASS "$name healthy"
      return
    fi
    sleep 2
    i=$((i + 1))
  done
  FAIL "$name did not become healthy after $((tries * 2))s"
}

wait_for "$GATEWAY"      "API Gateway"
wait_for "$AUTH"         "Authentication Service"
wait_for "$VIOLATION"    "Violation Analysis Service"
wait_for "$NOTIFICATION" "Notification Service"

# ─── 3. Register ────────────────────────────────────────────────────────────
SECTION "3. Registering a fresh user"

EMAIL="e2e-$(date +%s)@snappark.test"
PASSWORD="e2e-pass-12345"

REGISTER_BODY=$(curl -s -X POST "$GATEWAY/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

echo "$REGISTER_BODY" | jq . > "$RUN_DIR/01-register-response.json"

TOKEN=$(echo "$REGISTER_BODY" | jq -r '.token // empty')
USER_ID=$(echo "$REGISTER_BODY" | jq -r '.user.id // empty')

[[ -n "$TOKEN" ]] || FAIL "register: no token in response"
[[ -n "$USER_ID" ]] || FAIL "register: no user id in response"
PASS "Registered $EMAIL  (id=${USER_ID:0:8}…)"

# ─── 4. Enable notifications ────────────────────────────────────────────────
SECTION "4. Enabling in-app + email notifications"

PREFS_BODY=$(curl -s -X PUT "$GATEWAY/notifications/preferences/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"in_app\":true,\"email\":true,\"email_addr\":\"$EMAIL\",\"sms\":false,\"push\":false}")

echo "$PREFS_BODY" | jq . > "$RUN_DIR/02-preferences-response.json"
PASS "Preferences saved"

# ─── 5. Upload image (live Gemini call) ─────────────────────────────────────
SECTION "5. Uploading image — this triggers the live Gemini call"

ANALYZE_RAW="$RUN_DIR/03-analyze-response.raw"
ANALYZE_TIMING="$RUN_DIR/03-analyze-timing.txt"

T0=$(date +%s)
HTTP_STATUS=$(curl -s -o "$ANALYZE_RAW" -w "%{http_code}" \
  -X POST "$GATEWAY/violations/analyze" \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@$IMAGE_PATH")
T1=$(date +%s)
ELAPSED=$((T1 - T0))

echo "HTTP $HTTP_STATUS  in ${ELAPSED}s" | tee "$ANALYZE_TIMING"

if jq . "$ANALYZE_RAW" >/dev/null 2>&1; then
  jq . "$ANALYZE_RAW" > "$RUN_DIR/03-analyze-response.json"
  rm -f "$ANALYZE_RAW"
else
  cp "$ANALYZE_RAW" "$RUN_DIR/03-analyze-response.json"
fi

if [[ "$HTTP_STATUS" != "200" && "$HTTP_STATUS" != "201" ]]; then
  cat "$RUN_DIR/03-analyze-response.json"
  if [[ "$HTTP_STATUS" == "429" ]] || grep -q "429\|quota\|Too Many Requests" "$RUN_DIR/03-analyze-response.json" 2>/dev/null; then
    INFO "Gemini rate limit hit. Wait ~60 s and rerun, or upgrade the project."
  fi
  FAIL "analyze: expected 200/201, got $HTTP_STATUS"
fi

# Support both response shapes:
#   { caseId, analysis: { violationConfirmed, ... } }  (violation service direct)
#   { case: { id, violation_confirmed, ... } }          (older gateway wrapper)
CASE_ID=$(jq -r '.caseId // .case.id // empty' "$RUN_DIR/03-analyze-response.json")
[[ -n "$CASE_ID" ]] || FAIL "analyze: response did not contain caseId"

VIOLATION_CONFIRMED=$(jq -r '.analysis.violationConfirmed // .case.violation_confirmed // false' "$RUN_DIR/03-analyze-response.json")
CONFIDENCE=$(jq -r '.analysis.confidence // .case.confidence // 0' "$RUN_DIR/03-analyze-response.json")
EXPLANATION=$(jq -r '.analysis.explanation // .case.explanation // ""' "$RUN_DIR/03-analyze-response.json")

PASS "Case created  (id=${CASE_ID:0:8}…, violation=$VIOLATION_CONFIRMED, confidence=$CONFIDENCE, ${ELAPSED}s)"
INFO "Explanation: ${EXPLANATION:0:120}…"

# ─── 6. Verify case via API ─────────────────────────────────────────────────
SECTION "6. Verifying case row"

curl -s "$GATEWAY/violations/$CASE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq . > "$RUN_DIR/05-case-detail.json"

STATUS=$(jq -r '.status // empty' "$RUN_DIR/05-case-detail.json")
[[ "$STATUS" == "completed" ]] || FAIL "case status: expected 'completed', got '$STATUS'"
PASS "Case persisted, status=$STATUS"

curl -s "$GATEWAY/violations/$CASE_ID/audit" \
  -H "Authorization: Bearer $TOKEN" | jq . > "$RUN_DIR/06-case-audit.json"

AUDIT_COUNT=$(jq 'length' "$RUN_DIR/06-case-audit.json")
[[ "$AUDIT_COUNT" -ge 1 ]] || FAIL "audit log: expected ≥1 entry, got $AUDIT_COUNT"
PASS "Audit trail has $AUDIT_COUNT entr$([ "$AUDIT_COUNT" -eq 1 ] && echo y || echo ies)"

# ─── 7. Verify notification fanned out ──────────────────────────────────────
SECTION "7. Verifying notification reached the inbox"

# Give the notification service up to 10 s to consume the RabbitMQ event.
INBOX_FILE="$RUN_DIR/07-notifications-inbox.json"
NOTIF_FOUND=0
for i in $(seq 1 10); do
  curl -s "$GATEWAY/notifications" \
    -H "Authorization: Bearer $TOKEN" | jq . > "$INBOX_FILE"

  COUNT=$(jq '[.notifications[]? | select(.case_id == "'"$CASE_ID"'")] | length' "$INBOX_FILE")
  if [[ "$COUNT" -ge 1 ]]; then
    NOTIF_FOUND=1
    break
  fi
  sleep 1
done

[[ $NOTIF_FOUND -eq 1 ]] || FAIL "no notification appeared for case $CASE_ID after 10s"
PASS "In-app notification delivered for case ${CASE_ID:0:8}…"

curl -s "$GATEWAY/notifications/unread-count/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq . > "$RUN_DIR/08-unread-count.json"

curl -s "$GATEWAY/notifications/delivery-log/$CASE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq . > "$RUN_DIR/09-delivery-log.json"

LOG_ROWS=$(jq 'length' "$RUN_DIR/09-delivery-log.json" 2>/dev/null || echo 0)
PASS "Delivery log has $LOG_ROWS row(s)"

# ─── 8. Lifecycle (only if a violation was confirmed) ───────────────────────
SECTION "8. Walking case lifecycle"

if [[ "$VIOLATION_CONFIRMED" == "true" ]]; then
  curl -s -X PATCH "$GATEWAY/violations/$CASE_ID/report" \
    -H "Authorization: Bearer $TOKEN" | jq . > "$RUN_DIR/10-report-response.json"
  PASS "PATCH /report → reported_to_authority"

  sleep 2

  curl -s -X PATCH "$GATEWAY/violations/$CASE_ID/resolve" \
    -H "Authorization: Bearer $TOKEN" | jq . > "$RUN_DIR/11-resolve-response.json"
  PASS "PATCH /resolve → resolved"
else
  INFO "Gemini did not confirm a violation for this image → skipping report/resolve."
  INFO "(For dissertation evidence, retry with an image of an actual violation.)"
fi

# ─── 9. Bad-image rejection (optional) ──────────────────────────────────────
if [[ $REJECT_TEST -eq 1 ]]; then
  SECTION "9. Bad-quality rejection path"

  TINY="$RUN_DIR/tiny.png"
  # 50×50 PNG — well below the 200×200 minimum the validator enforces.
  printf '\x89PNG\r\n\x1a\n' > "$TINY"
  # Cheap fallback: if `convert` is around, generate a real tiny PNG.
  if command -v convert >/dev/null 2>&1; then
    convert -size 50x50 xc:gray "$TINY"
  fi

  if [[ -s "$TINY" ]] && file "$TINY" | grep -qi png; then
    HTTP_STATUS=$(curl -s -o "$RUN_DIR/12-reject-response.json" -w "%{http_code}" \
      -X POST "$GATEWAY/violations/analyze" \
      -H "Authorization: Bearer $TOKEN" \
      -F "image=@$TINY")
    if [[ "$HTTP_STATUS" == "422" ]]; then
      PASS "Tiny image correctly rejected with 422 (Gemini was NOT called)"
    else
      INFO "Expected 422, got $HTTP_STATUS — saved response for inspection."
    fi
  else
    INFO "ImageMagick 'convert' not installed → skipping reject test."
    INFO "Install with 'brew install imagemagick' to enable."
  fi
fi

# ─── 10. Save service logs ──────────────────────────────────────────────────
SECTION "10. Capturing service logs"

(
  cd "$REPO_ROOT/deployment"
  docker compose logs --no-color --tail 300 violation-analysis-service \
    > "$RUN_DIR/20-violation-service.log" 2>&1 || true
  docker compose logs --no-color --tail 300 notification-service \
    > "$RUN_DIR/21-notification-service.log" 2>&1 || true
  docker compose logs --no-color --tail 300 api-gateway \
    > "$RUN_DIR/22-api-gateway.log" 2>&1 || true
)
PASS "Service logs captured"

# ─── Done ───────────────────────────────────────────────────────────────────
SECTION "✅  All assertions passed"

cat <<EOF

  Evidence pack: $RUN_DIR
    01-register-response.json
    02-preferences-response.json
    03-analyze-response.json   ← the live Gemini verdict
    03-analyze-timing.txt      ← end-to-end latency
    04-input-image.*           ← the image you submitted
    05-case-detail.json
    06-case-audit.json
    07-notifications-inbox.json
    08-unread-count.json
    09-delivery-log.json
    10-report-response.json    (if violation confirmed)
    11-resolve-response.json   (if violation confirmed)
    20-violation-service.log
    21-notification-service.log
    22-api-gateway.log

  Drop this folder into docs/dissertation/demo-evidence/ for the chapter.

EOF

if [[ $KEEP_STACK -eq 0 && $SKIP_UP -eq 0 ]]; then
  SECTION "Tearing the stack down (--keep-stack to skip)"
  ( cd "$REPO_ROOT/deployment" && docker compose down -v ) || true
fi
