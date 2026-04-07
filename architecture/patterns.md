# SnapPark Architecture Patterns

## Applied Architectural Patterns

This document outlines the design patterns used in the SnapPark system.

## Structural Patterns

### 1. Microservices Pattern
Breaks system into independently deployable services organized around business capabilities.

**Microservices in SnapPark:**
- Authentication Service
- Violation Analysis Service
- Notification Service

*Note: The API Gateway is an infrastructure component in the Access Layer, not a microservice. It does not own business logic or its own database.*

**Benefits:**
- Independent scaling and deployment
- Technology diversity (polyglot programming)
- Fault isolation
- Organizational alignment

---

### 2. API Gateway Pattern
Single entry point for client requests.

**Responsibilities:**
- Request routing
- Rate limiting
- Authentication/authorization delegation
- Response transformation
- Logging and monitoring

**Benefits:**
- Prevents direct access to internal services
- Centralized cross-cutting concerns
- Simplified client logic

---

### 3. Database per Service Pattern
Each microservice has exclusive data storage.

**Implementation:**
- User/Auth DB (Authentication Service)
- Case DB (Violation Analysis Service)
- Notifications DB (Notification Service)
- Audit DB (Event Sourcing)

**Benefits:**
- Data isolation and autonomy
- Technology flexibility
- Independent scaling

**Trade-offs:**
- Eventual consistency instead of ACID
- Complex queries across services
- Data synchronization challenges

---

## Behavioral Patterns

### 4. Service Discovery Pattern
Services locate each other at runtime through a service registry.

**Implementation:**
- Kubernetes DNS service discovery
- Service names: `service-name:port`
- Health checks for availability

**Benefits:**
- No hardcoded addresses
- Transparent scaling
- Automatic failover

---

### 5. Circuit Breaker Pattern
Prevents cascading failures when calling external services.

**States:**
- **Closed**: Normal operation, requests pass through
- **Open**: Recent failures detected, requests rejected immediately
- **Half-Open**: Testing if service recovered, limited requests allowed

**Use Cases in SnapPark:**
- Calls to Gemini API
- Inter-service communication
- Database connections

---

### 6. Pub/Sub (Publish-Subscribe) Pattern
Asynchronous event-driven communication between services.

**Components:**
- Event Publisher: Violation Analysis Service
- Message Broker: RabbitMQ
- Event Subscriber: Notification Service, Audit Logger

**Events:**
- CaseCreated
- AnalysisCompleted
- NotificationSent
- CaseClosed

**Benefits:**
- Loose coupling
- Resilience to failures
- Scalability

---

### 7. Event Sourcing Pattern
Store state changes as immutable sequence of events.

**Implementation:**
- Events stored in Audit/Event Database
- All state changes recorded as events
- Current state reconstructed by replaying events

**Events in SnapPark:**
```
CaseCreated(caseId, userId, timestamp)
AnalysisStarted(caseId, timestamp)
AnalysisCompleted(caseId, violation, confidence, timestamp)
NotificationSent(caseId, channel, status, timestamp)
CaseClosed(caseId, reason, timestamp)
```

**Benefits:**
- Complete audit trail
- Temporal queries ("state at time X")
- Debugging and troubleshooting
- Legal compliance

---

### 8. CQRS (Command Query Responsibility Segregation) Pattern
Separate models for writing and reading data.

**Current State:**
- Single model (write and read from same database)

**Future Implementation:**
- **Command Model**: Write operations (case creation, analysis)
- **Query Model**: Read operations (analytics, dashboards)
- Events drive updates to query model

**Benefits:**
- Independent scaling of read and write
- Optimized data structures
- Better handling of asymmetric workloads (high read, low write)

---

### 9. Saga Pattern
Distributed transaction management across services.

**Use Case Example: Complete Case Analysis**
```
1. Violation Analysis Service: Validate image
   ├─ Success → Step 2
   └─ Failure → Compensate: Return error to user

2. Violation Analysis Service: Call Gemini API
   ├─ Success → Step 3
   └─ Failure → Compensate: Delete pending case

3. Violation Analysis Service: Store case record in Case DB
   ├─ Success → Step 4
   └─ Failure → Compensate: Rollback analysis

4. Notification Service: Send notification (async via RabbitMQ)
   ├─ Success → Complete
   └─ Failure → Compensate: Event persists in broker for retry
```

**Pattern Type:**
- Choreography: Services listen for events and trigger next steps
- Orchestration: Central coordinator manages steps (not currently implemented)

---

### 10. Retry Pattern
Automatically retry failed operations with backoff.

**Implementation:**
- Exponential backoff strategy
- Max retry attempts: 3
- Initial delay: 1 second

**Formula:**
```
delay = initialDelay * (2 ^ attempt)
delay_1 = 1s
delay_2 = 2s
delay_3 = 4s
```

**Application:**
- Database connection failures
- External API calls (Gemini, Twilio)
- Message broker connections

---

### 11. Timeout Pattern
Prevent indefinite waits on slow/failing operations.

**Timeouts in SnapPark:**
- Gemini API call: 10 seconds
- Database query: 5 seconds
- HTTP request: 30 seconds
- Message broker: 5 seconds

---

## Communication Patterns

### 12. Synchronous (Request-Response)
Caller waits for response before proceeding.

**Used For:**
- API Gateway → Services
- User-facing operations
- Gemini API analysis

**Characteristics:**
- Simple, intuitive
- Tight coupling potential
- Latency sensitive

---

### 13. Asynchronous (Fire-and-Forget)
Caller publishes message and continues without waiting.

**Used For:**
- Case creation → Notifications
- Case updates → Audit logging
- Analytics updates

**Characteristics:**
- Loose coupling
- Better resilience
- Eventual consistency

---

## Reliability Patterns

### 14. Bulkhead Pattern
Isolate resources to prevent cascading failures.

**Implementation:**
- Separate thread pools per service
- Connection limits per service
- Message queue size limits

**Example:**
If Notification Service overwhelmed, only notification processing slows; analysis continues.

---

### 15. Health Check Pattern
Regularly verify service availability.

**Implementation:**
- `/health` endpoint on each service
- Kubernetes liveness and readiness probes
- Database connectivity checks

**Checks:**
```json
{
  "status": "UP",
  "timestamp": "2026-03-23T10:00:00Z",
  "services": {
    "database": "UP",
    "messagebroker": "UP"
  }
}
```

---

### 16. Graceful Degradation
Continue operation with reduced functionality.

**Scenarios:**
- Gemini API slow → Return cached results
- Notification Service down → Log for retry
- Database slow → Shorter query timeouts

---

## Security Patterns

### 17. Authentication Delegation
Central authentication service handles all verification.

**Flow:**
```
Client Request
    ↓
API Gateway
    ↓
Auth Service (verify JWT)
    ├─ Valid → Forward to service
    └─ Invalid → Reject with 401
```

---

### 18. Authorization (RBAC)
Role-based access control.

**Roles:**
- User: Submit cases, view own cases
- Authority: View all cases
- Admin: Manage system

---

### 19. Encryption in Transit
Secure communication over networks.

**Implementation:**
- HTTPS/TLS for all external communications
- mTLS between services (production)

---

## Deployment Patterns

### 20. Blue-Green Deployment
Run two identical production environments.

**Benefits:**
- Zero-downtime deployments
- Quick rollback capability

**Process:**
```
Current (Blue) → Testing (Green)
    ↓ Verification
Switch traffic: Blue → Green
    ↓ Rollback if needed
OLD Green becomes new Blue
```

---

### 21. Canary Deployment
Roll out changes to small user subset first.

**Stages:**
```
5% of traffic → Monitor for issues
50% of traffic → Gradual rollout
100% of traffic → Full deployment
```

---

### 22. Container Orchestration
Kubernetes manages container deployment and scaling.

**Features:**
- Automatic scaling based on load
- Self-healing (restart failed containers)
- Rolling updates
- Network policies

---

## Pattern Interaction Map

```
┌─ API Gateway (Access Layer) ─┐
│                              │
├─ Auth Service ────────┐
│                       ├─ Database per Service
├─ Analysis Service ────┤   (Pattern #3)
│                       │
└─ Notification Service ┤  ├─ Service Discovery
        │ (Async)       │  │   (Pattern #4)
        ↓               │  │
      Event Broker ─────┤  ├─ Circuit Breaker
        │ (Pub/Sub)     │  │   (Pattern #5)
        ├─ Notifications│  ├─ Pub/Sub
        └─ Event Store ─┤  │   (Pattern #6)
      (Event Sourcing)  │  ├─ Event Sourcing
                        │  │   (Pattern #7)
                        └──└─ [...more patterns]
```

---

## Design Principles

1. **Single Responsibility**: Each service has one reason to change
2. **Loose Coupling**: Services independent and interchangeable
3. **High Cohesion**: Related functionality grouped together
4. **Resilience**: Graceful handling of failures
5. **Scalability**: Independent scaling of services
6. **Observability**: Comprehensive logging and monitoring

