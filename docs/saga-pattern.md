# Saga Pattern — Implementation Notes

This document explains how SnapPark's distributed transactions are
managed by an orchestrated saga, what the compensations look like, and
the design decisions a reader should be aware of when comparing this
implementation to the textbook pattern.

## Why a saga at all

Three of SnapPark's flows touch more than one local transaction across
more than one bounded context:

| Flow | Local transactions | Boundary crossings |
|------|--------------------|--------------------|
| **Case creation** | INSERT `cases`, INSERT `case_images`, INSERT `case_audit_log`, RabbitMQ publish | violation-analysis-service ↔ RabbitMQ ↔ notification-service |
| **Report-to-authority** | UPDATE `cases`, INSERT `case_audit_log`, RabbitMQ publish | (same as above) |
| **Email-OTP registration** | INSERT `users`, INSERT `otps`, SMTP send | authentication-service only — no distributed transaction |

A two-phase commit (2PC) across two PostgreSQL databases plus RabbitMQ
is not realistic for a microservice architecture: the participants do
not share a transaction manager, and even if they did, holding XA locks
across an HTTP-mediated boundary defeats the purpose of having
independent services. The saga pattern is the standard alternative —
each step is a local ACID transaction, and consistency at the
distributed level is achieved by *eventual* consistency, with explicit
compensating transactions to undo committed work when a later step
fails.

We implement the saga for the **case-creation flow**. Report-to-authority
is intentionally left as a single-service flow for now: it has only one
durable side-effect (the status update) plus an event publish. Adding a
saga there would be ceremony without benefit, and the dissertation
honestly says so.

## Orchestration vs choreography

The chosen style is **orchestration**: the violation-analysis-service
is the saga coordinator. It calls each step, observes the outcome, and
decides whether to advance, retry, or compensate.

Reasons:

1. **Linear flow with one initiator.** The saga starts with an HTTP
   `POST /violations/analyze`. There is exactly one participant that
   "owns" the user-visible outcome of this transaction — the
   violation-analysis-service. Choreography would scatter the
   compensation logic across services, hiding it behind subscription
   topology.

2. **One audit trail.** The `sagas` table holds the entire history of
   each saga in one place — every step start, every step success or
   failure, every compensation, every external event that arrived
   later. The dissertation defends this with `GET /sagas/:id` which
   returns the full lifecycle of any saga in a single JSON document.

3. **Easier to demonstrate correctness.** Compensations are unit-testable
   without bringing up two services and a broker; we mock the step
   side-effects and assert the order of compensation calls (see
   `tests/saga-coordinator.test.js`).

A choreography-only design would be defensible in a system where the
case-creation flow had several initiators or where notification-service
needed to enrich the case with data of its own. Neither is true here.

## Step graph and compensations

```
                                   ┌─────────────────────┐
        POST /violations/analyze   │   sagas table       │
                  │                │  status: running    │
                  ▼                │  history: [ … ]     │
   ┌────────────────────────────┐  └─────────────────────┘
   │ 1. analyzeImage            │  no compensation (read-only)
   │    └─ Gemini API call      │
   ├────────────────────────────┤
   │ 2. persistCase             │  ↩ DELETE FROM cases WHERE id = ctx.caseId
   │    └─ INSERT cases         │
   ├────────────────────────────┤
   │ 3. persistImages           │  ↩ DELETE FROM case_images WHERE case_id = ctx.caseId
   │    └─ INSERT case_images   │
   ├────────────────────────────┤
   │ 4. recordAuditCreated      │  ↩ INSERT audit "CaseCreationCompensated"
   │    └─ INSERT case_audit_log│     (audit log is append-only by design)
   ├────────────────────────────┤
   │ 5. dispatchNotification    │  ↩ publish "case.cancelled"
   │    └─ publish "case.created"│
   └────────────────────────────┘
```

Compensations run in **reverse order of completion** (LIFO). A
compensation only fires for a step whose forward action *completed*; if
step 4 itself throws, step 4's compensation does not run because step 4
was never in a "done" state. This is what every saga literature source
calls out as the canonical semantic, and it is what
`tests/saga-coordinator.test.js > "skips compensations for steps that
lack one"` and `> "rolls everything back when the audit step fails"`
verify in code.

### The append-only audit-log compensation

`recordAuditCreated`'s compensation is *not* a deletion. The audit log
is the authoritative tamper-evident history for the system (NFR6 —
Auditability) and must never lose rows. The compensation is therefore
to **append a new entry** of type `CaseCreationCompensated` recording
that the original `CaseCreated` event has been logically rolled back.
Anyone replaying the log gets the truth: the case was created, then the
saga compensated, then the case rows were deleted.

### The notification-publish compensation

`dispatchNotification`'s compensation publishes `case.cancelled`. The
notification-service subscribes to this topic and treats it as a
request to suppress / withdraw any in-app notification it produced.
Crucially, this compensation is **best-effort**: if the broker is
unavailable at compensation time we log the failure and continue with
the other compensations rather than blocking. The saga is still marked
COMPENSATED at the end if the database compensations succeed — the
broker compensation is a leaky boundary by definition.

## Distributed compensation: notification.failed

Sometimes a notification dispatch *appears* to succeed (the publish
returns) and only later does it actually fail (the email bounces, the
SMTP server is down, every channel returns an error). By that time the
saga has already returned 201 to the client.

To close this loop:

1. The notification-service's dispatcher checks whether **every** enabled
   channel for a notification failed. If so, it publishes
   `notification.failed` with the originating `sagaId`, `caseId`, and the
   per-channel errors.
2. The violation-analysis-service runs a saga listener that subscribes
   to `notification.failed`. On receipt it:
   - appends an `external/event/notification.failed` entry to the
     saga's `history` (so `GET /sagas/:id` still tells the whole story);
   - tags the case row with `status = 'notification_failed'` (only if
     the case was previously `completed` — it won't downgrade a
     reported case);
   - writes a `NotificationFailed` audit entry.

Note what we do *not* do: we do not delete the case. The Gemini
analysis is independently valuable to the user; if we couldn't reach
them by email, the right answer is "tell them next time they log in",
not "throw away the analysis". This is a real-world saga design call:
the compensation policy at a soft boundary differs from the policy at
a hard boundary.

## Durability and recovery

Saga state is persisted to the `sagas` table in `case_db` at every
transition (insert on start, update on every step boundary, append-only
history). If the violation-analysis-service crashes mid-saga, the
state is recoverable — though we have not yet implemented an automatic
recovery loop, the data is in place to add one (`SELECT * FROM sagas
WHERE status IN ('running','compensating')` on startup, then either
resume forward or trigger compensations).

For the dissertation's scope, in-flight crash recovery is documented as
a known extension; the existing implementation guarantees:

- On a crash *between* steps, the saga is left at status `running`
  with the last completed step recorded in `current_step` and the
  full execution history in `history`.
- On a crash *during* a step's compensation, the saga is left at
  status `compensating` with the last attempted compensation logged.
- On compensation failure (the compensation *itself* throws), the saga
  is marked `failed` rather than `compensated`, signalling that
  manual intervention is required.

## What this saga does NOT cover

To be honest about the scope:

1. **Idempotency keys.** A retried `POST /violations/analyze` with the
   same payload would create a second saga and a second case. Production
   sagas typically take a client-supplied idempotency key. This is a
   known extension.
2. **Cross-saga interaction.** If a user's `POST /report` runs
   concurrently with the `POST /analyze` saga that produced the case,
   there is no cross-saga lock. For SnapPark's flow this can't actually
   happen (you can't report a case until after analyze returns), but a
   stricter system would use saga-level optimistic concurrency.
3. **Automatic resumption after process crash.** As noted above, the
   data is there but the loop is not.

## Tests as evidence

The dissertation reviewer can reproduce the behaviour by running:

```sh
cd services/violation-analysis-service
npx vitest run tests/saga-coordinator.test.js tests/saga-case-creation.test.js
```

The tests prove, with no live services or broker:

- compensations run in reverse order of completion;
- compensations are skipped for the failing step itself;
- a compensation that throws marks the saga `FAILED` (not `COMPENSATED`);
- the original error is preserved as `.cause` on the thrown saga error;
- each forward step has its expected compensation wired correctly
  (case-row delete on persistCase, case_images delete on persistImages,
  audit-rollback append on recordAuditCreated, case.cancelled publish on
  dispatchNotification);
- analyzer-only failures (Gemini error) leave **zero** persisted state
  to compensate.

The `recordSagaEvent` test verifies the append-only history mechanism
used by the distributed-compensation listener.
