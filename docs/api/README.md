# SnapPark API Documentation

This directory contains the full HTTP API specification for the SnapPark
platform.

## Files

| File | Purpose |
|------|---------|
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.0 specification — single source of truth for every endpoint, request body, response shape and error code |
| [`README.md`](./README.md) | Human-readable overview (this file) |

## Viewing the spec

The OpenAPI file can be loaded into any standard tooling to produce an
interactive reference.

**Quickest option — Swagger UI in Docker:**

```bash
docker run -p 8080:8080 \
  -e SWAGGER_JSON=/openapi.yaml \
  -v $(pwd)/docs/api/openapi.yaml:/openapi.yaml \
  swaggerapi/swagger-ui
```

Then open http://localhost:8080.

**Other options:** Redocly, Stoplight Studio, the VS Code OpenAPI extension,
or simply pasting the file into https://editor.swagger.io.

## Surface overview

Three logical areas. Everything flows through the `api-gateway` (port 3000
in development, the cluster LoadBalancer/Ingress in production).

### Authentication

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/register` | Create an account and receive tokens |
| `POST` | `/auth/login` | Exchange credentials for tokens |
| `POST` | `/auth/refresh` | Rotate tokens |
| `POST` | `/auth/logout` | Revoke refresh token |

**Access tokens** live 15 minutes; **refresh tokens** live 7 days and are
rotated on every refresh (the old token is revoked). Store tokens in
memory on the client — never in `localStorage`.

### Violations

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/violations/analyze` | Upload up to 5 images for Gemini-backed analysis |
| `GET`  | `/violations/cases` | List cases (filter by user, status, date range) |
| `GET`  | `/violations/stats/:userId` | Aggregated stats for the user dashboard |
| `GET`  | `/violations/:id` | Full case detail including images |
| `GET`  | `/violations/:id/status` | Lightweight status poll |
| `PATCH`| `/violations/:id/report` | Report a confirmed violation |
| `PATCH`| `/violations/:id/resolve` | Mark a reported case as resolved |
| `DELETE`| `/violations/:id` | Cancel a pending case |
| `GET`  | `/violations/:id/audit` | Case audit trail |
| `GET`  | `/violations/audit/user/:userId` | User audit trail |

### Notifications

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/notifications` | List (filter by user, paginate) |
| `GET`  | `/notifications/:id` | Single notification |
| `GET`  | `/notifications/case/:caseId` | Notifications for a case |
| `PATCH`| `/notifications/:id/read` | Mark as read |
| `PATCH`| `/notifications/read-all/:userId` | Mark all as read |
| `GET`  | `/notifications/unread-count/:userId` | Badge counter for the UI |
| `GET`  | `/notifications/preferences/:userId` | Get channel preferences |
| `PUT`  | `/notifications/preferences/:userId` | Set channel preferences |
| `GET`  | `/notifications/delivery-log/:caseId` | Debug per-channel delivery |

## Case lifecycle

```
            ┌────────────┐
            │   analyze   │ POST /violations/analyze
            └─────┬──────┘
                  │
                  ▼
            ┌────────────┐
            │ completed  │  (AI verdict saved, CaseCreated event published)
            └─────┬──────┘
          ┌───────┴────────┐
          │                │
  DELETE  │                │  PATCH /report
          ▼                ▼
    ┌───────────┐    ┌─────────────────────┐
    │ cancelled │    │ reported_to_authority│
    └───────────┘    └─────────┬───────────┘
                               │  PATCH /resolve
                               ▼
                         ┌──────────┐
                         │ resolved │
                         └──────────┘
```

Every transition is persisted to the tamper-evident audit log (see NFR6 in
the requirements document) and publishes a domain event onto RabbitMQ so
the notification service can fan out alerts across the configured channels
(in-app, SMS, email, push).

## Authentication flow

```
1. Client  ──POST /auth/login──▶  Gateway ──▶ Auth Service
                                  ◀── tokens ──
2. Client stores {accessToken, refreshToken} in memory

3. Client  ──GET /violations/…──▶ Gateway
                Authorization: Bearer <accessToken>
           Gateway ──POST /auth/verify──▶ Auth Service
                   ◀── { valid, payload } ──
           Gateway injects X-User-Id ──▶ Violation Service
                                    ◀── response ──
           Gateway ──▶ Client

4. On 401 due to expired access token:
   Client ──POST /auth/refresh {refreshToken}──▶ Gateway → Auth
                  ◀── { token, refreshToken } ──
   Retry the original request with the new access token.
```

## Error model

Every error response has the shape:

```json
{ "error": "Human-readable message." }
```

Quality-filter rejections (`422`) carry additional fields:

```json
{
  "error": "Image 1: quality check failed.",
  "reason": "Image is too dark — brightness 18 below minimum 30.",
  "imageIndex": 0,
  "suggestion": "Please take a new photo ensuring the scene is well-lit…"
}
```

Status codes used across the API:

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Missing or malformed input |
| `401` | Missing / invalid / expired token |
| `403` | Authenticated but not the resource owner |
| `404` | Resource not found |
| `409` | Conflict with current state (e.g. cancelling a completed case) |
| `413` | Upload too large |
| `422` | Image failed quality pre-filter |
| `429` | Rate limit exceeded |
| `500` | Unhandled server error |
| `502` | Downstream service unavailable (gateway) |
| `503` | Authentication service unavailable (gateway) |

## Rate limiting

Applied at the gateway across all routes: **100 requests per 15 minutes**
per client by default (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`).
Standard `RateLimit-*` headers are returned on every response.

## Gateway coverage gap

The OpenAPI document marks every operation with `x-gateway-exposed: true |
false`. At the time of writing, the gateway proxies:

- All four `/auth/*` client routes
- `POST /violations/analyze`
- `GET  /violations/{id}`
- `GET  /violations/{id}/status`
- `DELETE /violations/{id}`

The following exist on their services but are **not yet reachable through
the gateway** — the frontend cannot consume them until a follow-up task
extends the gateway:

- `GET /violations/cases`
- `GET /violations/stats/{userId}`
- `PATCH /violations/{id}/report`
- `PATCH /violations/{id}/resolve`
- `GET /violations/{id}/audit`
- `GET /violations/audit/user/{userId}`
- All `/notifications/*` routes

This is the first backend task to complete before the React frontend work
begins.
