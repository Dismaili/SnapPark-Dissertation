# Deployment Configuration

## Quick Start

### Development with Docker Compose
```bash
docker-compose up -d
```

This starts:
- API Gateway (port 3000)
- Authentication Service (port 3001)
- Violation Analysis Service (port 3002)
- Notification Service (port 3004)
- PostgreSQL databases
- RabbitMQ message broker
- pgAdmin (database UI on port 5050)

### Environment Setup
```bash
# Copy template
cp .env.example .env

# Update with your credentials
nano .env
```

## Services and Ports

| Service | Port | Database |
|---------|------|----------|
| API Gateway | 3000 | - |
| Authentication | 3001 | auth_db |
| Violation Analysis | 3002 | case_db |
| Notification | 3004 | notifications_db |
| RabbitMQ | 5672 | - |
| RabbitMQ Admin | 15672 | - |
| PostgreSQL (Auth) | 5432 | - |
| PostgreSQL (Case) | 5433 | - |
| PostgreSQL (Notifications) | 5434 | - |
| PostgreSQL (Audit) | 5435 | - |
| pgAdmin | 5050 | - |

## File Structure

```
deployment/
├── docker-compose.yml        # Development multi-container setup
├── kubernetes/
│   ├── namespace.yaml        # Kubernetes namespace
│   ├── api-gateway.yaml      # API Gateway deployment
│   ├── auth-service.yaml     # Authentication service
│   ├── violation-service.yaml # Violation analysis service
│   ├── notification-service.yaml # Notification service
│   ├── rabbitmq.yaml         # RabbitMQ StatefulSet
│   ├── postgres.yaml         # PostgreSQL StatefulSet
│   ├── services/             # Kubernetes Service definitions
│   ├── configmaps/           # Configuration management
│   └── secrets/              # Secrets management (gitignored)
└── config/
    ├── env.development       # Development environment
    ├── env.staging           # Staging environment
    └── env.production        # Production environment
```

## Docker Compose Usage

### Start Services
```bash
docker-compose up -d
```

### View Logs
```bash
# All logs
docker-compose logs -f

# Specific service
docker-compose logs -f api-gateway
```

### Stop Services
```bash
docker-compose down
```

### Database Access
```bash
# Connect to auth database
docker-compose exec postgres_auth psql -U snappark_user -d snappark_auth

# Or use pgAdmin at http://localhost:5050
```

### RabbitMQ Management
- URL: http://localhost:15672
- Username: guest
- Password: guest

## Kubernetes Deployment

### Prerequisites
- kubectl configured
- Docker images pushed to registry

### Deploy
```bash
# Create namespace
kubectl apply -f kubernetes/namespace.yaml

# Deploy services (order matters)
kubectl apply -f kubernetes/postgres.yaml
kubectl apply -f kubernetes/rabbitmq.yaml
kubectl apply -f kubernetes/api-gateway.yaml
kubectl apply -f kubernetes/auth-service.yaml
kubectl apply -f kubernetes/violation-service.yaml
kubectl apply -f kubernetes/notification-service.yaml
```

### Monitor Deployment
```bash
# Watch deployments
kubectl get deployments -n snappark -w

# View pod status
kubectl get pods -n snappark

# View service status
kubectl get svc -n snappark

# View logs
kubectl logs -f deployment/api-gateway -n snappark

# Port forwarding (access locally)
kubectl port-forward svc/api-gateway 3000:3000 -n snappark
```

## Database Initialization

### Create Databases
```bash
# Enter postgres container
docker-compose exec postgres_auth psql -U postgres

# Create databases
CREATE DATABASE snappark_auth;
CREATE DATABASE snappark_case;
CREATE DATABASE snappark_notifications;
CREATE DATABASE snappark_audit;
```

### Run Migrations
```bash
# From each service directory
cd services/authentication-service
npm run migrate

cd ../violation-analysis-service
npm run migrate

cd ../notification-service
npm run migrate
```

## Environment Variables

### API Gateway (.env)
```
PORT=3000
AUTH_SERVICE_URL=http://authentication-service:3001
VIOLATION_SERVICE_URL=http://violation-analysis-service:3002
RATE_LIMIT_WINDOW=15m
RATE_LIMIT_MAX_REQUESTS=100
```

### Services (.env)
```
# Common
NODE_ENV=development
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://user:password@host:port/database
AUDIT_DB_URL=postgresql://user:password@audit-host:port/database

# Message Broker
MESSAGE_BROKER_URL=amqp://guest:guest@rabbitmq:5672

# External APIs
GEMINI_API_KEY=your-api-key
TWILIO_ACCOUNT_SID=your-account
TWILIO_AUTH_TOKEN=your-token

# Security
JWT_SECRET=your-secret-key
TOKEN_EXPIRY=15m
```

## Health Checks

Each service provides a `/health` endpoint:
```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
# etc...
```

## Scaling

### Docker Compose
```bash
# Scale service (e.g., 3 instances)
docker-compose up -d --scale notification-service=3
```

### Kubernetes
```bash
# Scale deployment
kubectl scale deployment notification-service --replicas=3 -n snappark

# Or edit deployment
kubectl edit deployment notification-service -n snappark
```

## Monitoring

### Logs
```bash
# Docker
docker-compose logs -f service-name

# Kubernetes
kubectl logs -f pod-name -n snappark
```

### Resource Usage
```bash
# Kubernetes
kubectl top nodes
kubectl top pods -n snappark
```

## Troubleshooting

### Service Not Responding
```bash
# Check service status
docker-compose ps

# Check logs
docker-compose logs service-name

# Restart service
docker-compose restart service-name
```

### Database Connection Issues
```bash
# Test connection
docker-compose exec postgres_auth psql -h postgres_auth -U snappark_user -d snappark_auth

# Check DB logs
docker-compose logs postgres_auth
```

### RabbitMQ Connection Issues
```bash
# Check RabbitMQ status
docker-compose logs rabbitmq

# Access admin console
# http://localhost:15672
```

