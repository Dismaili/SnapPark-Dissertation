# SnapPark Frontend

Web application for the SnapPark parking-violation reporting system.
Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, and TanStack Query.

## Pages

| Route               | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `/`                 | Landing page (auto-redirects authenticated users to `/dashboard`)  |
| `/login`            | Email + password login                                             |
| `/register`         | New citizen account                                                |
| `/dashboard`        | List of the user's cases, with stats and pagination                |
| `/upload`           | Image upload + Gemini analysis with live verdict preview           |
| `/cases/[id]`       | Case detail: AI explanation, audit trail, lifecycle actions        |
| `/notifications`    | Notifications inbox with mark-read controls                        |
| `/settings`         | Notification preferences (in-app / email / SMS / push)             |

All authenticated pages share a sidebar layout in `src/app/(app)/layout.tsx`.

## Architecture

- **API client:** `src/lib/api.ts` — fetch wrapper that injects the JWT and handles `multipart/form-data` for image uploads.
- **Auth:** `src/lib/auth.ts` — token + user profile stored in `localStorage`. Guard via `useAuthGuard` in `DashboardNav.tsx`.
- **Server state:** TanStack Query for caching, refetching, and unread-badge polling.
- **Types:** `src/lib/types.ts` mirrors the response shapes from the API Gateway.

The frontend talks **only** to the API Gateway (default `http://localhost:3000`). It never reaches services directly.

## Development

```bash
# Install
npm install

# Configure
cp .env.local.example .env.local       # NEXT_PUBLIC_API_URL=http://localhost:3000

# Bring the backend up first (from project root)
docker compose -f deployment/docker-compose.yml --env-file deployment/.env up -d

# Run the dev server
npm run dev          # http://localhost:3001 (Next will pick a free port)
```

## Production build

```bash
npm run build
npm run start
```

## Notes

- The Gateway sits on port **3000**; this app defaults to **3001** in dev.
- Image upload limit is **10 MB**; allowed types: JPEG, PNG, WebP. The Gateway and Violation Service enforce the same constraints.
- The unread-badge in the sidebar polls `/notifications/unread-count/:userId` every 30 s.
