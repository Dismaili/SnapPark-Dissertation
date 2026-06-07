# SnapPark — End-to-End test & live demo runbook

This folder contains a single bash script that:

1. Acts as the **happy-path E2E integration test** for the whole system.
2. Doubles as the **automated capture script for the live Gemini demo**
   referenced in the dissertation evaluation chapter.

It walks the citizen journey from `docker compose up` to a verified
`case → notification → email` chain, against the **real Gemini API**, and
saves every HTTP response and service log to a timestamped folder ready
to drop straight into the dissertation appendix.

---

## What the script proves

Each section of the script asserts one fact about the system. If any
assertion fails, the script exits non-zero with a clear error.

| #  | Asserts                                                                                          |
| -- | ------------------------------------------------------------------------------------------------ |
| 1  | `docker compose` brings every container up                                                       |
| 2  | All four services answer `GET /health` with 200                                                  |
| 3  | `POST /auth/register` returns a JWT pair and a user id                                           |
| 4  | `PUT /notifications/preferences/:userId` persists channel preferences                            |
| 5  | `POST /violations/analyze` returns 200 with a parsed Gemini verdict in <30 s                     |
| 6  | The case row is queryable, in `completed` status, with at least one audit entry                  |
| 7  | A `RabbitMQ → notification-service` message arrived: an in-app notification appears in the inbox |
| 8  | `/notifications/unread-count/:userId` reflects the new notification                              |
| 9  | Per-channel `delivery_log` rows exist for the channels that were enabled                         |
| 10 | (optional) `PATCH /report` and `PATCH /resolve` walk the full case lifecycle                     |
| 11 | (optional) A 50×50 image is rejected with HTTP **422 *before* Gemini is called**                 |

The exit code is `0` only when every assertion passes — making the script
suitable for CI as well.

---

## Prerequisites

| Requirement       | Why                                          | How                                                 |
| ----------------- | -------------------------------------------- | --------------------------------------------------- |
| Docker Desktop    | Brings the compose stack up                  | https://docs.docker.com/desktop/                    |
| `curl`, `jq`      | HTTP + JSON                                  | macOS: pre-installed. Linux: `sudo apt install jq`  |
| `GEMINI_API_KEY`  | The whole point of the live test             | https://aistudio.google.com/app/apikey              |
| A test image      | Something Gemini can plausibly analyse       | See `fixtures/README.md`                            |

The Gemini key must be set in [`deployment/.env`](../../deployment/.env)
under `GEMINI_API_KEY=…`. The script will warn if it's still the placeholder.

The default model is `gemini-2.0-flash-lite`, which is on the free tier of the
Gemini API. Override with `GEMINI_MODEL=gemini-2.5-flash` (paid) for higher
quality analysis. Free-tier projects share a *daily* and *per-minute* quota
across the whole project — if you hit `429 Quota exceeded` (the script will
say so explicitly), wait ~60 s and rerun, or upgrade billing on the project.

---

## Running it

From the repository root:

```bash
# Most common — the script brings the stack up, runs the test, tears it down
./tests/e2e/run-e2e.sh --image ~/Downloads/test-violation.jpg

# Stack already running (faster iteration during development)
./tests/e2e/run-e2e.sh --no-up --keep-stack --image ~/Downloads/test-violation.jpg

# Also exercise the bad-quality rejection path
./tests/e2e/run-e2e.sh --reject-test --image ~/Downloads/test-violation.jpg
```

A typical run takes ~2 min cold (compose build + Gemini round-trip) or
~10 s warm with `--no-up`.

---

## What you get back

Every run writes to `tests/e2e/artifacts/<timestamp>/`:

```
20260430-141523/
├── 00-compose-up.log              # docker compose output
├── 01-register-response.json      # POST /auth/register
├── 02-preferences-response.json   # PUT /notifications/preferences
├── 03-analyze-response.json       # the live Gemini verdict
├── 03-analyze-timing.txt          # end-to-end latency for the analyze call
├── 04-input-image.jpg             # copy of the image you submitted
├── 05-case-detail.json            # GET /violations/:id
├── 06-case-audit.json             # GET /violations/:id/audit
├── 07-notifications-inbox.json    # GET /notifications
├── 08-unread-count.json           # GET /notifications/unread-count/:userId
├── 09-delivery-log.json           # GET /notifications/delivery-log/:caseId
├── 10-report-response.json        # PATCH /violations/:id/report (if confirmed)
├── 11-resolve-response.json       # PATCH /violations/:id/resolve
├── 12-reject-response.json        # 422 from the quality pre-filter (if --reject-test)
├── 20-violation-service.log       # docker compose logs
├── 21-notification-service.log
├── 22-api-gateway.log
└── run.log                        # full stdout of this run, with colour codes stripped
```

**This folder is the dissertation evidence pack.** Move it to
`docs/dissertation/demo-evidence/<scenario>/` and reference it in the
evaluation chapter.

> ⚠️  Files in `artifacts/` contain a JWT and the live Gemini API response.
> The folder is gitignored — do not commit it. Redact the JWT before
> pasting any response into the dissertation.

---

## Using this for the dissertation chapter

The evaluation chapter typically wants three pieces of evidence:

1. **Functional correctness** — the full chain works.
   - Run the script with a clear-violation image.
   - Reference `03-analyze-response.json` and `07-notifications-inbox.json`.

2. **Pre-filter cost saving** — bad images don't reach Gemini.
   - Run with `--reject-test`.
   - Reference `12-reject-response.json` (HTTP 422) and the
     violation-service log showing no Gemini line for that timestamp.

3. **Latency profile** — measured Gemini round-trip.
   - Run the script 5 times with the same image, each time noting
     `03-analyze-timing.txt`.
   - Report mean ± stddev in the dissertation.

A short script for the latency run:

```bash
for i in $(seq 1 5); do
  ./tests/e2e/run-e2e.sh --no-up --keep-stack --image ~/Downloads/violation.jpg
done
grep -h "in " tests/e2e/artifacts/*/03-analyze-timing.txt | awk '{print $3}' | sort -n
```

---

## Troubleshooting

| Symptom                                            | Cause / fix                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `failed to connect to the docker API`              | Docker Desktop isn't running. Open it, wait for the whale icon to settle.         |
| `GEMINI_API_KEY is not set`                        | Edit `deployment/.env` — replace the placeholder with your key.                   |
| Gemini returns HTTP 400 / "API key not valid"      | Key revoked or wrong project — regenerate at https://aistudio.google.com.         |
| Gemini returns HTTP 403 "denied access"            | The model isn't available to this project. Set `GEMINI_MODEL=gemini-2.0-flash-lite` in `deployment/.env` and re-build the violation service. |
| Gemini returns HTTP 429 "limit: 0"                 | Free-tier quota fully exhausted (per-day or per-project). Wait until UTC midnight or enable billing on the GCP project that owns the key. The script will print the retry hint from Google's response. |
| `analyze: expected 200/201, got 422`               | The image failed the quality pre-filter — try a clearer photo.                    |
| No notification appears after 10 s                 | Check `21-notification-service.log` — usually RabbitMQ wasn't ready when the event was emitted. Add `--no-up --keep-stack` and rerun. |
| Email channel logs `EmailChannel error`            | Gmail blocking your app password — see `deployment/.env` SMTP section. In-app notifications still work, which is enough for the test to pass. |
| `unknown flag: --no-turbopack`                     | Older Docker Compose. Upgrade Docker Desktop to ≥ 4.30.                           |
