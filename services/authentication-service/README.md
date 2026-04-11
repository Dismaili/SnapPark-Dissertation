# Authentication Service

## Overview
Manages user identity and access control. This microservice is the sole owner of the User/Auth Database — no other service reads or writes to it (Database-per-Service pattern). The API Gateway contacts this service to verify tokens before routing requests to any other microservice.

## Responsibilities
- User registration
- User login and token generation
- Access token verification (called by API Gateway on every request)
- Token rotation via refresh tokens
- Logout (refresh token revocation)

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Liveness probe for Docker / Kubernetes |
| `POST` | `/auth/register` | Create new user account |
| `POST` | `/auth/login` | Authenticate user and return tokens |
| `POST` | `/auth/verify` | Verify access token (called internally by API Gateway) |
| `POST` | `/auth/refresh` | Exchange refresh token for new token pair (token rotation) |
| `POST` | `/auth/logout` | Revoke refresh token |

## Database Schema

```sql
-- Users table (in User/Auth Database)
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Refresh tokens table: supports token rotation and revocation
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens (token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
```

## Environment Variables
```
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auth_db
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=change-this-in-production
JWT_REFRESH_SECRET=change-this-refresh-in-production
TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
PASSWORD_SALT_ROUNDS=10
```

## Dependencies
- Express.js (web framework)
- jsonwebtoken (JWT access + refresh tokens)
- bcryptjs (password hashing)
- pg (PostgreSQL driver)
- helmet (security headers)
- cors (cross-origin requests)
- morgan (request logging)
- dotenv (environment variables)

## Running

### With Docker Compose (recommended)
```bash
docker compose up --build
```
This starts the service on port 3001 and a private PostgreSQL instance.

### Local development
```bash
npm install
npm run dev
```

## Security Notes
- Passwords hashed with bcrypt (10 salt rounds)
- Short-lived access tokens (15 minutes)
- Long-lived refresh tokens (7 days) with rotation — old token is deleted on each refresh
- User enumeration protection on login (same error for wrong email and wrong password)
- HTTPS required in production
