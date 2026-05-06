# Coverage Methodology

This document explains how the four coverage metrics reported by
`coverage.sh` are computed, what they actually measure, and what they do
not. It exists so the dissertation can cite a single source of truth
rather than re-derive the methodology in prose.

## The four metrics

| Metric | Definition (per IEEE 982 / ISO 26262) | What this project measures |
|--------|---------------------------------------|----------------------------|
| **Statement coverage** | Every executable statement has been executed at least once. | Statements hit / total statements, summed across all source files. |
| **Decision coverage** | Every Boolean *decision* has taken every outcome (true and false; for `switch`, every case). | Outcomes-of-decision-branches hit / total outcomes-of-decision-branches. |
| **Condition coverage** | Every atomic Boolean *condition* (each operand of `&&`/`\|\|`, each default-arg test) has evaluated to both true and false. | Outcomes-of-condition-branches hit / total outcomes-of-condition-branches. |
| **Decision/Condition coverage (D/CC)** | Every decision outcome **and** every condition outcome has been reached. | (decision_hits + condition_hits) / (decision_total + condition_total) — the IEEE 982 union form. |

All four are computed by [`scripts/coverage-metrics.js`](../scripts/coverage-metrics.js)
from each service's Istanbul-format `coverage-final.json`.

## Why the previous approach was a proxy

Before this work, `coverage.sh` reported branch coverage twice:
- once as "Decision coverage" (correct);
- once as "Condition coverage" (a proxy);
- once as "Decision/Condition coverage" (a proxy).

That happened because the project's Vitest configuration used the **V8
coverage provider** (`provider: 'v8'`), which is the default. V8 coverage
is collected from the JavaScript engine's own byte-range instrumentation
and only records *which byte ranges executed*. It cannot decompose a
compound expression such as `a && b` into individual condition outcomes,
because by the time the engine sees the code those operands are
indistinguishable from any other byte range. Branch coverage was the
closest available number and was therefore reused as a stand-in for the
two condition-flavoured metrics — but it was not, in fact, measuring
them.

## Why the current approach is real

This project now uses the **Istanbul provider** for both Vitest services
(notification, violation-analysis) and Jest's bundled Istanbul for the
authentication service. Istanbul instruments the AST before the code
runs, and so writes a `branchMap` whose every entry carries a `type`:

| `type` | Construct | Counted as |
|--------|-----------|------------|
| `if` | `if (cond) { … } else { … }` | Decision |
| `cond-expr` | `cond ? x : y` (ternary) | Decision |
| `switch` | `switch (x) { case … }` | Decision |
| `binary-expr` | `a && b` / `a \|\| b` short-circuit | Condition |
| `default-arg` | `function f(x = expr)` default | Condition |

Each entry has a parallel `b[id]` array of per-outcome hit counts. The
analyzer walks every file, classifies each branch, and accumulates the
two buckets. The four metrics fall out of these counts directly — no
proxying.

This also means the four numbers are now *genuinely different*. On the
authentication service's full test run, for example, decision coverage
sits at 70.4% while condition coverage sits at 69.2% — a 1.2-point gap
that the previous tooling could not have shown.

## What this still does not measure: MC/DC

**Modified Condition / Decision Coverage** (DO-178B Level A; the metric
typically required for safety-critical avionics software) is *stricter*
than D/CC: it requires, for each condition `c` in a decision, at least
one pair of test cases that differ only in `c` and that produce
different decision outcomes. In other words, every condition must be
shown to *independently* affect the decision.

MC/DC is **not measured** by this project, and to our knowledge no
production-grade JavaScript coverage tool measures it. The cause is not
laziness in tooling — Istanbul has all the AST information it would
need — but that MC/DC is fundamentally a per-test-case analysis, not a
per-execution analysis. Computing it requires correlating each test
case's input vector to the resulting condition outcomes, which Istanbul
does not record.

The dissertation reports D/CC, not MC/DC, and labels the column
accordingly. Where the reading list (e.g. some software-engineering
textbooks) writes "MC/DC" loosely as a synonym for D/CC, the stricter
DO-178B definition does *not* hold here.

## Why some numbers are low

The authentication service's unit-only run reports very low coverage
(~4%) because the unit suite covers only [`helpers.js`](../services/authentication-service/src/helpers.js)
— the route handlers in [`index.js`](../services/authentication-service/src/index.js) require a live
PostgreSQL database. Running the full suite (unit + integration) with a
reachable database lifts coverage to roughly 77% statement and 70%
D/CC. The default `coverage.sh` uses the unit suite only so that it
runs on any machine with no environment setup, with a printed hint on
how to include integration coverage.

## Reproducing the numbers

```sh
# Aggregate report across all services
./coverage.sh

# Single-service deep dive (full suite, requires DB env vars for auth)
cd services/authentication-service
DB_HOST=localhost DB_PORT=5432 DB_NAME=snappark_auth \
  DB_USER=snappark_user DB_PASSWORD=snappark_password \
  npm test -- --coverage
node ../../scripts/coverage-metrics.js coverage/coverage-final.json auth-full
```

The analyzer prints a JSON object with `hit`, `total`, and `pct` for each
of the four metrics, suitable for inclusion in a results table verbatim.
