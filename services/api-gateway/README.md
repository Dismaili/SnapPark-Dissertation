# API Gateway Service

## Overview
Entry point for all client requests. Handles routing, authentication, and rate limiting.

## Responsibilities
- Route requests to appropriate microservices
- Enforce rate limiting
- Validate authentication via Authentication Service
- Transform requests/responses
- Log all API calls
- Handle errors and return standardized responses

## API Endpoints
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /violations/analyze` - Submit image for analysis
- `GET /violations/:id` - Get case details
- `DELETE /violations/:id` - Cancel analysis
- `GET /health` - Health check

## Environment Variables
```
PORT=3000
AUTH_SERVICE_URL=http://authentication-service:3001
VIOLATION_SERVICE_URL=http://violation-analysis-service:3002
RATE_LIMIT_WINDOW=15m
RATE_LIMIT_MAX_REQUESTS=100
```

## Dependencies
- Express.js
- dotenv
- axios (HTTP client)
- helmet (security)
- express-rate-limit

## Development
```bash
npm install
npm run dev
```

## Docker
```bash
docker build -t api-gateway:latest .
docker run -p 3000:3000 api-gateway:latest
```

