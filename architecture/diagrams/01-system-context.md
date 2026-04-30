# System Context Diagram (C4 — Level 1)

**Audience:** the dissertation reader who has never seen the system before.
**Question it answers:** *what does SnapPark do, who uses it, and what does it talk to?*

It deliberately hides every internal detail (services, queues, databases) —
those belong on Level 2 (the [container diagram](02-container.md)).

```mermaid
%%{init: {"flowchart": {"htmlLabels": true, "curve": "basis"}, "theme": "base", "themeVariables": {"primaryColor": "#ecfdf5", "primaryBorderColor": "#059669", "primaryTextColor": "#064e3b", "lineColor": "#475569"}}}%%
flowchart TB
    citizen(["<b>Citizen</b><br/><i>[Person]</i><br/>Submits photos of suspected<br/>illegal parking and tracks<br/>the resulting cases."])

    snappark["<b>SnapPark</b><br/><i>[Software System]</i><br/>Analyses parking photos with<br/>an LLM, manages case lifecycles,<br/>and notifies citizens of outcomes."]

    authority(["<b>Local Authority</b><br/><i>[External actor]</i><br/>Receives reported violations<br/>via email / future API<br/>integration."])

    gemini["<b>Google Gemini API</b><br/><i>[External system]</i><br/>Multimodal LLM that decides<br/>whether the submitted image<br/>shows a parking violation."]

    smtp["<b>SMTP provider (Gmail)</b><br/><i>[External system]</i><br/>Delivers email notifications."]
    twilio["<b>Twilio</b><br/><i>[External system]</i><br/>Delivers SMS notifications."]
    fcm["<b>Firebase Cloud Messaging</b><br/><i>[External system]</i><br/>Delivers push notifications<br/>to mobile devices."]

    citizen -- "Uploads images,<br/>views verdicts &amp; status<br/>[HTTPS]" --> snappark
    snappark -- "Sends in-app, email,<br/>SMS and push alerts" --> citizen

    snappark -- "Sends image + prompt,<br/>receives JSON verdict<br/>[HTTPS]" --> gemini
    snappark -- "Sends email body<br/>[SMTP/TLS]" --> smtp
    snappark -- "Sends SMS payload<br/>[HTTPS]" --> twilio
    snappark -- "Sends push payload<br/>[HTTPS]" --> fcm

    snappark -. "Forwards confirmed<br/>cases (currently via<br/>email — future direct API)" .-> authority

    classDef person fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef system fill:#ecfdf5,stroke:#059669,color:#064e3b
    classDef external fill:#fef3c7,stroke:#b45309,color:#78350f

    class citizen,authority person
    class snappark system
    class gemini,smtp,twilio,fcm external
```

## Reading the diagram

- **Solid arrows** are synchronous, request/response interactions today.
- **Dashed arrow** to *Local Authority* indicates the planned future
  integration; in the current implementation, "reporting to authority" is a
  state transition recorded in the database and an outbound email — not yet
  a direct API call.
- The four external systems (Gemini, SMTP, Twilio, FCM) all sit at the
  edge of the trust boundary. Credentials for each are kept in
  `deployment/.env` and never reach the frontend.

## Trust boundary

Everything inside the **SnapPark** box runs in our own infrastructure
(Docker Compose locally, Kubernetes in production). Everything outside is a
third-party dependency we cannot see or control.

This separation matters for the dissertation discussion of:

- **Scalability**: we scale the inner boxes; we cannot scale Gemini.
- **Reliability**: every outbound integration is wrapped in a circuit-breaker
  pattern (the multi-channel notifier uses `Promise.allSettled` so one bad
  channel never blocks the others).
- **Privacy**: only image bytes leave our boundary, and only to Gemini —
  never to a notification channel.
