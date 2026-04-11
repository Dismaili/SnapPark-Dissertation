# Notification Service

## Overview
Sends notifications to users when parking violation cases are created. Operates asynchronously and independently from core analysis pipeline.

## Responsibilities
- Subscribe to CaseCreated events from message broker
- Send notifications via multiple channels
- Track notification delivery status
- Handle retries and failures
- Maintain notification history

## Notification Channels
- **SMS**: Send SMS to vehicle owner
- **Push Notification**: Mobile push notification
- **Email**: Email notification (future)
- **Webhook**: Custom integrations (future)

## Service Characteristics
- **Asynchronous**: Processes events independently
- **Decoupled**: Doesn't interact with other services directly
- **Resilient**: Can be restarted without losing events
- **Idempotent**: Safe to process same event multiple times

## API Endpoints
- `GET /notifications/user/:userId` - List user notifications
- `GET /notifications/:id` - Get notification details
- `PUT /notifications/:id/status` - Update notification status
- `GET /health` - Health check

## Database Schema
```sql
-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  user_id UUID NOT NULL,
  notification_type VARCHAR(50), -- sms, push, email
  recipient VARCHAR(255), -- phone, device_token, email
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, failed, delivered
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notification History (for retries and audit)
CREATE TABLE notification_history (
  id UUID PRIMARY KEY,
  notification_id UUID REFERENCES notifications(id),
  attempt_number INTEGER,
  status VARCHAR(50),
  response_code INTEGER,
  response_message TEXT,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Event Listener

### Subscribed Events
- `CaseCreated`: Triggered when new violation case is created

### Event Processing Flow
```
RabbitMQ: CaseCreated Event
    ↓
Notification Service receives event
    ↓
Query user contact preferences
    ↓
Format notification message
    ↓
Send via SMS provider (Twilio/AWS SNS)
    ↓
Record delivery status
    ↓
Publish NotificationSent event
    ↓
Audit Database Writer stores event
```

## Environment Variables
```
PORT=3004
DATABASE_URL=postgresql://user:pass@notifications-db:5432/snappark_notifications
MESSAGE_BROKER_URL=amqp://rabbitmq:5672
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
RETRY_ATTEMPTS=3
RETRY_DELAY=5000
```

## Dependencies
- Express.js
- amqplib (RabbitMQ client)
- pg (PostgreSQL driver)
- twilio (SMS delivery)
- axios (HTTP client)

## Notification Message Templates

### SMS Template
```
Parking Alert: Your reported violation case #{caseId} has been analyzed. 
Violation: {violationType}. 
Result: {explanation}
Learn more: https://snappark.app/cases/{caseId}
```

### Push Template
```
Title: "Parking Violation Report"
Body: "Your image has been analyzed. Violation status: {violationConfirmed}"
Deep link: snappark://cases/{caseId}
```

## Error Handling
- Implements exponential backoff for retries
- Logs failed notifications for manual review
- Publishes failure events to message broker
- Continues operation if one channel fails

## Development
```bash
npm install
npm run dev
```

## Testing
```bash
npm run test
```

## Deployment Notes
- Container should be replicable for scaling
- No state stored locally (all in database)
- Can be restarted safely
- Message broker persists events until processed

