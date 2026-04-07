# SnapPark - Intelligent Parking Violation Detection System

## Overview

SnapPark is a microservices-based system designed to intelligently assess potential cases of illegal car parking based on images provided by users. The system combines automated image analysis with Large Language Models (LLMs) to generate reasoned opinions about parking violations and provide clear, human-readable explanations.

## Project Objectives

- **Image Analysis**: Analyze visual content to identify illegal parking situations
- **Violation Detection**: Identify scenarios such as:
  - Blocking pedestrian crossings
  - Obstructing sidewalks
  - Blocking roads
  - Parking near visible no-parking signs
- **AI-Powered Reasoning**: Leverage Google Gemini API for intelligent analysis
- **User Accessibility**: Provide clear explanations for parking violation decisions
- **Scalability**: Microservices architecture supporting independent scaling

## Applications

- **Citizens**: Report suspicious parking violations
- **Local Communities**: Promote safer urban environments
- **Urban Authorities**: Data collection for enforcement and policy making

## Project Structure

```
SnapPark-Dissertation/
├── docs/                          # Documentation
│   ├── literature-review.md      # Academic background and references
│   ├── requirements.md           # Functional and non-functional requirements
│   └── architecture/             # Architecture documentation
├── services/                      # Microservices
│   ├── api-gateway/              # API Gateway and routing
│   ├── authentication-service/   # User authentication and authorization
│   ├── violation-analysis-service/ # Image analysis coordination
│   └── notification-service/     # User notifications
├── databases/                     # Data layer schemas
├── deployment/                    # Docker and Kubernetes configs
├── architecture/                  # Architectural diagrams and patterns
└── tests/                        # Test suites
```

## Architecture Overview

SnapPark employs a **microservices architecture** aligned with the Cloud Continuum, enabling:

- **Independent Scalability**: Each service scales independently
- **High Availability**: Failure in one service doesn't affect others
- **Data Isolation**: Database per service pattern
- **Asynchronous Communication**: Event-driven architecture using message brokers
- **Cloud & Edge Deployment**: Flexible deployment across cloud and edge infrastructure

### Key Architectural Layers

1. **Client Layer**: Web application interface
2. **Access Layer**: API Gateway with authentication
3. **Core Service Layer**: Three independently deployable microservices
4. **Messaging Layer**: Event broker (RabbitMQ)
5. **Data Layer**: Distributed databases per service

## Documentation

- [Literature Review](docs/literature-review.md) - Academic foundations
- [Requirements](docs/requirements.md) - Functional and non-functional specs
- [Architecture Design](docs/architecture/architectural-design.md) - System design details

## Technologies Stack

- **Backend Services**: Node.js
- **Web Framework**: Express.js
- **API**: REST
- **AI/LLM**: Google Gemini API
- **Message Broker**: RabbitMQ
- **Database**: PostgreSQL
- **Containerization**: Docker
- **Development Environment**: Docker Compose

## Contact & Attribution

This is a dissertation project developed for academic research on microservices architectures in the context of Cloud Continuum computing.

---
**Last Updated**: April 2026
