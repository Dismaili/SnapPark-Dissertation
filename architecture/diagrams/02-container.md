# Container Diagram (C4 — Level 2)

**Audience:** the dissertation reader who has read the
[system context](01-system-context.md) and now wants to know how the
**SnapPark** box is built internally.

A *container* in C4 means an independently deployable runtime — a process,
a database server, a message broker. It is **not** a Docker container in
the strict sense, although here every C4 container does map to one.

```mermaid
%%{init: {"flowchart": {"htmlLabels": true, "curve": "basis", "padding": 12}, "theme": "base", "themeVariables": {"primaryColor": "#ecfdf5", "primaryBorderColor": "#059669", "primaryTextColor": "#064e3b", "lineColor": "#475569"}}}%%
flowchart TB
    citizen(["<b>Citizen</b><br/><i>[Person]</i>"])

    subgraph snappark ["<b>SnapPark</b> &nbsp;[trust boundary]"]
        direction TB

        subgraph client ["Client tier"]
            web["<b>Web App</b><br/><i>[Container: Next.js 14]</i><br/>Citizen-facing UI.<br/>Pages: login, upload,<br/>cases, notifications,<br/>preferences."]
        end

        subgraph access ["Access tier"]
            gateway["<b>API Gateway</b><br/><i>[Container: Node.js / Express]</i><br/>JWT verification, rate-<br/>limiting, multipart<br/>image forwarding,<br/>cross-user guards."]
        end

        subgraph services ["Core services"]
            direction LR
            auth["<b>Authentication Service</b><br/><i>[Container: Node.js]</i><br/>Register, login, verify,<br/>refresh, logout. JWT<br/>issuance with rotation."]
            violation["<b>Violation Analysis Service</b><br/><i>[Container: Node.js]</i><br/>Image quality pre-filter,<br/>Gemini prompt orchestration,<br/>case lifecycle, audit log,<br/>cleanup job."]
            notification["<b>Notification Service</b><br/><i>[Container: Node.js]</i><br/>RabbitMQ consumer.<br/>Multi-channel dispatch<br/>(in-app, email, SMS, push).<br/>Per-user preferences."]
        end

        subgraph data ["Data tier"]
            direction LR
            authdb[("<b>auth_db</b><br/><i>[PostgreSQL 15]</i><br/>users, refresh_tokens")]
            casedb[("<b>case_db</b><br/><i>[PostgreSQL 15]</i><br/>cases, case_images,<br/>audit_log")]
            notifdb[("<b>notifications_db</b><br/><i>[PostgreSQL 15]</i><br/>notifications,<br/>preferences,<br/>delivery_log")]
            broker{{"<b>RabbitMQ</b><br/><i>[Message broker]</i><br/>Topic exchange<br/><tt>case.events</tt>"}}
        end
    end

    gemini["<b>Google Gemini</b><br/><i>[External]</i>"]
    smtp["<b>SMTP / Twilio / FCM</b><br/><i>[External]</i>"]

    citizen -- "[HTTPS]" --> web
    web -- "REST / JSON,<br/>multipart upload<br/>[HTTPS]" --> gateway

    gateway -- "verify JWT,<br/>register / login<br/>[HTTP]" --> auth
    gateway -- "forward image,<br/>case CRUD<br/>[HTTP / multipart]" --> violation
    gateway -- "fetch inbox &amp;<br/>preferences<br/>[HTTP]" --> notification

    auth -- "[SQL]" --> authdb
    violation -- "[SQL]" --> casedb
    notification -- "[SQL]" --> notifdb

    violation -- "Sends image +<br/>prompt<br/>[HTTPS]" --> gemini
    violation -- "Publishes<br/><tt>case.created</tt>,<br/><tt>case.reported</tt>,<br/><tt>case.resolved</tt><br/>[AMQP]" --> broker
    broker -- "[AMQP]" --> notification
    notification -- "Sends email / SMS /<br/>push<br/>[HTTPS / SMTP]" --> smtp

    classDef person fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef container fill:#ecfdf5,stroke:#059669,color:#064e3b
    classDef datastore fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef external fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
    classDef boundary fill:transparent,stroke:#94a3b8,stroke-dasharray: 4 3,color:#334155

    class citizen person
    class web,gateway,auth,violation,notification container
    class authdb,casedb,notifdb,broker datastore
    class gemini,smtp external
    class snappark,client,access,services,data boundary
```

## Why this layout

| Decision                                                   | Reason                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **One database per service**                               | Removes the temptation to join across business domains; lets each service evolve its schema without coupling.                         |
| **API Gateway in front of every service**                  | Centralises JWT verification, rate-limiting, and cross-user authorisation. Services downstream of the gateway can trust `X-User-Id`.  |
| **Gemini call is *inside* the violation-analysis service** | Keeps the LLM-specific concerns (prompt template, JSON parsing, retries) co-located with the case lifecycle that needs the answer.    |
| **Notification fan-out via RabbitMQ**                      | Decouples the synchronous user request (`/violations/analyze` returns once Gemini answers) from the asynchronous multi-channel delivery (which can take seconds for SMTP). |
| **Channels are pluggable**                                 | The notification service registers each channel only if its credentials are present, so a developer can run the stack locally with just in-app + email enabled. |

## What's not on this diagram

- The **pgAdmin** container — it's a development convenience, not part of the system architecture.
- The **cleanup job** inside the violation service — it's a `setInterval` inside the same process, not a separate container.
- The **Kubernetes** deployment — same logical containers, just with replica counts ≥ 1 and an Ingress in place of the local port mapping. Manifests live in [deployment/kubernetes/](../../deployment/kubernetes).
