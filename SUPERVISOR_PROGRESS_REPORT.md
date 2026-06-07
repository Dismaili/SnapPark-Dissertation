# SnapPark — Supervisor Progress Report

**Student:** Dris Ismaili
**Supervisor:** Dr. Veloudis
**Programme:** BSc Computer Science, University of York Europe Campus (City College)
**Date:** 6 May 2026
**Repository branch reviewed:** `feature/frontend-web-app` (current), merged history through `develop`

---

## 1. Executive Summary

SnapPark is now an end-to-end working system: a citizen can register, verify their email, photograph an illegally parked vehicle on the web app, have the image automatically analysed by Gemini, see a case created, receive an email notification, and (if an admin) trigger a report to the relevant authority. The platform is built as **three microservices behind an API Gateway**, fully containerised with Docker Compose, with Kubernetes manifests prepared for cloud deployment.

The work spans four broad phases, all delivered:

1. **Architecture & foundations** (early April)
2. **Backend microservices + tests** (April)
3. **Deployment, API contract, documentation** (mid–late April)
4. **Web frontend, admin role, polish, dissertation write-up** (May)

A first dissertation draft (`DISSERTATION.md` / `DISSERTATION.pdf`) and a plain-English companion document (`DISSERTATION_EXPLAINED.md`) are committed.

---

## 2. System Architecture

SnapPark follows a microservices architecture with a single ingress point.

**Components**

- **API Gateway** — single entry point; handles routing, JWT auth middleware, rate limiting, header forwarding (`X-User-Role`), ownership guards with admin bypass.
- **Authentication Service** — registration, login, JWT issuance, email verification, first/last name fields, admin role support.
- **Violation Analysis Service** — image upload, image-quality pre-filter, Gemini-based illegal-parking detection, case lifecycle, multi-image support, per-image retrieval, audit log, auto-cleanup job, license plate + location storage.
- **Notification Service** — multi-channel dispatcher (email primary), per-event messages, unread-count endpoint, email preferences (auto-created on first use), uses license plate (not internal UUID) in user-facing messages.

**Cross-cutting**

- PostgreSQL (per-service schemas) — schemas committed under `databases/`.
- Event-driven flow between violation and notification services.
- Docker Compose orchestration of all services + dependencies.
- Kubernetes manifests for full-platform deployment (`deployment/`).

**Architecture artefacts in repo**

- `architecture/diagrams/` — C4 system context, container, and event-flow diagrams.
- `architecture/patterns.md` — pattern decisions.
- `docs/api/` — OpenAPI 3.0 spec + human-readable API reference.
- `docs/requirements.md`, `docs/literature-review.md`.

---

## 3. Chronological Delivery Log

### Phase 1 — Foundations (7–9 April)
- Initial project structure, database schemas, documentation skeleton.
- API Gateway service: routing, auth middleware, rate limiting.
- Authentication service with full test coverage.
- Notification service: multi-channel dispatch, multi-event consumption, per-event messages.
- Violation Analysis service: image quality pre-filter, case lifecycle.

### Phase 2 — Backend depth & testing (10–11 April)
- Multi-image support, auto-cleanup job, audit log.
- Unread notification count endpoint (UI badge support).
- Case filtering, pagination, user stats endpoint.
- Docker Compose orchestration of all services.
- Project roadmap and testing-strategy documents.
- Unit tests: image validator, Gemini integration, cleanup job, dispatcher, DB layer, channel abstraction.
- All services merged to `develop`.

### Phase 3 — Deployment & API contract (17–24 April)
- Kubernetes manifests for the full platform.
- OpenAPI 3.0 specification + human-readable API reference.
- API Gateway proxying completed across all violation and notification routes.

### Phase 4 — Frontend, admin, polish, write-up (30 April – 5 May)
- **Web frontend (Vite/React)** with login, upload, cases, notifications, settings.
- C4 architecture diagrams committed.
- E2E live-Gemini happy-path script + dissertation demo runbook.
- Gemini upgraded to `gemini-2.5-flash-lite`; better error logging; demo fallback for offline runs.
- Auth: first/last name, email verification flow, admin role.
- Violation: image bytes stored in DB with per-image retrieval endpoint.
- Notification: auto-creates email preferences; accepts snake_case fields.
- Gateway: forwards `X-User-Role`; admin bypass for ownership guards.
- Frontend: name fields on registration, email-verification feedback, admin panel with paginated all-cases view, responsive layout, Gemini branding removed, Google Maps location picker, license-plate field on upload.
- Notifications use license plate (not case UUID) for human readability.
- SMTP config + admin email env vars wired into docker-compose.
- Audit trail and report-to-authorities restricted to admin role.
- Landing page set as default route for all visitors.
- Dissertation report + plain-English explanation documents committed.

---

## 4. Functional Coverage vs. Original Requirements

| Requirement | Status |
|---|---|
| Citizen registration & login | ✅ Done (with email verification) |
| Photograph + upload illegal parking | ✅ Done (with location + plate) |
| Automated detection of violation | ✅ Done (Gemini 2.5 Flash Lite) |
| Case lifecycle & history per user | ✅ Done (filtering, pagination) |
| Notifications to citizen | ✅ Done (email channel live) |
| Authority workflow | ✅ Admin-role panel + report-to-authorities action |
| Audit trail | ✅ Done (admin-only) |
| Single user role (citizen) | ✅ Honoured; admin is an internal SnapPark staff role, not a separate "officer" account |
| Containerised deployment | ✅ Docker Compose + K8s manifests |
| Documented API | ✅ OpenAPI 3.0 + reference doc |
| Tested backend | ✅ Unit tests across services + E2E happy path |

---

## 5. Testing

- **Unit tests** for image validator, Gemini integration, cleanup job, notification dispatcher, DB layer, channel abstraction.
- **Auth service** full test coverage on initial commit.
- **End-to-end** live-Gemini happy-path script committed with a dissertation runbook (`tests/`).
- **Manual UI testing** across upload → case → notification flow.

---

## 6. Documentation Artefacts

- `DISSERTATION.md` / `.pdf` — first full dissertation draft.
- `DISSERTATION_EXPLAINED.md` / `.pdf` — plain-English companion.
- `README.md`, `GETTING_STARTED.md`, `PROJECT_ROADMAP.md`.
- `docs/requirements.md`, `docs/literature-review.md`.
- `docs/api/` — OpenAPI 3.0 + reference.
- `architecture/diagrams/` — C4 diagrams.

---

## 7. Outstanding Work / Open Questions

**Engineering**
- Hosted public demo (currently runs locally / on K8s manifests not yet deployed to a live cluster).
- Broader integration test suite beyond the happy path.
- Accessibility audit of the web app.

**Dissertation**
- Evaluation chapter — define methodology (functional walkthrough, performance of Gemini classifier, comparison against baseline?).
- Decide which components to expand in the implementation chapter vs. appendix.

**Questions for Dr. Veloudis**
1. Is the current admin-role panel sufficient as the "authority workflow," or does he want a separate authority portal demo?
2. How rigorous does he want the evaluation to be — qualitative walkthrough, or quantitative classifier metrics?
3. Preference on demo format for the viva (live demo vs. recorded vs. screenshots in slides)?
4. Any required structural changes to the dissertation draft before final submission?

---

## 8. Demo Plan (for the meeting if time allows)

1. Register a new citizen account → receive verification email.
2. Log in, upload a parking-violation photo with location + plate.
3. Show the case being created and the email notification arriving.
4. Switch to admin account → show admin panel, audit trail, report-to-authorities action.
5. Walk through the C4 diagrams and the OpenAPI spec.
