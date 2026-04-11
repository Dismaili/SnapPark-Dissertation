# Violation Analysis Service

## Overview
Coordinates image analysis with external LLM (Gemini AI). Analyzes parking violations and generates structured analysis results.

## Responsibilities
- Validate uploaded images
- Prepare analysis prompts
- Call Gemini API (synchronous)
- Parse AI responses
- Structure analysis results
- Create case records
- Publish events to message broker

## Analysis Process
1. Receive image from API Gateway
2. Validate image format and size
3. Generate structured prompt for Gemini
4. Call Google Gemini API synchronously
5. Parse violation detection and reasoning
6. Structure response with:
   - Violation confirmed (yes/no)
   - Violation type (if any)
   - Confidence level
   - Explanation text
   - Evidence points
7. Store case and results
8. Publish CaseCreated event

## API Endpoints
- `POST /violations/analyze` - Submit image for analysis
- `GET /violations/:caseId` - Retrieve case details
- `GET /violations/:caseId/status` - Check analysis status
- `DELETE /violations/:caseId` - Cancel analysis (if not started)
- `GET /health` - Health check

## Database Schema
```sql
-- Cases table (in Case Database)
CREATE TABLE cases (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Analysis Results table
CREATE TABLE analysis_results (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  violation_confirmed BOOLEAN,
  violation_type VARCHAR(100),
  confidence_level FLOAT,
  explanation TEXT,
  ai_response JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Images table
CREATE TABLE images (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  file_name VARCHAR(255),
  file_path VARCHAR(500),
  file_size INTEGER,
  mime_type VARCHAR(50),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Environment Variables
```
PORT=3002
DATABASE_URL=postgresql://user:pass@case-db:5432/snappark_case
GEMINI_API_KEY=your-gemini-api-key
GEMINI_API_URL=https://api.gemini.google.com
MESSAGE_BROKER_URL=amqp://rabbitmq:5672
IMAGE_UPLOAD_DIR=/uploads/images
MAX_IMAGE_SIZE=10485760
```

## Dependencies
- Express.js
- pg (PostgreSQL driver)
- axios (HTTP client for Gemini API)
- amqplib (RabbitMQ client)
- multer (file upload handling)
- sharp (image processing)

## Development
```bash
npm install
npm run dev
```

## Gemini API Integration

### Prompt Template
```
Analyze the parking situation in this image. Determine if the vehicle appears to be illegally parked.

Consider the following parking violations:
1. Blocking pedestrian crossing
2. Obstructing sidewalk
3. Blocking road/lane
4. Parking near no-parking sign
5. Blocking driveway or access point

Provide:
- Yes/No: Is this an illegal parking violation?
- Violation type (if yes)
- Confidence level (0-100%)
- Brief explanation of your analysis
- Key evidence points from the image
```

### Response Parsing
Parse Gemini response to extract:
- Violation status
- Type and severity
- Confidence score
- Explanation text

## Event Publishing
After analysis completion, publish to RabbitMQ:
```json
{
  "eventType": "CaseCreated",
  "caseId": "uuid",
  "userId": "uuid",
  "violationConfirmed": true,
  "violationType": "blocking_pedestrian",
  "timestamp": "2026-03-23T10:00:00Z"
}
```

