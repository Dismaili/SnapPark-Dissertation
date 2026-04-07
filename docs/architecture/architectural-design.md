# Architectural Design

## System Overview

SnapPark is built using a microservices architecture aligned with the Cloud Continuum model. This design enables independent scaling, high availability, and deployment flexibility across cloud and edge infrastructure.

## Architectural Layers

### 1. Client Layer

**Entry Point**: Web Client Application

The client layer provides the user interface where visitors:
- Upload suspected parking violation images
- Receive analysis results
- View case history
- Manage notifications

**Responsibilities:**
- Image capture/selection
- Form validation (client-side)
- Result presentation
- User authentication flow

### 2. Access Layer

**Key Components**: API Gateway, Authentication Service

This layer acts as the front door to the system:

#### API Gateway
- **Routing**: Directs requests to appropriate microservices
- **Rate Limiting**: Prevents abuse and ensures fair resource usage
- **Request Forwarding**: Manages request/response transformation
- **Error Handling**: Standardizes error responses

#### Authentication Service
- **User Verification**: Validates user tokens on every request
- **Token Management**: Issues and manages JWT/session tokens
- **Access Control**: Ensures only authenticated users proceed
- **Security**: Rejects invalid requests immediately

**Flow**: Client Request → API Gateway → Authentication Service Verification → Service Layer or Rejection

### 3. Core Service Layer

Three independent microservices handle the primary business logic:

#### A. Authentication Service
**Responsibilities:**
- User registration and login
- Token generation and validation
- User credential management
- Password management and reset

**Data Store**: User/Auth Database (exclusive)
- No other service accesses this data
- Stores only user credentials and authentication metadata

**Communication**: 
- Called synchronously by API Gateway
- Does not interact directly with other services

#### B. Violation Analysis Service
**Responsibilities:**
- Coordinates with external LLM (Gemini AI)
- Image preprocessing and validation
- Prompt engineering for AI analysis
- Response parsing and structuring
- Analysis result preparation

**External Integration**: 
- Calls Google Gemini API synchronously
- Waits for AI response before proceeding
- Synchronous communication justified by user's need for immediate feedback

**Data Store**: Case Database
- Stores case information and analysis results
- Stores image metadata
- Records case status and lifecycle

**Workflow:**
1. Receives validated image from API Gateway
2. Prepares structured prompt
3. Sends to Gemini API
4. Receives analysis response
5. Structures results
6. Publishes AnalysisCompleted event to message broker

#### C. Notification Service
**Responsibilities:**
- Subscribes to CaseCreated events from message broker
- Sends notifications when cases are created
- Manages notification delivery channels
- Tracks delivery status

**Communication Pattern**: 
- Asynchronous pub/sub model
- Listens to event broker
- Independent operation - can crash without affecting core pipeline
- Events persist in broker until service recovers

**Notification Channels:**
- In-app notifications (implemented)
- SMS to vehicle owner/authority (planned — Twilio)
- Email notifications (planned)
- Push notifications (planned)

**Advantage of Async Approach:**
- Core analysis pipeline continues if notification service fails
- Users receive analysis results immediately
- Notification delivery decoupled from analysis processing
- Service can be scaled independently based on notification volume

### 4. Messaging Layer

**Event Broker**: RabbitMQ (at runtime)

**Purposes:**
1. **Event Distribution**: Routes events from producers to subscribers
2. **Decoupling**: Services don't need to know about each other
3. **Reliability**: Messages persist during service downtime
4. **Scalability**: Handles high event volumes

**Event Types:**
- `CaseCreated`: New violation case submitted
- `AnalysisCompleted`: AI analysis finished
- `NotificationSent`: Notification delivery confirmed
- `CaseClosed`: Case resolved or archived

**Architecture:**
- Event producers publish to broker
- Subscribers listen for events of interest
- Messages queue if subscriber is temporarily unavailable
- Enables async workflows and service independence

### 5. Data Layer

Follows Database per Service pattern for data isolation and flexibility.

#### User/Auth Database
- **Owner**: Authentication Service (exclusive)
- **Contains**: User credentials, authentication tokens, user profile data
- **Schema**: Users table, Sessions table, Password history table
- **Access**: Only Authentication Service has read/write access
- **Technology**: PostgreSQL

#### Case Database
- **Owner**: Violation Analysis Service
- **Contains**: Cases, analysis results, image metadata, case status
- **Schema**: Cases table, Analysis results table, Images table, Case status log
- **Access**: Read-only access for reporting/analytics services (via events)
- **Technology**: PostgreSQL

#### Audit/Event Database (Planned)
- **Owner**: Event Sourcing system
- **Contains**: Complete immutable event history
- **Schema**: Events table (event_type, case_id, timestamp, data, metadata)
- **Purpose**:
  - Legal compliance and audit trails
  - Ability to reconstruct system state at any point in time
  - Tamper-proof record of all state changes
- **Technology**: PostgreSQL with append-only guarantees
- **Status**: Not yet implemented — database container exists in Docker Compose but no service writes to it

## Data Flow

### Happy Path: Successful Analysis

```
1. Client/UI
   └── Upload Image
       └── API Gateway (route + rate limit)
           └── Authentication Service (verify token)
               └── Violation Analysis Service
                   ├── Validate image
                   └── Call Gemini API (synchronous)
                       └── Receive analysis
                           └── Publish AnalysisCompleted event
                               └── Event Broker
                                   ├── Notification Service (subscribes)
                                   │   └── Send SMS/Push notification
                                   └── Audit/Event Database Writer
                                       └── Persist event (Event Sourcing)
2. Response returned to user: Analysis + Explanation + Status
```

### Key Characteristics:

- **Synchronous Path**: User request → API Gateway → Auth → Analysis → Gemini API → Response
- **Asynchronous Path**: Case Creation → Event Broker → Notifications + Audit Storage
- **Hybrid Approach**: 
  - Fast user response (synchronous analysis)
  - Resilient background operations (asynchronous notifications)
  - Full audit trail maintained (event sourcing)

## Design Patterns Applied

### Microservices Patterns
- **Database per Service**: Each service owns its data
- **API Gateway**: Single entry point for client requests
- **Service Discovery**: Services locate each other at runtime
- **Circuit Breaker**: Prevents cascading failures in service calls

### Data Patterns
- **Event Sourcing**: Complete immutable event history
- **CQRS**: Command model (analysis writes) vs. Query model (read analytics)
- **Saga Pattern**: Coordinate distributed transactions across services

### Communication Patterns
- **Synchronous**: REST/gRPC for immediate request-response
- **Asynchronous**: Pub/Sub for event-driven workflows
- **Message Broker**: RabbitMQ for reliable event distribution

### Reliability Patterns
- **Health Checks**: Regular service health monitoring
- **Retry Logic**: Automatic retry with exponential backoff
- **Timeout Management**: Prevent hanging requests
- **Graceful Degradation**: Service continues with reduced functionality

## Deployment Strategy

### Container-Based
- Docker containers for consistent environments
- Each service in its own container
- Easy to replicate and scale

### Orchestration
- Kubernetes for production deployment
- Docker Compose for development
- Service mesh considerations for advanced routing

### Cloud Continuum
- **Cloud**: Central databases, compute-intensive operations (Gemini API calls)
- **Edge**: Image preprocessing, notification delivery
- **Client**: UI rendering, image capture

## Security Architecture

### Authentication & Authorization
- JWT token-based authentication
- Role-based access control (RBAC)
- Per-service authorization policies

### Data Protection
- Encryption in transit (TLS/HTTPS)
- Encryption at rest for sensitive data
- Secrets management (API keys, credentials)

### Isolation
- Network policies between services
- Service-to-service authentication (mTLS in production)
- Database access restrictions

### Compliance
- GDPR compliance for user data
- Audit trail for all state changes
- Data retention policies

## Scalability Considerations

### Independent Scaling
- Violation Analysis Service: Scale based on image processing load
- Notification Service: Scale based on event volume
- Authentication Service: Scale based on login/token verification load

### Load Balancing
- Horizontal pod autoscaling in Kubernetes
- Round-robin distribution of requests
- Sticky sessions for stateful components

### Performance Optimization
- Caching strategies for frequent queries
- Batch processing for bulk operations
- Connection pooling for database connections
- CDN for static assets and images

## Future Extensions

The event-driven architecture supports:
- New notification channels without service modifications
- Analytics and reporting services consuming events
- Machine learning pipeline for model improvement
- Advanced monitoring and observability tools
- Real-time dashboards for authorities

