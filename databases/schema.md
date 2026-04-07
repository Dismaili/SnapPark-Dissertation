# Database Schema for SnapPark

> **Note:** Tables marked with ✅ are created by the services at startup. Tables marked with 🔲 are planned and documented here for future implementation.

## User/Authentication Database (snappark_auth)

### Users Table ✅
```sql
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Refresh Tokens Table ✅
```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token
  ON refresh_tokens (token);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens (user_id);
```

---

## Case Database (snappark_case)

### Cases Table ✅
```sql
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  violation_confirmed BOOLEAN,
  violation_type VARCHAR(100),
  explanation TEXT,
  confidence_level FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  archived_at TIMESTAMP
);

CREATE INDEX idx_cases_user_id ON cases(user_id);
CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_created_at ON cases(created_at);
```

### Images Table 🔲
```sql
CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(50),
  width INTEGER,
  height INTEGER,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_images_case_id ON images(case_id);
```

### Analysis Results Table 🔲
```sql
CREATE TABLE analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ai_model VARCHAR(50),
  ai_response JSONB,
  processing_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analysis_results_case_id ON analysis_results(case_id);
```

### Case Status History Table 🔲
```sql
CREATE TABLE case_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_case_status_history_case_id ON case_status_history(case_id);
CREATE INDEX idx_case_status_history_changed_at ON case_status_history(changed_at);
```

---

## Notifications Database (snappark_notifications)

### Notifications Table ✅
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL,
  user_id UUID NOT NULL,
  notification_type VARCHAR(50),
  recipient VARCHAR(255),
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  failed_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_case_id ON notifications(case_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
```

### Notification History Table 🔲
```sql
CREATE TABLE notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  attempt_number INTEGER,
  status VARCHAR(50),
  response_code INTEGER,
  response_message TEXT,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_attempts_notification_id ON notification_attempts(notification_id);
```

---

## Audit/Event Database (snappark_audit) — 🔲 Not yet implemented

### Events Table (Event Sourcing) 🔲
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  version INTEGER
);

CREATE INDEX idx_events_aggregate_id ON events(aggregate_id);
CREATE INDEX idx_events_aggregate_type ON events(aggregate_type);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_created_at ON events(created_at);
```

### Snapshots Table (Event Sourcing Optimization) 🔲
```sql
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  state JSONB NOT NULL,
  version INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshots_aggregate_id ON snapshots(aggregate_id);
CREATE INDEX idx_snapshots_aggregate_type ON snapshots(aggregate_type);
```

### Audit Log Table 🔲
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  changes JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_resource_type ON audit_log(resource_type);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
```

---

## Setup Instructions

```bash
# Connect to each database and run the appropriate schema

# Auth Database
psql postgresql://snappark_user:snappark_password@localhost:5432/snappark_auth < auth_schema.sql

# Case Database
psql postgresql://snappark_user:snappark_password@localhost:5433/snappark_case < case_schema.sql

# Notifications Database
psql postgresql://snappark_user:snappark_password@localhost:5434/snappark_notifications < notifications_schema.sql

# Audit Database
psql postgresql://snappark_user:snappark_password@localhost:5435/snappark_audit < audit_schema.sql
```

