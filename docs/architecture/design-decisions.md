# Architecture Design Decisions

This document records key architectural decisions and their rationale.

## D1: Microservices Architecture

**Decision**: Adopt microservices architecture instead of monolithic or SOA.

**Rationale**:
- **Monolithic Rejection**: Monoliths don't support the granular, decentralized deployment required for Cloud Continuum [Lit Review]. A single monolith would create a system unable to deploy image processing at the edge while keeping databases in the cloud.
- **SOA Rejection**: SOA's Enterprise Service Bus creates a bottleneck and SOAP's complexity is unsuitable for modern real-time applications [Lit Review]. Service interdependencies through ESB reduce system resilience.
- **Microservices Selection**: 
  - Enables independent deployment and scaling
  - Supports Cloud Continuum distribution
  - Provides better fault isolation
  - Supports polyglot programming if needed (all services currently use Node.js, but individual services could be rewritten in other languages without affecting the rest of the system)
  - Aligns with organization structure (Dev teams → Services)

**Trade-offs**:
- ✅ Scalability, flexibility, resilience
- ❌ Added complexity, distributed tracing requirements, eventual consistency

**References**: [Lit Review - Choice of Architecture]

---

## D2: API Gateway Pattern

**Decision**: Use API Gateway as the single entry point for all client requests.

**Rationale**:
- Centralized routing and rate limiting
- Unified authentication enforcement
- Single point for cross-cutting concerns (logging, metrics)
- Simplifies client implementations
- Enables version management for APIs

**Implementation**:
- Express.js for gateway implementation
- All requests must pass through gateway
- Gateway verifies authentication with Authentication Service
- Rejects invalid requests before reaching core services

**Security Benefit**: No service is directly exposed to client traffic; all access controlled at gateway.

**Trade-offs**:
- ✅ Security, centralized control, simplified client interface
- ❌ Single point of failure (mitigated through redundancy), potential bottleneck (addressed via load balancing)

---

## D3: Database per Service Pattern

**Decision**: Each microservice owns its dedicated database. No shared databases between services.

**Rationale**:
- **Data Isolation**: Prevents unintended data coupling between services
- **Independence**: Services can evolve schemas independently
- **Polyglot Persistence**: Each service can use the best database technology for its use case
- **Scaling**: Databases scale independently with services
- **Consistency Model**: Enables intentional choice of consistency (strong vs. eventual)

**Service Databases**:
1. **User/Auth Database** (Authentication Service): PostgreSQL for structured user data
2. **Case Database** (Violation Analysis Service): PostgreSQL for case data
3. **Audit/Event Database** (Event Sourcing): PostgreSQL append-only store

**Implications**:
- Cross-service data queries require asynchronous event consumption or API calls
- Eventual consistency model instead of ACID transactions across services
- Requires careful data ownership boundaries

**References**: [Lit Review - Database per Service Pattern]

---

## D4: Event Sourcing and Asynchronous Communication

**Decision**: Use Event Sourcing for the audit layer and asynchronous Pub/Sub for service communication.

**Rationale**:

### Event Sourcing Benefits:
- **Complete Audit Trail**: Immutable record of all state changes
- **Legal Compliance**: Tamper-proof history for parking violation evidence
- **Debugging**: Can replay events to understand system state at any point
- **Audit Requirements**: Satisfies non-functional requirement for auditability

### Asynchronous (Pub/Sub) Benefits:
- **Decoupling**: Services don't need to know about each other
- **Resilience**: Message broker queues events if subscriber is temporarily down
- **Scalability**: Services can independently scale based on volume
- **Non-blocking**: Notification delays don't impact user experience

**Implementation**:
- RabbitMQ as message broker
- Services publish domain events (CaseCreated, AnalysisCompleted)
- Notification Service subscribes asynchronously
- Event Broker Data Layer Writer persists events to Audit Database

**Use Cases in SnapPark**:
- User submits image → ViolationAnalysisService analyzes → publishes `AnalysisCompleted` event
- `AnalysisCompleted` event triggers:
  - NotificationService sends SMS/push
  - AuditService records event in Event Database
  - AnalyticsService (future) updates statistics
  - All independently and without blocking

**References**: [Lit Review - Event Sourcing, CQRS, Saga Pattern]

---

## D5: Synchronous LLM Integration

**Decision**: Violation Analysis Service calls Gemini API synchronously and waits for response.

**Rationale**:
- **User Expectation**: Users expect immediate analysis results (analysis usually completes < 2 seconds)
- **Tight Coupling Acceptable**: External API is not our system boundary; not coupling internal services
- **Simple Pattern**: Request-response pattern is straightforward and well-understood
- **Essential for Flow**: Cannot proceed with case creation until AI analysis is complete

**Trade-offs**:
- ✅ Predictable user experience, simpler implementation, reliable sequencing
- ❌ Latency in API response blocks user; requires robust error handling and timeouts

**Mitigation**:
- Gemini API timeout: 10 seconds
- Retry logic with exponential backoff (max 3 retries)
- Graceful error message if API fails
- Future: Could cache results for identical images

---

## D6: Asynchronous Notification Delivery

**Decision**: Notification Service operates asynchronously, decoupled from the main analysis pipeline.

**Rationale**:
- **Pipeline Independence**: If notification service crashes, core analysis still completes and user sees results
- **Resilience**: Events persist in broker; notifications delivered when service recovers
- **Scalability**: Notification volume doesn't impact image analysis performance
- **User Experience**: Users don't wait for notification delivery; they see analysis immediately

**Implementation**:
- Case Management publishes `CaseCreated` event
- Notification Service subscribes
- Service can be down, restarted, or scaled independently
- Message broker persists events

**Consequences**:
- Notifications may be delayed (eventually delivered)
- Must handle duplicate dispatching (idempotent operations)
- Cleaner separation of concerns

---

## D7: Cloud Continuum Deployment

**Decision**: Architecture supports deployment across cloud and edge nodes.

**Rationale**:
- **User Latency**: Image preprocessing at edge device is faster than cloud round-trip
- **Future Extensibility**: Can deploy preprocessing services closer to data sources
- **Bandwidth Optimization**: Reduce cloud bandwidth by processing locally
- **Compliance**: Some data processing may need to occur locally

**Deployment Options**:
- **Cloud**: Central databases, Gemini API coordination, audit logging
- **Edge**: Image validation, basic preprocessing, notification delivery
- **Client**: Image capture, UI rendering

**Current Implementation**: 
- All services in cloud
- Future: Image preprocessing service deployable to edge

**References**: [Lit Review - Cloud Continuum, Microservices are optimal in Cloud Continuum]

---

## D8: DDD Bounded Contexts

**Decision**: Services boundaries based on business domains, not technical layers.

**Rationale**:
- **Service Cohesion**: Each service represents a clear business capability
- **Ubiquitous Language**: Developers and stakeholders use same terminology within services
- **Avoiding Distributed Monolith**: Prevents tight coupling through shared concepts

**Identified Bounded Contexts**:

1. **Authentication Context**
   - Concepts: User, Credentials, Token, Session
   - Responsible for: Identity and access management
   
2. **Violation Analysis Context**
   - Concepts: Case, Image, Analysis, Violation
   - Responsible for: Image analysis coordination and results
   
3. **Notification Context**
   - Concepts: Notification, Channel, Recipient, Status
   - Responsible for: User communication
   
4. **Audit Context**
   - Concepts: Event, Timestamp, State, History
   - Responsible for: Compliance and system history

**Ubiquitous Language Examples**:
- "User" in Auth Context ≠ "User" in Audit Context
- Auth User: credentials, login history
- Audit User: entity performing actions, identifiable in event timestamps

**References**: [Lit Review - Domain-Driven Design]

---

## D9: Service Discovery

**Decision**: Use service discovery for runtime location of services.

**Rationale**:
- **Dynamic Deployment**: Services restart or relocate without manual configuration
- **Kubernetes Native**: Service DNS names resolve automatically
- **Scalability**: New service replicas register automatically
- **Reliability**: Load balancers route to healthy instances

**Implementation**:
- Kubernetes Service objects for service discovery
- DNS names: `authentication-service`, `violation-analysis-service`, etc.
- Health checks determine service availability
- Automatic deregistration of failed instances

**Benefits**:
- No hardcoded IP addresses
- Transparent service scaling
- Automatic failover

**References**: [Lit Review - Service Discovery]

---

## D10: CQRS Pattern (Future Consideration)

**Decision**: Prepare for CQRS implementation for analytics and reporting.

**Rationale**:
- **Unbalanced Load**: Many users query parking data (high read) vs. few create cases (low write)
- **Independent Scaling**: Read database can scale without affecting write database
- **Event Sourcing Integration**: Events naturally feed read models

**Current State**: 
- Single database model
- Future: Separate command model (case creation) from query model (analytics/reporting)

**Future Implementation**:
- Case Database: Write model (cases, analysis results)
- Analytics Database: Read model (aggregations, statistics, trends)
- Events drive updates to read model

**References**: [Lit Review - CQRS Pattern]

---

## D11: Containerization and Orchestration

**Decision**: Use Docker for containerization and Kubernetes for production orchestration.

**Rationale**:
- **Consistency**: Same environment from development to production
- **Scalability**: Kubernetes manages service replication and scaling
- **Reliability**: Automatic restart of failed containers
- **Version Control**: Docker images versioned alongside code
- **Infrastructure Independence**: Run on any cloud provider or on-premises

**Development**: Docker Compose for local development
**Production**: Kubernetes for orchestration and scaling

**Deployment Pipeline**:
1. Build Docker image
2. Push to registry
3. Kubernetes pulls and deploys
4. Health checks monitor service

**References**: [Lit Review - Docker, Kubernetes]

---

## Summary of Key Trade-offs

| Decision | Benefit | Cost | Mitigation |
|----------|---------|------|-----------|
| Microservices | Scalability, flexibility, resilience | Complexity, distributed tracing | Service mesh, centralized logging |
| API Gateway | Security, control, simplified clients | Single point of failure | Redundancy, load balancing |
| Database per Service | Independence, polyglot persistence | Eventual consistency, complex queries | Event sourcing, async APIs |
| Event Sourcing | Complete audit trail, debugging | Storage overhead, complexity | Selective event logging |
| Async Notifications | Resilience, scalability | Eventual consistency | Clear user expectations |
| Sync LLM Calls | Predictable UX, simple logic | User latency on API delays | Timeouts, retries, error handling |

---

## Decision Timeline

- **Phase 1**: Microservices, API Gateway, Database per Service, DDD
- **Phase 2**: Event Sourcing, Async Notifications
- **Phase 3**: Service Discovery, Container Orchestration
- **Phase 4**: CQRS (future expansion for analytics)
- **Phase 5**: Service Mesh and advanced observability

