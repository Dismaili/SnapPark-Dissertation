# SnapPark - Project Overview

## 📋 Project Summary

SnapPark is a microservices-based system designed to intelligently detect and analyze illegal parking violations from user-submitted images. The system leverages Large Language Models (specifically Google Gemini API) to provide intelligent analysis and clear explanations.

## 🎯 Key Features

✅ **Image Upload & Submission** - Users upload suspected parking violation images
✅ **Intelligent Analysis** - AI-powered detection using Gemini LLM
✅ **User Authentication** - Secure login and token-based authorization
✅ **In-App Notifications** - Notification storage and retrieval via RabbitMQ
✅ **Independent Scaling** - Microservices architecture for flexibility
✅ **Event-Driven Architecture** - Asynchronous processing with RabbitMQ
🔲 **SMS Notifications** - Twilio integration for violation alerts (planned)
🔲 **Audit Trail** - Event sourcing for legal compliance (planned)

## 🏗️ Architecture

### Layers

```
┌─────────────────────────────────────────────────────┐
│                  Client Layer                       │
│              (Web Application)                      │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│                  Access Layer                       │
│     (API Gateway + Authentication)                  │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│              Core Service Layer                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ ├─ Authentication Service                    │  │
│  │ ├─ Violation Analysis Service                │  │
│  │ └─ Notification Service                      │  │
│  └───────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│              Messaging Layer                        │
│           (RabbitMQ Event Broker)                   │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│                 Data Layer                          │
│  ┌─────────────────────────────────────────────┐   │
│  │ ├─ User/Auth Database                       │   │
│  │ ├─ Case Database                            │   │
│  │ └─ Notifications Database                   │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
SnapPark-Dissertation/
│
├── 📚 docs/
│   ├── literature-review.md          # Academic foundations
│   ├── requirements.md                # Functional & non-functional specs
│   └── architecture/
│       ├── architectural-design.md   # Detailed system design
│       └── design-decisions.md       # ADRs (Architecture Decision Records)
│
├── 🏗️ services/
│   ├── api-gateway/                  # Entry point, routing, rate-limiting
│   ├── authentication-service/       # User auth & JWT token management
│   ├── violation-analysis-service/   # Image analysis coordination
│   └── notification-service/         # User notifications (in-app, SMS planned)
│
├── 🗄️ databases/
│   └── schema.md                     # SQL schemas for all databases
│
├── 🐳 deployment/
│   ├── docker-compose.yml           # Development environment
│   └── README.md                    # Deployment guide
│
├── 🏛️ architecture/
│   └── patterns.md                  # Design patterns reference
│
├── 🧪 tests/
│   └── TESTING_STRATEGY.md          # Testing approach & examples
│
├── README.md                        # Main project overview
├── PROJECT_ROADMAP.md              # Development phases
├── .env.example                     # Environment variables template
└── .gitignore                       # Git ignore rules
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL client tools (optional, for DB management)

### Development Setup

```bash
# Clone repository
git clone <repo-url>
cd SnapPark-Dissertation

# Copy environment config
cp .env.example .env

# Start all services
docker-compose up -d

# Check services
docker-compose ps
```

### Access Points

| Service | URL |
|---------|-----|
| API Gateway | http://localhost:3000 |
| RabbitMQ Admin | http://localhost:15672 |
| pgAdmin (DB UI) | http://localhost:5050 |

### First Steps

1. **Register User**
   ```bash
   curl -X POST http://localhost:3000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password123"}'
   ```

2. **Login**
   ```bash
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password123"}'
   ```

3. **Submit Image for Analysis**
   ```bash
   curl -X POST http://localhost:3000/violations/analyze \
     -H "Authorization: Bearer {token}" \
     -F "image=@parking-violation.jpg"
   ```

## 📚 Documentation

### Core Documentation
- [Literature Review](docs/literature-review.md) - Academic background and architectural justification
- [Requirements](docs/requirements.md) - 8 functional & 8 non-functional requirements
- [Architectural Design](docs/architecture/architectural-design.md) - Detailed system design
- [Design Decisions](docs/architecture/design-decisions.md) - Architecture Decision Records (ADRs)

### Implementation Guides
- [Deployment Guide](deployment/README.md) - Docker, Docker Compose, Kubernetes setup
- [Database Schemas](databases/schema.md) - SQL table definitions and relationships
- [Design Patterns](architecture/patterns.md) - Microservices patterns & principles
- [Testing Strategy](tests/TESTING_STRATEGY.md) - Unit, integration, and E2E testing

### Service Documentation
Each microservice has a detailed README:
- [API Gateway](services/api-gateway/README.md)
- [Authentication Service](services/authentication-service/README.md)
- [Violation Analysis Service](services/violation-analysis-service/README.md)
- [Notification Service](services/notification-service/README.md)

## 🔑 Key Technologies

### Backend Services
- **Runtime**: Node.js + Express.js
- **Language**: JavaScript (ES Modules)
- **AI Integration**: Google Gemini API

### Data & Persistence
- **Relational DB**: PostgreSQL
- **Message Broker**: RabbitMQ

### Infrastructure
- **Containerization**: Docker
- **Development**: Docker Compose
- **Database UI**: pgAdmin

## 🏛️ Design Principles

### Microservices
✅ Independent deployment and scaling
✅ Service-specific databases
✅ Failure isolation and resilience

### Event-Driven
✅ Asynchronous communication via RabbitMQ
✅ Loose coupling between services

### Domain-Driven Design
✅ Clear bounded contexts
✅ Business-logic-driven boundaries

## 📚 Documentation

See [PROJECT_ROADMAP.md](PROJECT_ROADMAP.md) for the full development roadmap and progress tracking.

## 🔒 Security

- ✅ JWT token-based authentication
- ✅ Database per service isolation
- ✅ Rate limiting at API Gateway

## 🌐 Deployment

### Development
```bash
docker-compose -f deployment/docker-compose.yml up -d
```

See [Deployment Guide](deployment/README.md) for detailed instructions.

---

**Last Updated**: April 2026
**Project Status**: Core services implemented, SMS notifications and testing in progress

