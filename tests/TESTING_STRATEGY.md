# Testing Strategy for SnapPark

## Overview

SnapPark uses a comprehensive testing strategy covering unit tests, integration tests, and end-to-end tests.

## Testing Pyramid

```
           /\
          /  \
         / E2E \          End-to-End Tests
        /______\         (5-10%)
       /        \
      / Integration \    Integration Tests
     /____________\   (15-25%)
    /              \
   /   Unit Tests   \   Unit Tests
  /________________\  (65-75%)
```

## Unit Tests

### Framework
- **Jest** (Node.js)

### Coverage
- Business logic
- Utility functions
- Data validation
- Error handling

### Example (Authentication Service)
```javascript
describe('Authentication Service', () => {
  describe('hashPassword', () => {
    it('should hash password securely', async () => {
      const password = 'securePassword123';
      const hash = await hashPassword(password);
      expect(hash).not.toBe(password);
      expect(await comparePassword(password, hash)).toBe(true);
    });
  });

  describe('generateToken', () => {
    it('should generate valid JWT token', () => {
      const token = generateToken({ userId: 'uuid', email: 'test@example.com' });
      expect(token).toBeDefined();
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe('uuid');
    });
  });
});
```

## Integration Tests

### Framework
- **Supertest** for HTTP testing
- **Docker** for service isolation

### Scope
- Service-to-service communication
- Database interactions
- Message broker integration

### Test Database
- Separate test database per service
- Database seeding with test data
- Cleanup after each test

### Example
```javascript
describe('API Gateway - Authentication Flow', () => {
  test('POST /auth/register should create user', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: 'newuser@example.com',
        password: 'securePass123'
      });
    
    expect(response.status).toBe(201);
    expect(response.body.token).toBeDefined();
  });

  test('POST /auth/login should return token for valid credentials', async () => {
    // Setup: create user
    await User.create({
      email: 'existing@example.com',
      password: await hashPassword('password123')
    });

    // Test
    const response = await request(app)
      .post('/auth/login')
      .send({
        email: 'existing@example.com',
        password: 'password123'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});
```

## End-to-End Tests

### Framework
- **Cypress** for UI testing
- **Jest** + **Supertest** for API flow testing

### Scenarios
1. **Happy Path**: User submits image → Analysis complete → Notification sent
2. **Error Handling**: Invalid image → Error shown to user
3. **Cancellation**: User cancels analysis mid-process
4. **Duplicate Submission**: Multiple images submitted rapidly

### Test Flow Example
```gherkin
Feature: Illegal Parking Violation Report
  
  Scenario: User submits valid parking violation image
    Given I am logged into SnapPark
    When I upload a valid image
    And the image is analyzed
    Then I receive the violation analysis result
    And a notification is sent
    And the case appears in my case history
```

## Performance Testing

### Tools
- **Apache JMeter**
- **k6** for load testing

### Scenarios
- Load: 100 concurrent image uploads
- Stress: Gradually increase to failure point
- Endurance: Sustained load for 1 hour
- Spike: Sudden 10x load increase

### Metrics
- Response time (< 5 seconds for analysis)
- Throughput (cases/second)
- Error rate (< 0.1%)
- Resource utilization (CPU, memory)

## Security Testing

### OWASP Top 10 Checks
- SQL Injection prevention
- Authentication bypass attempts
- Authorization flaws
- Sensitive data exposure
- Cross-Site Scripting (XSS)
- CSRF attacks
- Using components with known vulnerabilities
- Insufficient logging and monitoring

### Tools
- **OWASP ZAP** for vulnerability scanning
- Manual penetration testing
- JWT token tampering tests

## Test Execution

### Local Development
```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# With coverage
npm run test:coverage
```

### CI/CD Pipeline
```yaml
stages:
  - lint
  - unit-test
  - integration-test
  - security-scan
  - e2e-test
  - performance-test
```

### Docker Compose for Testing
```bash
docker-compose -f docker-compose.test.yml up
```

## Test Data Management

### Factories/Builders
```javascript
// Factory for creating test users
class UserFactory {
  static create(overrides = {}) {
    return {
      email: `test-${Date.now()}@example.com`,
      password: 'testPassword123',
      firstName: 'Test',
      lastName: 'User',
      ...overrides
    };
  }
}

// Usage
const user = UserFactory.create({ email: 'custom@example.com' });
```

### Database Seeding
```javascript
beforeEach(async () => {
  // Clear database
  await User.deleteMany({});
  
  // Seed test data
  await User.create(UserFactory.create());
  await Case.create(CaseFactory.create());
});
```

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
      rabbitmq:
        image: rabbitmq:3.12
    
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run test
      - run: npm run test:integration
      - uses: codecov/codecov-action@v2
```

## Coverage Goals

| Type | Target |
|------|--------|
| Unit Test Coverage | > 80% |
| Integration Coverage | > 70% |
| Critical Paths | 100% |
| Overall Coverage | > 85% |

## Test Monitoring

### Metrics
- Test pass rate
- Test execution time
- Code coverage trends
- Failed test patterns

### Reporting
- Coverage reports (Codecov)
- Test result dashboards
- Performance trends

## Accessibility Testing

### Tools
- **axe DevTools**
- **WAVE**

### Standards
- WCAG 2.1 Level AA compliance
- Screen reader compatibility
- Keyboard navigation

## Documentation

### Test Documentation
- README in each service with testing instructions
- Code comments for complex test logic
- Test data setup documentation

### Examples
Each service should have:
- `test/unit/` - Unit tests
- `test/integration/` - Integration tests
- `test/fixtures/` - Test data
- `test/README.md` - Testing guide

