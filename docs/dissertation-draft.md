CITY College,

University of York Europe Campus

Computer Science Department

UNDERGRADUATE INDIVIDUAL PROJECT

# SnapPark: An Intelligent Microservices-Based System for Detecting Illegal Parking from Citizen-Submitted Images

This report is submitted in partial fulfillment of the requirement for the degree of Bachelors in Computer Science with Honours by

**Drin Ismaili**

June 2026

Approved

Dr. Simeon Veloudis

\newpage

## Abstract

This dissertation presents the design and development of SnapPark, a microservices-based web system that helps citizens report cases of suspected illegal car parking by submitting photographs. Illegal parking, such as blocking pedestrian crossings, obstructing sidewalks, blocking roads, or parking next to visible no-parking signs, is a common problem in urban areas, and traditional enforcement struggles to cover every street at every time. SnapPark tries to close this gap by combining two recent technological directions. First, it uses a generative multimodal Large Language Model (the Google Gemini API) to look at an uploaded image and produce a reasoned, human-readable opinion on whether the photo shows a parking violation, together with a confidence value and a short explanation. Second, it is built as a distributed system using a microservices architecture placed behind an API Gateway, with three independently deployable services for authentication, violation analysis, and notification. The system applies a number of well-known distributed-systems patterns, including database-per-service, event sourcing for an immutable audit trail, the saga pattern for keeping data consistent across operations, and publish/subscribe messaging for asynchronous notifications. It also applies polyglot persistence: the violation-analysis database is extended with vector embeddings so that previously analysed cases that "look like" a new one can be retrieved using approximate nearest-neighbour search. This report covers the motivation and scope of the project, a review of the relevant literature on microservices architecture and on artificial intelligence for image understanding, the requirements and architecture, the iterative implementation process, and the evaluation of the system.

\newpage

## Declaration

All sentences or passages quoted in this dissertation from other people's work have been specifically acknowledged by clear cross-referencing to author, work and page(s). I understand that failure to do this amounts to plagiarism and will be considered grounds for failure in this dissertation and the degree examination as a whole.

I have completed and submitted this work by myself without assistance from or communication with another person, either external or fellow student, or any AI type of content generator. I understand that not working on my own will be considered grounds for unfair means and will result in a fail mark for this work and might invoke disciplinary actions.

☐ I agree that my dissertation can be used as a model/example by future undergraduate students, for educational purposes only.

Name: Drin Ismaili

Signed:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date:

\newpage

## Acknowledgments

I would like to thank my supervisor Dr. Simeon Veloudis for all of the support, guidance and feedback he has given me throughout the development of this project. His advice helped me a lot when I was not sure about the direction of the work, and I am very grateful for it.

I would also like to thank my friends and classmates who supported and encouraged me during the whole period of this project.

Finally, I am thankful to my family for their constant support and patience. They have always been there for me, and I hope I can make them proud with this work.

\newpage

## Contents

1. Introduction
   - 1.1 Project Motivation
   - 1.2 Aim of the Project
   - 1.3 Project Objectives
   - 1.4 Project Scope
   - 1.5 Report Structure
2. Literature Review
   - 2.1 Architectural Paradigms
   - 2.2 API Gateway
   - 2.3 Data Management in Microservices
   - 2.4 Communication Between Services
   - 2.5 Deployment and Containerisation
   - 2.6 AI-Aided Image Evaluation
   - 2.7 Semantic Similarity and Vector Databases
   - 2.8 Implementation Technologies
   - 2.9 Related Work and Existing Systems
3. System Overview
   - 3.1 What SnapPark Does
   - 3.2 System Architecture
   - 3.3 The Main Workflow, End to End
   - 3.4 User Roles
4. Project Management and Risk
5. Requirements and Analysis
6. System Design and Implementation
7. Testing and Evaluation
8. Conclusion and Future Work

\newpage

# Chapter 1: Introduction

This chapter introduces the project. It first explains the motivation behind SnapPark and the real-world problem it tries to address. It then states the aim of the project, lists the objectives that were set in order to reach that aim, and defines the scope so that it is clear what the project includes and what is left outside of it. The chapter ends with a short description of how the rest of the report is structured.

## 1.1 Project Motivation

Cities are becoming more crowded and the number of cars on the streets keeps increasing. As a result, illegal and inconsiderate parking has become a daily problem in many urban areas. Drivers sometimes leave their vehicles in places where they should not, such as on pedestrian crossings, on sidewalks, in front of no-parking signs, or in a way that partly or fully blocks the road. These situations are not only annoying, they can also be dangerous. A car parked on a pedestrian crossing forces people to walk into the road, a car on a sidewalk is a serious problem for people with disabilities, parents with strollers and elderly people, and a badly parked vehicle can slow down or even block emergency vehicles like ambulances and fire trucks.

The traditional way of dealing with this problem is enforcement by a limited number of traffic officers who patrol the streets. This approach has clear limitations. Officers cannot be everywhere at the same time, and many violations happen and end before anyone official sees them. The process is also mostly reactive, and it depends heavily on manual effort. At the same time, ordinary citizens witness these violations all the time and almost everyone now carries a smartphone with a good camera in their pocket. The problem is that there is usually no easy and structured way for a citizen to report a violation together with the visual evidence. Phone calls and simple web forms lose the photo or require a person on the other side to manually look at every report, which does not scale well.

In parallel to this, two areas of computer science have advanced very quickly in the last years. The first is artificial intelligence, and in particular Large Language Models (LLMs) and multimodal models that are able to understand not only text but also images. These models have reached a point where they can look at a photograph and describe what is happening in it, and even give a short reasoned opinion about it. This makes it realistic to build a system that automatically inspects an uploaded photo and decides whether it probably shows a parking violation, instead of relying only on a human reviewer. The second area is the way modern software is built and deployed. Cloud computing, containers and the microservices architectural style make it possible to build systems that are scalable, that can be maintained service by service, and that are resilient to the failure of individual parts.

SnapPark was motivated by the idea of bringing these two directions together. The aim was to give citizens a simple web application where they can upload a photo of a suspected violation, and to use a multimodal AI model in the background to produce a clear, reasoned opinion about that photo. By building the system as a set of microservices, the project also becomes a good case study for applying modern distributed-systems patterns in practice, which is interesting from an academic point of view and not only from a product point of view.

## 1.2 Aim of the Project

The aim of this project is to design and implement a microservices-based web system, called SnapPark, that allows registered citizens to submit photographs of suspected illegal parking, uses a generative multimodal Large Language Model to analyse each submission and produce a human-readable reasoned opinion together with a confidence value, stores every report as a durable case with an audit trail, notifies the user about the outcome of the analysis, and is able to retrieve previously analysed cases that are visually and semantically similar to a new one. The system should be built in a way that demonstrates good software engineering practice, applying recognised architectural and data-management patterns for distributed systems.

## 1.3 Project Objectives

In order to reach the aim above, the following objectives were defined:

- **O1 — Microservices architecture.** Design and implement the system as independently deployable microservices placed behind an API Gateway. The core business capabilities are split into an Authentication Service, a Violation Analysis Service, and a Notification Service.
- **O2 — Authentication and security.** Provide user registration with email verification using a one-time password (OTP), secure login using hashed passwords, and token-based sessions using JSON Web Tokens (JWT). All requests must be authenticated at the gateway before reaching any service, and the system must support a citizen role and an administrator role.
- **O3 — Image upload and handling.** Allow authenticated users to upload one or more images for a single report, validate that uploads are real images, and automatically discard images that stay unprocessed for too long.
- **O4 — AI-powered analysis.** Use a multimodal LLM (the Google Gemini API) to analyse each image and return a structured result containing the type of violation, a short explanation written in plain language, and a confidence score.
- **O5 — Data management and consistency.** Apply the database-per-service pattern, keep an immutable event history using event sourcing for auditability, and use the saga pattern to keep data consistent across the steps of creating a case.
- **O6 — Polyglot persistence and similarity search.** Extend the case database with vector embeddings so that the system can answer "show me cases that look like this one" using approximate nearest-neighbour search.
- **O7 — Notifications.** Notify users about the outcome of the analysis, and design the notification component so that it can send messages through more than one channel (email, SMS and push) without changing the rest of the system.
- **O8 — Web frontend.** Build a responsive web application that citizens and administrators can use to register, log in, submit reports, see their cases and results, and (for administrators) review the system.
- **O9 — Deployment and quality.** Containerize the services with Docker, prepare configuration for orchestration with Kubernetes, and validate the system through automated tests with measured code coverage.

## 1.4 Project Scope

It is important to make clear what this project includes and what it does not. SnapPark is delivered as a **web application**. A native mobile application was considered but ruled out, because the core research interest of the project is the backend architecture and the AI analysis pipeline, and a web frontend is enough to demonstrate and use these features. The system supports two kinds of users: ordinary citizens, who can submit and view their own reports, and administrators, who have a wider view of the system.

The AI component of SnapPark produces an **advisory opinion**, not a legal decision. The system gives a reasoned analysis that a human or an authority could use, but it does not itself issue fines or take legal action. The administrator interface includes a "Report to authority" button. When an administrator reviews a confirmed violation and decides it is serious enough to escalate, this button moves the case through an internal status transition (completed → reported_to_authority → resolved) to track that decision. In the current implementation the button does not send any message to an external system — it updates the case record inside SnapPark's own database only. The button is designed with future deployment in mind: if SnapPark were adopted by a real city or country, this action would trigger an automated email to the relevant local authority, giving them the case details, the AI analysis, and the submitted photographs so that they could take enforcement action. That email integration is not wired up in this implementation because there is no real authority to send to, and building it requires knowledge of the specific authority's contact system, which varies by jurisdiction. Integration with real municipal systems, police databases, payment or fine-collection systems, and the lookup of a vehicle owner from a number plate are therefore treated as future extensions and are outside the scope of this implementation. The model does try to read a number plate from the photo on a best-effort basis as part of its description, but the project does not build a dedicated, production-grade automatic number-plate-recognition pipeline.

Because this is a single-author dissertation project with no operational budget, some pragmatic decisions were made. For example, the vector similarity feature is implemented with the pgvector extension on top of PostgreSQL, rather than running a separate, managed vector database such as Pinecone or Milvus. A deterministic fallback is also provided so that the full pipeline can be run and tested end to end without a paid AI API key. These decisions and their trade-offs are discussed in more detail in the relevant chapters.

## 1.5 Report Structure

The rest of this report is organised as follows:

- **Chapter 2 — Literature Review.** Reviews and compares the technologies and patterns behind SnapPark: the choice of architectural paradigm (monolithic, service-oriented, and microservices), the API Gateway, the management of data across independently owned services, the styles of communication between services, the packaging and deployment of the services, the AI-aided evaluation of uploaded images, semantic similarity search over past cases, the implementation technologies used to build the system, and finally how SnapPark compares to existing civic-reporting and parking systems and where it fits in the existing research landscape.
- **Chapter 3 — System Overview.** Gives a high-level, plain-language picture of the finished system before the detailed chapters: what SnapPark does, how its parts fit together, how a single report flows through the system from upload to outcome, and what each kind of user can do.
- **Chapter 4 — Project Management and Risk.** Describes the incremental, branch-per-feature development process that was followed, the planning and timeline of the work, and the risks that were identified and how they were managed.
- **Chapter 5 — Requirements and Analysis.** Presents the functional and non-functional requirements of the system, derives them from the aim and objectives, and analyses them with the help of a use-case model.
- **Chapter 6 — System Design and Implementation.** Sets out the detailed design of the system and how it was implemented, covering the gateway, the data design, the case-creation saga, the messaging, the AI pipeline, the similarity search, and the deployment configuration.
- **Chapter 7 — Testing and Evaluation.** Reports how the system was tested, measures code coverage and end-to-end latency, traces each requirement to the evidence that it was met, and evaluates the system against its objectives.
- **Chapter 8 — Conclusion and Future Work.** Summarises the outcomes of the project, discusses its limitations, and suggests directions for future work.

The report ends with the list of References and an Appendix that shows the user interface.

\newpage

# Chapter 2: Literature Review

This chapter reviews and compares the technologies, architectural patterns and design patterns that make up the architecture behind SnapPark. It is broken down into sections that each follow one of the major decisions made during the project: the choice of the overall architecture (Section 2.1), the API Gateway (Section 2.2), the patterns for managing data that is stored across independently owned services (Section 2.3), the communication between those services (Section 2.4), the packaging and deployment of the services (Section 2.5), the analysis of uploaded images (Section 2.6), the retrieval of past, semantically similar cases (Section 2.7), and the implementation technologies used to build the services (Section 2.8). In each section the main options that were considered are reviewed, their strengths and weaknesses are described, and the section ends with the option that was finally chosen for SnapPark and the reasons for choosing it. The chapter closes by looking outward, at the systems and research that already exist in this space and at where SnapPark sits among them (Section 2.9).

## 2.1 Architectural Paradigms

This section looks at the path from the monolithic style, through service-oriented architecture (SOA), to the microservices style that SnapPark finally uses, and at the technical problems that each style has.

### 2.1.1 Monolithic Architecture

The monolithic style describes a design in which the whole system is built and deployed as one single unit. In a monolith the user interface, the business logic, the data-access layer and the infrastructure code are all packaged into one artefact that runs in a single process and address space, usually shares one database, and where all communication between the parts happens through normal in-process function calls. This makes the monolith a simple way to think about a system and gives it good performance, because there is no network in the middle.

The monolithic style has some real advantages, especially the operational simplicity and the low complexity at the start. There is only one thing to deploy, one log stream to follow, one set of credentials to manage and one artefact to test end to end. For small systems, or for the first version of an application, these are practical advantages. Fowler argues that many teams should in fact begin with a monolith and only split it apart once they understand the domain well enough to draw good service boundaries, an approach he calls "monolith first" [1].

The weaknesses of this style appear as the application grows. A small change to one feature still forces the whole application to be rebuilt, re-tested and redeployed, which slows down how often new releases can be made. The parts of a monolith are tightly coupled at both the code level and the database level, so it becomes hard to change one part without affecting another. Scaling is coarse-grained: if only one component is under heavy load, the whole application still has to be scaled out together, which is a poor use of resources. A defect in one component, such as a memory leak, can crash the whole process, and the entire application is locked to a single language and framework, so moving to another technology is disruptive and expensive [2]. For SnapPark, where the image-analysis work is heavy and bursty but the authentication work is light and steady, this single-block scaling is a bad fit.

### 2.1.2 Service-Oriented Architecture (SOA)

Service-oriented architecture (SOA) appeared as a way to deal with the limits of building large systems as monoliths. With SOA a large application is broken into coarse-grained, reusable services that communicate across a network, classically using an XML-based SOAP message format and an Enterprise Service Bus (ESB) in the middle. Erl describes SOA as a way of designing software around reusable, loosely coupled services with formal contracts [3]. The ESB handles routing of messages between services, transformation of messages from one format to another, the enforcement of security policies, and a single point at which the communication between services can be audited and governed.

The benefits of SOA were mainly reusability and central governance: once a service is published, many consumers can use it, and the same policies can be applied to every service through the one common bus. In practice, though, this central bus also became the main weakness. The ESB is a single point of failure and can become a performance bottleneck, because all traffic has to pass through it, and it tends to pull business logic out of the services and into the middleware, which works against the goal of independent services [2]. The services themselves were often still quite large and still shared databases, so some of the coupling problems of the monolith remained, and the verbose SOAP/XML and WS-* stack carries a high overhead compared with the JSON-over-HTTP that most modern web applications use. SOA is therefore important as the direct ancestor of microservices, but the specific way it was usually built is one of the things that microservices reacted against.

### 2.1.3 Microservices Architecture

The microservices style takes the basic SOA idea — build the system out of services — and adds a strong opinion about how small and how independent those services should be. Lewis and Fowler describe microservices as an approach in which a single application is built as a suite of small services, each running in its own process and communicating with lightweight mechanisms, often an HTTP API, and each built around a single business capability [4]. Each service owns its own data, exposes it through a network interface (usually JSON-over-HTTP or an asynchronous message contract), and can be deployed, scaled and updated on its own. Unlike the centralised bus of SOA, microservices communicate more directly and through lightweight brokers, pushing the intelligence out to the endpoints instead of concentrating it in the middleware. The shift from SOA to microservices is often summarised as a move from "smart pipes, dumb endpoints" to "smart endpoints, dumb pipes" [4]. Newman stresses that the property that matters most is independent deployability: you should be able to change one service and release it on its own without redeploying everything else [5].

The literature is honest that this style is not free. The benefits — independent deployment, fine-grained scaling, technology diversity, and isolated fault domains — come together with the full set of problems of distributed systems: the extra operational work of automating deployments, observing many services and tracing requests across them, and the harder job of managing data when there is no single database [2]. Pahl and Jamshidi, in a systematic mapping study, note that the field was still young and that many claims about microservices had not yet been backed by strong evidence [6]. Taibi et al. catalogue the architectural patterns that teams use to deal with these issues, which shows that microservices in practice are really a collection of supporting patterns rather than a single technique [7]. The network that joins the services also creates a new class of failure modes — partial failures, retries and eventual consistency — that do not exist in a monolith.

### 2.1.4 Architectural Decision

SnapPark is built using a microservices architecture. A monolith was considered, but the workload of the system is fundamentally asymmetrical: the Analysis component does computationally heavy image processing and calls an external AI service, while the Authentication and Notification components are light and low-latency, so it would not be efficient to deploy and scale all of them as a single artefact. SOA was not chosen because a centralised bus would re-introduce the coupling that the project is trying to avoid, and because the verbose XML/SOAP stack does not fit an interactive web application whose browser clients naturally speak JSON [4].

The final microservices design is expressed in the source code as three independent services (Authentication, Analysis and Notification), each with its own `package.json`, its own `Dockerfile`, its own source tree, and its own PostgreSQL instance (`postgres_auth`, `postgres_case` and `postgres_notifications`). The services are wired together for local development through `deployment/docker-compose.yml`, and for production through the manifests in `deployment/kubernetes/`. The extra operational complexity of microservices is reduced through the orchestration and automation discussed in Section 2.5.

## 2.2 API Gateway

An API Gateway is a server-side intermediary that sits between external clients and the internal services of a distributed system. It is the single entry point for all external traffic: every microservice is reached through one address (the gateway), which inspects each request, enforces cross-cutting policies, and routes the request to the correct downstream service. Richardson describes this pattern as a single entry point that gives clients one address to talk to while internally routing each request to the right service, and Newman discusses the related question of where to place shared logic so that it is not duplicated in every service [8], [5].

A gateway usually handles, for each request, routing, authentication and authorisation, rate limiting, the transformation of requests and responses, the aggregation of calls across several services, and the termination of TLS. Putting these functions in one place relieves the individual services of having to implement them separately and gives a consistent way of handling requests across all of them. It also decouples the addresses and interfaces that clients use from the internal layout of the services: clients do not notice when services are split, merged, renamed or moved, as long as the gateway configuration is updated.

The API Gateway is often contrasted with the ESB of SOA, since both sit between clients and services. The main difference is one of "intelligence". An ESB contains business logic for transforming and orchestrating messages, which can make it a large, heavy component that is hard to change. The API Gateway is deliberately kept simple and lightweight, concentrating on cross-cutting concerns rather than business logic [2].

In SnapPark the Express-based API Gateway runs on port 3000 and is the only way for clients to reach the backend. A custom gateway was written in Express rather than adopting a heavyweight commercial product because the requirements are modest — validate a JSON Web Token (JWT) [9] against the authentication service and route requests to three backend services — and a heavyweight gateway would have added operational complexity, an external dependency, or a commercial licence, none of which is reasonable for a student project. The implementation is in `services/api-gateway/src/index.js`: an `authenticate` middleware protects all guarded routes, Helmet sets security headers on every HTTP response, and `express-rate-limit` throttles requests per IP address before the gateway forwards them to the three configured backend services.

## 2.3 Data Management in Microservices

Data management is often seen as one of the hardest parts of building a microservices system [8], [5]. In a monolith there is one database shared by all components, and the database's own transaction machinery keeps the data consistent. In a microservices architecture a shared database is treated as an anti-pattern, because it pulls the services back into tight coupling: when several services read and write the same data, a schema change made by one of them can force changes on all the others, and a slow or heavy query from one service can hurt the performance of the rest.

The starting point is therefore the database-per-service pattern. Each service has its own private database, and the only way for another service to reach that data is through the owning service's public API. This keeps the services loosely coupled at the data layer and matches the encapsulation that microservices already have at the code level, so each service is free to pick the storage technology that suits it, to change its own schema without coordinating with anyone, and to be isolated from the failure of another service's database [8], [5]. The cost is that an operation that spans several services can no longer be a single unit of work, because the databases are no longer coordinated. The system then has to choose between a distributed-transaction protocol such as two-phase commit, which is expensive and fragile, and accepting eventual consistency. The saga pattern is the usual way of handling a multi-step operation under eventual consistency [8], [10].

### 2.3.1 The Saga Pattern

The saga was first defined by Garcia-Molina and Salem in 1987 as a sequence of local transactions, where the successful completion of one step triggers the next, and where each step has a matching compensating transaction that can undo its effect if a later step fails [10]. A saga lets an operation that spans several services behave, from the user's point of view, like one unit of work, without needing any distributed-transaction infrastructure [8], [10].

There are generally two ways to coordinate a saga [8]. In the choreography style, each service publishes an event when it finishes its step, and the next service subscribes to that event and does its step; the saga as a whole is just the sum of these events and subscriptions, with no central conductor. In the orchestration style, a single coordinator tells each service to perform its step, records whether the step succeeded, and runs the compensating actions if a step fails, so the orchestrator holds one complete definition of the saga.

Choreography reduces the coupling between services and suits simple, linear sagas, but there is no single place that defines the whole flow, so following what happens means tracing events through several source files [8]. Orchestration adds some coupling, because of the coordinator, but in return the saga becomes a first-class object that can be seen as a whole: the step definitions, the persistence of the saga's state, and the compensations all live in one place [8].

### 2.3.2 Choice

SnapPark uses the database-per-service pattern. A shared database was rejected as too tightly coupled, because it would have removed the independent deployability that is one of the main reasons for using microservices in the first place [8]. The system has three services, each with its own PostgreSQL database — `postgres_auth` holds `snappark_auth`, `postgres_case` holds `snappark_case`, and `postgres_notifications` holds `snappark_notifications` — and the only way one service can reach another's data is through the owning service, using its own credentials.

Creating a single case involves several steps that touch more than one place: analysing the image, persisting the case, persisting the uploaded images, generating and storing the embedding, recording the audit event, and dispatching the notification. This workflow is implemented as an orchestrated saga [8], [10]. Orchestration was chosen because the saga has six distinct steps that each depend on the previous one, and because the compensating actions have to run in reverse (last-in, first-out) order if any step fails, so it is far clearer to define the whole flow in one written artefact (`caseCreationSaga.js`) than to spread it across event subscriptions. After each step the current state of the saga is persisted to the `sagas` table (`coordinator.js:39`), so that the saga can be inspected, resumed or compensated after a failure.

## 2.4 Communication Between Services

Microservices have to communicate with one another to do useful work, and the way they communicate affects the coupling between them, the response time, the fault tolerance, and the operational complexity of the system [8]. Communication is usually divided into two styles: synchronous, where the calling service waits for the response before it continues, and asynchronous, where the caller sends a message and continues without waiting for it to be processed.

### 2.4.1 Synchronous Communication

Synchronous communication is simple: one service calls another over the network and blocks until it gets the result. The two most common choices are HTTP-based REST APIs, which use JSON for requests and responses, and gRPC, which uses HTTP/2 with Protocol Buffers as the message format. REST was defined by Fielding in his PhD dissertation as an architectural style for distributed systems built on a small set of constraints such as a uniform interface and statelessness, and it is the de-facto standard for web APIs, supported natively in browsers and in every server-side language [11]. gRPC offers higher performance and stronger typing than REST, but it needs more tooling to reach a similar developer experience and produces wire traffic that is not human-readable [12].

The advantages of synchronous communication are that it is conceptually simple and that the user gets an immediate answer. The disadvantage is temporal coupling: the calling service is bound to the latency and the availability of the service it calls, so a single slow service can hold up, or bring down, a whole chain of calls [8].

### 2.4.2 Asynchronous Communication

Asynchronous communication decouples the sender from the receiver in time. The sending service hands a message to a broker (a queue) and carries on with its work, while the receiving service reads and processes the message whenever it is ready, perhaps minutes later. The broker has to store the message durably, route it to the right consumer or consumers, and make sure it is not lost. The two most widely used brokers are RabbitMQ, an implementation of the AMQP protocol, and Apache Kafka, a distributed append-only log. RabbitMQ is a traditional broker that emphasises rich routing, per-message acknowledgement, and operational maturity [13], while Kafka emphasises very high throughput, log retention, and replay, which makes it the stronger choice at very large scale when consumers need to re-read historical events [14].

RabbitMQ provides several exchange types, each of which decides how a published message is routed to one or more queues [13]. A direct exchange routes a message to the queues whose binding key exactly matches the message's routing key. A fanout exchange ignores the routing key and sends every message to every bound queue. A topic exchange routes a message to queues whose binding pattern matches the routing key, using the wildcards `*` (one word) and `#` (zero or more words), so a consumer can subscribe to a broad or a narrow class of events with a single declarative pattern. A headers exchange routes on the message's header attributes instead of the routing key, and is rarely used in practice.

The benefits of asynchronous communication are loose coupling, fault tolerance, and a natural way to deliver one message to many consumers [8], [14]. The downsides are the extra operational complexity of running a broker, and the fact that a system whose cause and effect are separated in time is harder to reason about.

### 2.4.3 Conclusion

SnapPark uses RabbitMQ with a topic exchange as its main inter-service communication mechanism. RabbitMQ was chosen over Kafka because it has lower operational demands — it does not need Kafka's log-replay machinery — and because its rich routing fits the various events of the case lifecycle [13]. A topic exchange was chosen because it allows both broad and narrow subscriptions from a single declarative pattern: a direct exchange would have needed each routing key bound separately, a fanout exchange would have delivered every message to every subscriber even when it had no interest in it, and a headers exchange would have added indirection with no real benefit. The topic exchange also fits the extensibility objective from Chapter 1, because a new service can subscribe to a narrow or broad category of events without any change to the publisher.

The code reflects this exactly. In `services/violation-analysis-service/src/rabbitmq.js:22` the exchange is declared as a `topic` exchange, and as the saga runs it publishes the events `case.created`, `case.reported`, `case.resolved` and `case.cancelled`. The Notification Service binds its queues to the routing keys it cares about and consumes those events on its own time, so a delay or failure in sending an email never slows down or breaks the user's main interaction. Synchronous HTTP is used internally in only one place: the gateway validates a JWT by calling the Authentication Service's `/auth/verify` endpoint, where an immediate answer really is needed.

## 2.5 Deployment and Containerisation

A microservices system is made of many independently deployable processes, and these are normally deployed using two technologies: containerisation and container orchestration.

### 2.5.1 Docker

A container is a lightweight, self-contained execution unit that bundles an application together with the libraries and dependencies it needs to run. Several containers can run on one host and share that host's operating-system kernel, so there is no duplication of a full operating system per application, which is why a container can be created and destroyed in seconds where a virtual machine can take minutes [15]. Merkel describes Docker as a way to package an application together with everything it needs into a portable container that runs the same way on a developer's machine and in production [15]. A container image is built from a `Dockerfile` that describes the image layer by layer, and once built it can run on any Docker host. Because the application is bundled with its dependencies, the development and test environment closely matches the environment the application will run in.

### 2.5.2 Kubernetes

A production environment with many containers cannot be managed by hand, so container orchestration is needed to automate the provisioning, scheduling, scaling and management of containers across a cluster of hosts, including restarting failed containers, scaling them up and down with demand, rolling out new versions without downtime, and managing networking and storage. Kubernetes has become the industry-standard orchestrator. Burns et al., writing from Google's experience with Borg, Omega and then Kubernetes, describe how an orchestrator keeps the running state of the cluster reconciled with a desired state described declaratively in YAML manifests, and provides service discovery, load balancing, secret and configuration management, horizontal autoscaling, and rolling updates [16]. Other orchestrators were considered — Docker Swarm (easier to use but a much smaller ecosystem) and HashiCorp Nomad (lighter but a much smaller community) — but Kubernetes was preferred for its position as the leading platform and the quality of the tooling around it.

### 2.5.3 Choice

SnapPark uses Docker to containerise each of the three microservices and the API Gateway; every component has its own `Dockerfile` and can be built and run on its own. For local development the components are wired together with Docker Compose (`deployment/docker-compose.yml`). For production the project includes a full set of Kubernetes manifests in `deployment/kubernetes/`, covering deployments, services, an ingress, config maps, secrets, a horizontal pod autoscaler, and StatefulSets for the databases and the broker. This follows the common cloud-native pattern of using Docker Compose for development and Kubernetes for production [15], [16]: Docker Compose makes it easy to bring the whole system up locally with one command, while Kubernetes answers the questions that only matter in production — progressive rollout, autoscaling, and replacing a failed container based on a health check — at the cost of more complexity than is worth carrying on a developer's machine.

## 2.6 AI-Aided Image Evaluation

When a citizen submits a photograph of a vehicle they believe is illegally parked, SnapPark's violation-analysis component has to decide whether the vehicle is in fact parked illegally, classify the type of violation if there is one, attach a confidence score to that verdict, and produce a short, plain-language justification for the decision. Two general families of technology were considered: traditional computer-vision methods based on custom-trained machine-learning models, and the newer generative, vision-enabled foundation models.

### 2.6.1 Traditional Computer Vision

The traditional approach is to build and train a custom convolutional neural network on a labelled dataset of photographs, an approach with a long history in transport-related computer vision, for example in automatic licence-plate recognition [17]. This gives the developer maximum control over the model's behaviour, predictable classification time, and a system that can run without an external service provider. The cost, however, is high: it needs a large, well-curated and balanced dataset of the targeted parking violations for the relevant jurisdiction, the expertise to design and train the model, and dedicated GPU infrastructure, and even then the model only assigns an image to one of the fixed categories it was trained on. Producing a natural-language explanation of a decision, rather than just a classification label, is a separate and harder research problem.

This approach was judged unsuitable for SnapPark, because none of its prerequisites — a labelled dataset, a deep-learning team, and dedicated GPU infrastructure — realistically exist within an undergraduate project. The research contribution of this project is the architectural integration of generative AI into a civic-technology platform, not the development of a new vision model from scratch.

### 2.6.2 Vision-Enabled Foundation Models

Since around 2023 a new class of multimodal foundation models has made it possible to do quite sophisticated image tasks with no custom training [18]. The main options considered were:

- **Google Gemini** (the `gemini-2.5-flash` family) [18] — fast and inexpensive, with native support for multimodal input and for structured JSON output against a strict schema, and from the same vendor that provides the `text-embedding-004` model used in Section 2.7;
- **OpenAI GPT-4V** (the GPT-4o family) [19] — high-quality reasoning about images with a mature tooling set, but a higher per-call cost and a separate vendor account from the other models used here; and
- **Anthropic Claude** (3.5 Sonnet and above) [20] — strong image reasoning and the most rigorous safety tuning of the three, but slower in its lightweight tier and, at the time of the decision, less able to guarantee the same level of structured output as Gemini.

The benefits of this approach are that no training data, no machine-learning expertise, and no custom infrastructure are needed, and that the model returns both a structured decision and a matching explanation in a single call, which is exactly what SnapPark needs. The downsides are the dependence on a third-party service, a cost per call, network latency, and the well-known tendency of large language models to be confidently wrong at times. The first three can be handled with operational measures — retry logic and budget controls — and the last is handled by treating the model's output as an opinion rather than a final decision, by showing the justification to the user, and by letting an administrator approve the result before it is passed to any outside agency.

### 2.6.3 Selection of Model

SnapPark uses Google Gemini, specifically the `gemini-2.5-flash` model, through the `@google/generative-ai` SDK, configured with the `GEMINI_API_KEY` environment variable [18]. There were three main reasons. First, Gemini's native multimodal input and structured-JSON output let the whole analysis step be done in a single API call. Second, Gemini gives far better general-purpose visual reasoning than a model that could realistically be built within an undergraduate project [18]. Third, the price and latency of `gemini-2.5-flash` are acceptable for an interactive web application. GPT-4V and Claude were set aside on the grounds of cost and structured-output suitability rather than capability; either of them could also have met the requirements. The choice is visible in `services/violation-analysis-service/src/gemini.js`, where the image is sent as a Base64-encoded `inlineData` part together with a prompt that specifies the expected JSON schema, and the response is parsed into a JavaScript object of the form `{violationConfirmed, violationType, confidence, explanation}` that feeds the next steps of the saga.

## 2.7 Semantic Similarity and Vector Databases

A useful feature for a case-management system is to take a new case and find the previous cases that are semantically similar to it. This section reviews the technologies that make that similarity search possible.

### 2.7.1 Text Embeddings

A text embedding is a fixed-length numerical vector that represents the meaning of a piece of text in a high-dimensional space, arranged so that texts with similar meaning lie close together and texts with unrelated meaning lie far apart [21]. Embeddings are produced by dedicated embedding models, such as Google's `text-embedding-004` (768 dimensions) [18], OpenAI's `text-embedding-3-small` (1536 dimensions), and Cohere's `embed-english-v3.0` (1024 dimensions), among others. Because semantic similarity becomes geometric closeness, the texts most similar in meaning to a query can be found simply by finding the vectors nearest to the query's vector. This is much more flexible than keyword search: a query about "blocked sidewalk" can match a case about obstructing a pedestrian path even when none of the exact words are shared.

### 2.7.2 Vector Databases

A vector database is a kind of data store built for the efficient storage and similarity search of high-dimensional vectors, and it comes in two broad forms. The first is the dedicated vector database, such as Pinecone, Weaviate, Milvus or Qdrant; these are standalone systems that give the best performance at the largest scales, but each is an extra piece of infrastructure that has to be provisioned, secured, operated, and kept in sync with the other data stores. The second is the existing-database extension, such as pgvector for PostgreSQL, which adds the ability to store, index and search vectors (together with the related relational data) to a database that the system already runs, without introducing a new data store [23].

Both forms use approximate-nearest-neighbour (ANN) indexes — most commonly HNSW (Hierarchical Navigable Small World) graphs or inverted-file (IVF) indexes — to bring the cost of a similarity search down from linear to roughly logarithmic in the number of stored vectors. Malkov and Yashunin introduced HNSW as a layered graph that can be navigated quickly to find close neighbours with high recall, and it is widely regarded as one of the strongest general-purpose ANN methods, at the price of higher memory use [22].

The idea of deliberately keeping more than one storage model in a single system, choosing each for the access pattern it serves best, is called polyglot persistence, a term popularised by Sadalage and Fowler [24]. Storing a case's relational columns and its embedding vector together, and serving exact-match queries and nearest-neighbour queries each with the index that fits, is exactly this idea in practice.

### 2.7.3 Distance Metrics

The distance between two vectors can be measured in several ways. Cosine distance looks only at the angle between the vectors and ignores their magnitude; since the magnitude of a text-embedding vector usually carries little semantic meaning and the direction carries most of it, cosine distance is the metric almost always recommended for text embeddings [23]. Euclidean distance measures the straight-line distance between the two points and is therefore affected by both direction and magnitude, while inner-product distance measures the dot product and is appropriate when both the direction and the magnitude carry meaning.

### 2.7.4 Choice

SnapPark uses PostgreSQL with the pgvector extension, the HNSW index, cosine distance, and Google's `text-embedding-004` model (768 dimensions) for the embeddings of case verdicts. pgvector was preferred over a dedicated vector database because the Violation Analysis service already stores its relational data in PostgreSQL: by adding pgvector to that same database, a case's verdict embedding can live in the same `cases` table as the rest of its data, so a single SQL query can return a case together with its most similar neighbours, with full transactional consistency and without buying or running any new infrastructure. The decision is visible in the code at `db.js:39`, which enables the extension, at `db.js:185`, where the `embedding vector(768)` column is added to the `cases` table, and at `db.js:332` and `db.js:352`, where the `<=>` operator expresses cosine distance. HNSW was chosen because the dataset is small enough that the index's memory cost is not a problem while it gives the lowest query latency for the recall required; the index is `idx_cases_embedding_hnsw ON cases USING hnsw (embedding vector_cosine_ops)` (`db.js:190`). Cosine distance was chosen because the magnitude of the embedding carries no useful meaning here [23], and `text-embedding-004` was chosen so that the embeddings come from the same vendor as the image-analysis model (Section 2.6), which reduces external dependencies and simplifies billing and credential management.

## 2.8 Implementation Technologies

This section reviews and justifies the main implementation-technology decisions for SnapPark.

### 2.8.1 Server-side Runtime: Node.js

Node.js is a JavaScript runtime built on the V8 engine with an event-driven, non-blocking I/O model that suits network-bound services well [25]. Other runtimes were considered: Python with FastAPI (a strong ecosystem, but the GIL and ASGI model make very high concurrency awkward), Go (good performance but a smaller ecosystem and a steeper learning curve), and Java with Spring Boot (mature and feature-rich, but a heavier memory footprint and slower startup than the size of SnapPark's services justifies). Node.js was chosen mainly because it lets the whole stack — Authentication, Violation Analysis, Notification, the API Gateway, and the Next.js front-end — be written in a single language, which cuts down on context switching, allows shared utilities, and simplifies onboarding.

### 2.8.2 HTTP Framework: Express

Express [26] was chosen over the more modern Fastify and NestJS. Fastify offers higher throughput but has a smaller plugin ecosystem and a less familiar API, and NestJS adds an opinionated structure that is more than SnapPark's scale needs. Express has a long history and a mature middleware ecosystem, and SnapPark uses several of those middleware packages directly: Helmet for security headers, `express-rate-limit` for IP-based throttling, and multer for handling multipart form uploads.

### 2.8.3 Front-end Framework: Next.js

Next.js (version 14, App Router) [27] is a React-based framework that can serve both server-rendered and client-rendered content from a single codebase. Other options were React with Vite (which would have meant building routing, build and server-rendering tooling by hand), Vue with Nuxt (comparable, but less familiar), and SvelteKit (promising, but with a smaller ecosystem at the time of evaluation). Next.js was chosen because it provides an opinionated setup that lets a working application be built with little configuration, because the React ecosystem is by far the largest of the front-end ecosystems, and because its server rendering keeps the initial load fast. The styling is done with Tailwind CSS, including the responsive breakpoints used on the upload and case-view pages.

### 2.8.4 Database: PostgreSQL

PostgreSQL is a mature, open-source, object-relational database that supports most of the SQL standard, gives strong transactional guarantees, has a rich type system, and has a large ecosystem of extensions, including pgvector (Section 2.7). The other options considered were MySQL/MariaDB (relational, but without an equivalent of pgvector), MongoDB (a flexible document store, but with weaker transactional guarantees and no SQL), and SQLite (an excellent embedded database, but a poor fit for a multi-process, multi-host architecture). PostgreSQL was chosen for the relational rigour SnapPark needs, its native JSON support, its vector search through pgvector, and its proven operational reliability [28].

### 2.8.5 Testing

The authentication service is tested with Jest and Supertest for HTTP-level assertions [29], while the gateway and the violation-analysis service are tested with Vitest and Supertest, and the Next.js front-end is tested with Vitest and React Testing Library [30]. Code coverage is measured with Istanbul [31], which produces the coverage metrics reported in the Evaluation chapter.

### 2.8.6 Summary

SnapPark is implemented with a Node.js back-end [25], Express as the HTTP framework, and a Next.js front-end with Tailwind CSS for styling and responsive layout. Each service has its own PostgreSQL database [28], with pgvector enabled for the Violation Analysis service [23]. JSON Web Tokens are used for authentication [9], and user passwords are hashed with bcrypt [32]. Every request is validated at the central API Gateway. The whole system is containerised with Docker [15], orchestrated locally with Docker Compose, and has a full set of production Kubernetes manifests [16]. This stack is the result of weighing the alternatives for each decision against the requirements of the project, and it balances developer productivity, operational simplicity, and engineering quality.

## 2.9 Related Work and Existing Systems

The sections above each review one of the technologies or patterns used inside SnapPark. This section looks outward instead, at systems and research that already exist around the same problem, so that it is clear where SnapPark sits among them and what gap it is trying to fill.

The general idea of letting ordinary people report problems in their environment is not new. Goodchild describes it as treating "citizens as sensors", where members of the public, rather than dedicated instruments or surveyors, become the source of geographic information [33]. This framing, often called volunteered geographic information or participatory sensing, is the background that civic-reporting applications are built on, and it is the same idea SnapPark relies on when a citizen photographs a badly parked car.

The best known systems built on this idea are civic crowd-reporting platforms. FixMyStreet, studied by King and Brown, lets a citizen report a local problem such as a pothole or a broken streetlight, attach a photo and a location, and have the report forwarded to the responsible council [34]. SeeClickFix and other systems built on the Open311 standard work in a similar way, providing an open interface through which reports flow between citizens and city departments [35]. These platforms are mature and widely deployed, but their role is essentially to route a report from a citizen to an authority. The judgement about whether the report is valid, and what it actually shows, is left entirely to a human official at the receiving end. There is no automated reasoning about the content of the photograph itself.

A second body of work is the smart-parking literature. The survey by Lin, Rivano and Le Mouël reviews a large number of systems whose aim is to manage parking, by detecting which spaces are free, guiding drivers to them, and in some cases handling payment, using fixed sensors in the road, cameras mounted on infrastructure, or data from the vehicles themselves [36]. This work is concerned with the efficient use of legal parking spaces rather than with the detection of illegal parking, and it depends on fixed, pre-installed infrastructure rather than on evidence submitted by the public.

Closer to SnapPark's actual task is the work on automated detection of illegal parking. Lee et al., for example, detect illegally parked vehicles from a fixed outdoor camera by analysing how long an object stays still in a monitored zone [37], and automatic number-plate recognition systems read plates from camera feeds to support enforcement [17]. These systems do reason automatically about parking, but they are tied to a particular fixed camera and a narrow, pre-defined rule, and they do not produce a human-readable explanation of their decision.

SnapPark sits in the gap between these three groups. Like the civic-reporting platforms it takes evidence submitted by ordinary citizens rather than from fixed infrastructure, but unlike them it does not simply forward the report: it uses a general multimodal AI model to reason about the content of the photograph and to produce a written explanation of its opinion [18]. Like the illegal-parking detectors it reasons automatically about a parking situation, but it is not limited to one fixed camera or one hard-coded rule, and it returns an explanation rather than a bare verdict. All of this is delivered through the microservices back-end described in the rest of this chapter. No single system in the reviewed work combines citizen-submitted evidence, general AI reasoning with an explanation, and an independently deployable service architecture in the way SnapPark does, and it is this combination that the project sets out to explore.

\newpage

# References

[1] M. Fowler, "MonolithFirst," martinfowler.com, Jun. 3, 2015. [Online]. Available: https://martinfowler.com/bliki/MonolithFirst.html

[2] N. Dragoni, S. Giallorenzo, A. L. Lafuente, M. Mazzara, F. Montesi, R. Mustafin, and L. Safina, "Microservices: Yesterday, Today, and Tomorrow," in *Present and Ulterior Software Engineering*, M. Mazzara and B. Meyer, Eds. Cham, Switzerland: Springer, 2017, pp. 195–216, doi: 10.1007/978-3-319-67425-4_12.

[3] T. Erl, *Service-Oriented Architecture: Concepts, Technology, and Design*. Upper Saddle River, NJ, USA: Prentice Hall, 2005.

[4] J. Lewis and M. Fowler, "Microservices: a definition of this new architectural term," martinfowler.com, Mar. 25, 2014. [Online]. Available: https://martinfowler.com/articles/microservices.html

[5] S. Newman, *Building Microservices: Designing Fine-Grained Systems*, 2nd ed. Sebastopol, CA, USA: O'Reilly Media, 2021.

[6] C. Pahl and P. Jamshidi, "Microservices: A Systematic Mapping Study," in *Proc. 6th Int. Conf. Cloud Computing and Services Science (CLOSER)*, 2016, pp. 137–146, doi: 10.5220/0005785501370146.

[7] D. Taibi, V. Lenarduzzi, and C. Pahl, "Architectural Patterns for Microservices: A Systematic Mapping Study," in *Proc. 8th Int. Conf. Cloud Computing and Services Science (CLOSER)*, 2018, pp. 221–232, doi: 10.5220/0006798302210232.

[8] C. Richardson, *Microservices Patterns: With Examples in Java*. Shelter Island, NY, USA: Manning Publications, 2018.

[9] M. Jones, J. Bradley, and N. Sakimura, "JSON Web Token (JWT)," Internet Engineering Task Force, RFC 7519, May 2015, doi: 10.17487/RFC7519.

[10] H. Garcia-Molina and K. Salem, "Sagas," in *Proc. ACM SIGMOD Int. Conf. Management of Data*, 1987, pp. 249–259, doi: 10.1145/38713.38742.

[11] R. T. Fielding, "Architectural styles and the design of network-based software architectures," Ph.D. dissertation, Dept. Inf. Comput. Sci., Univ. California, Irvine, CA, USA, 2000.

[12] gRPC Authors, "gRPC: A high-performance, open-source universal RPC framework," Cloud Native Computing Foundation. [Online]. Available: https://grpc.io

[13] S. Vinoski, "Advanced Message Queuing Protocol," *IEEE Internet Computing*, vol. 10, no. 6, pp. 87–89, Nov./Dec. 2006, doi: 10.1109/MIC.2006.116.

[14] J. Kreps, N. Narkhede, and J. Rao, "Kafka: A Distributed Messaging System for Log Processing," in *Proc. 6th Int. Workshop on Networking Meets Databases (NetDB)*, Athens, Greece, 2011.

[15] D. Merkel, "Docker: lightweight Linux containers for consistent development and deployment," *Linux Journal*, vol. 2014, no. 239, art. 2, Mar. 2014.

[16] B. Burns, B. Grant, D. Oppenheimer, E. Brewer, and J. Wilkes, "Borg, Omega, and Kubernetes," *ACM Queue*, vol. 14, no. 1, pp. 70–93, Jan./Feb. 2016, doi: 10.1145/2898442.2898444.

[17] S. Du, M. Ibrahim, M. Shehata, and W. Badawy, "Automatic License Plate Recognition (ALPR): A State-of-the-Art Review," *IEEE Trans. Circuits Syst. Video Technol.*, vol. 23, no. 2, pp. 311–325, Feb. 2013, doi: 10.1109/TCSVT.2012.2203741.

[18] Gemini Team, Google, "Gemini: A Family of Highly Capable Multimodal Models," arXiv:2312.11805, Dec. 2023. [Online]. Available: https://arxiv.org/abs/2312.11805

[19] OpenAI, "GPT-4 Technical Report," arXiv:2303.08774, Mar. 2023. [Online]. Available: https://arxiv.org/abs/2303.08774

[20] Anthropic, "The Claude 3 Model Family: Opus, Sonnet, Haiku," Model Card, Mar. 2024. [Online]. Available: https://www.anthropic.com/news/claude-3-family

[21] T. Mikolov, K. Chen, G. Corrado, and J. Dean, "Efficient Estimation of Word Representations in Vector Space," arXiv:1301.3781, 2013. [Online]. Available: https://arxiv.org/abs/1301.3781

[22] Y. A. Malkov and D. A. Yashunin, "Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 42, no. 4, pp. 824–836, Apr. 2020, doi: 10.1109/TPAMI.2018.2889473.

[23] A. Kane, "pgvector: Open-source vector similarity search for Postgres," GitHub repository, 2021. [Online]. Available: https://github.com/pgvector/pgvector

[24] P. J. Sadalage and M. Fowler, *NoSQL Distilled: A Brief Guide to the Emerging World of Polyglot Persistence*. Upper Saddle River, NJ, USA: Addison-Wesley, 2012.

[25] S. Tilkov and S. Vinoski, "Node.js: Using JavaScript to Build High-Performance Network Programs," *IEEE Internet Computing*, vol. 14, no. 6, pp. 80–83, Nov./Dec. 2010, doi: 10.1109/MIC.2010.145.

[26] OpenJS Foundation, "Express — Node.js web application framework." [Online]. Available: https://expressjs.com

[27] Vercel, "Next.js Documentation." [Online]. Available: https://nextjs.org/docs

[28] M. Stonebraker and L. A. Rowe, "The Design of POSTGRES," in *Proc. ACM SIGMOD Int. Conf. Management of Data*, 1986, pp. 340–355, doi: 10.1145/16894.16888.

[29] Meta Open Source, "Jest: Delightful JavaScript Testing." [Online]. Available: https://jestjs.io

[30] Vitest Team, "Vitest: Next Generation Testing Framework." [Online]. Available: https://vitest.dev

[31] Istanbul Authors, "Istanbul: JavaScript test coverage made simple." [Online]. Available: https://istanbul.js.org

[32] N. Provos and D. Mazières, "A Future-Adaptable Password Scheme," in *Proc. USENIX Annu. Tech. Conf., FREENIX Track*, 1999, pp. 81–91.

[33] M. F. Goodchild, "Citizens as sensors: the world of volunteered geography," *GeoJournal*, vol. 69, no. 4, pp. 211–221, Dec. 2007, doi: 10.1007/s10708-007-9111-y.

[34] S. F. King and P. Brown, "Fix my street or else: using the internet to voice local public service concerns," in *Proc. 1st Int. Conf. Theory and Practice of Electronic Governance (ICEGOV)*, 2007, pp. 72–80, doi: 10.1145/1328057.1328076.

[35] D. Offenhuber, "Infrastructure legibility—a comparative analysis of open311-based citizen feedback systems," *Cambridge Journal of Regions, Economy and Society*, vol. 8, no. 1, pp. 93–112, Mar. 2015, doi: 10.1093/cjres/rsu001.

[36] T. Lin, H. Rivano, and F. Le Mouël, "A Survey of Smart Parking Solutions," *IEEE Trans. Intell. Transp. Syst.*, vol. 18, no. 12, pp. 3229–3253, Dec. 2017, doi: 10.1109/TITS.2017.2685143.

[37] J. T. Lee, M. S. Ryoo, M. Riley, and J. K. Aggarwal, "Real-time illegal parking detection in outdoor environments using 1-D transformation," *IEEE Trans. Circuits Syst. Video Technol.*, vol. 19, no. 7, pp. 1014–1024, Jul. 2009, doi: 10.1109/TCSVT.2009.2020249.
