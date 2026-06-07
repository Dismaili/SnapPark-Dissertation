# Event-Flow Sequence Diagram

**Audience:** the dissertation reader who has seen the
[container diagram](02-container.md) and now wants to see *what actually happens
in time* when a citizen reports a violation.

This diagram traces a single happy-path request from the citizen's tap on
"Analyse" to the email landing in their inbox — including every cross-service
hop and the asynchronous handoff via RabbitMQ.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ecfdf5", "primaryBorderColor": "#059669", "primaryTextColor": "#064e3b", "actorBkg": "#ecfdf5", "actorBorder": "#059669", "actorTextColor": "#064e3b", "noteBkgColor": "#fef3c7", "noteBorderColor": "#b45309", "lineColor": "#475569"}}}%%
sequenceDiagram
    autonumber
    actor C as Citizen
    participant W as Web App<br/>(Next.js)
    participant GW as API Gateway
    participant AS as Auth Service
    participant VS as Violation Service
    participant G as Google Gemini
    participant DB as case_db
    participant MQ as RabbitMQ
    participant NS as Notification Service
    participant NDB as notifications_db
    participant SMTP as SMTP / Email

    C->>W: Tap "Analyse" on /upload
    W->>GW: POST /violations/analyze<br/>multipart + Bearer JWT
    GW->>AS: POST /auth/verify<br/>{ token }
    AS-->>GW: 200 { sub, email }

    Note over GW: Multer validates<br/>type & size<br/>(jpeg/png/webp, ≤10 MB)

    GW->>VS: POST /violations/analyze<br/>multipart + X-User-Id

    Note over VS: imageValidator.js<br/>checks resolution,<br/>brightness, blur

    alt Quality check fails
        VS-->>GW: 422 { reason }<br/>"image too blurry"
        GW-->>W: 422 (Gemini was NOT called)
        Note over VS,G: Cost-saving:<br/>bad images never<br/>reach the LLM
    else Quality OK
        VS->>G: generateContent(prompt + image)
        G-->>VS: JSON verdict<br/>{ violationConfirmed,<br/>  violationType,<br/>  confidence,<br/>  explanation }

        VS->>DB: INSERT INTO cases (status='completed', …)<br/>INSERT INTO case_images<br/>INSERT INTO audit_log
        DB-->>VS: case row

        par Synchronous response
            VS-->>GW: 200 { case }
            GW-->>W: 200 { case }
            W-->>C: Show verdict<br/>(confidence + explanation)
        and Asynchronous fan-out
            VS->>MQ: publish<br/>case.events / case.created
            MQ->>NS: deliver (case.created)

            NS->>NDB: SELECT preferences<br/>WHERE user_id = …
            NDB-->>NS: { in_app, email,<br/>  email_addr, … }

            par In-app channel
                NS->>NDB: INSERT INTO notifications
            and Email channel
                NS->>SMTP: send mail<br/>(subject, body)
                SMTP-->>NS: 250 OK
            end

            NS->>NDB: INSERT INTO delivery_log<br/>(one row per channel)
        end
    end

    Note over C: Bell badge in the<br/>Web App refreshes via<br/>GET /unread-count<br/>(polled every 30 s)
```

## Reading the diagram

- **Steps 1–3 — JWT verification.** The gateway *never* trusts a token blindly;
  it round-trips to the auth service for every protected request. This is the
  reason the auth service is on the hot path of every call.
- **Steps 5–6 — Quality pre-filter.** This is the cheapest and most important
  optimisation in the system. A blurry photo costs us a Postgres write but
  *zero* Gemini API calls. The dissertation evaluation chapter quantifies the
  saving.
- **Step 8 — the LLM call.** This is the only synchronous external dependency
  in the user's wait time. The implementation enforces a 30 s timeout at the
  gateway level so a stalled Gemini call never holds an HTTP socket open
  indefinitely.
- **Step 11 — `par` block.** As soon as the case is persisted, two things
  happen *in parallel*: the user receives their verdict, and the event is
  published to RabbitMQ. The user's response time is **not** gated on the
  notification fan-out.
- **Steps 12–17 — multi-channel fan-out.** The notification service uses
  `Promise.allSettled` over the user's enabled channels. A failing SMTP server
  produces a `delivery_log` row with `status='failed'` but does **not** block
  the in-app insert.

## Failure modes covered by this diagram

| What fails                | How the system responds                                                          | Where to verify                                   |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| JWT expired / revoked     | Auth service returns 401; gateway short-circuits with 401                         | step 3                                            |
| Image too blurry / dark   | Quality pre-filter returns 422 *before* Gemini is called                          | the `alt` branch                                  |
| Gemini returns malformed JSON | `parseResponse()` in `gemini.js` throws; the case row is *not* persisted     | step 9                                            |
| RabbitMQ unreachable      | The publish call throws; the user still receives their verdict (synchronous path completed) — the case is just left without a notification | step 11 (right side) |
| SMTP rejects the mail     | `delivery_log` records status=`failed`; in-app notification still arrives        | step 16                                           |

## What this diagram intentionally omits

- The **case lifecycle** transitions (`PATCH /report`, `PATCH /resolve`) — they
  follow the same pattern as the `case.created` event with `case.reported` and
  `case.resolved`.
- **Token rotation** during refresh — covered in the auth service's own README.
- The **cleanup job** that archives completed cases after 24 h — runs on a
  timer, not on the user request path.
