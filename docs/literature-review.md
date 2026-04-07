# Literature Review

This chapter analyses in detail the trajectory of the architectural paradigms. The historical development of the monolithic system to Service-Oriented Architecture to finally adopting Microservices Architecture is also covered in this chapter. The technical challenges for each system will also be analyzed.

## Architecture Paradigms

### Monolithic Architecture

The monolithic architecture is the basic process of software design. All of the key components, such as domains, user interface, business logic, and data access, are combined into a single code base, which can be deployed afterwards [1].

This is a major strength since it makes the debugging, development, and testing processes easier, but it can result in a major weakness as the application grows. The most important example is the tight-coupling system, where all the application components depend on one another, and this simultaneously makes the system unstable. This makes a small change in one component affect the entire system, making it unstable and extremely costly to maintain [2]. The monolithic architecture faces challenges in the current CI/CD pipeline [1]. This is because small bugs may need the application to recompile and reploy, increasing the chances for downtimes. An important point is that the Vertical Scaling can be extremely costly since one needs to add more power to one server.

### Service-Oriented Architecture (SOA)

The problem with the scaling was addressed by the Service-Oriented Architecture by breaking the application down into several services that talk to each other through the network [5]. This is also able to make all the parts of the system reusable. The Enterprise Service Bus is the main part of the SOA implementation. This is the part that is dealing with the routing, the data translation, as well as the business logic; basically, it is the main pipeline that connects all the others [4]. The main problem is that the ESB is a huge single point that is dealing with all the logic, as opposed to making the services independent; it is a main bus that is a bottleneck [6]. They also used protocols such as SOAP, which is slowing down the network due to the complexity of the data formats [5].

## Cloud Computing

Cloud computing must first be defined before the definition of the concept of the Cloud Continuum. Cloud computing is defined as computing services; processing power, storage, networking, and software delivered on-as-you-need-it basis over the internet, with the user paying at the rates of what is actually used [13]. This model eliminates the necessity of the organization to invest and keep physical infrastructure dedicated to a system, as opposed to physical and locally controlled hardware replacing the flexible virtualized computing.

Nevertheless, even though Cloud Computing has its advantages, it has created restrictions concerning the physical location of cloud services. Network latency is a performance bottleneck in cases where cloud data centers are far apart in geographical locations and single-user or single-edge devices. Time sensitive applications are susceptible to this type of latency and cannot be addressed only by augmenting computational power or increasing processing power in the cloud [7], [9]. This difficulty has brought up the necessity of architectural strategies that are sensitive to both calculation and distance driving the development towards distributed designs like the Cloud Continuum.

## Cloud Continuum

Computing, as a result of the evolution of the systems, is not only in large data centers. The need to distribute computing capacity from the cloud down to the edge of the network and extending to IoT devices such as sensors and smart machines resulted in the formation of the concept of the Cloud Continuum [7].

IoT devices are increasing in number and revolutionizing the way software is being developed. Computing power is not in one place but is distributed in a number of devices with varying capabilities [8]. For applications that demand quick responses, the delay in transmitting the data to a far-off cloud is a problem.

It has been observed in research that due to certain constraints such as congestion in the cloud and the time taken to travel, cloud-exclusive solutions are not ideal for real-time and autonomous systems [14]. One such example is the case of precision farming. In autonomous farming, the tractor may employ cameras to identify weeds while it is in motion. If the images are to be processed in a cloud server, the response may be late, and the tractor may have already moved past the weeds [9]. To overcome this issue, the data should be processed in a nearby region, close to where it is generated, in the edge region, perhaps in a base station or in the device itself, where the time taken is minimal [7], [14].

## Microservices Architecture

Microservices are sometimes known as SOA done right, with no mistakes [15]. It is not Smart pipes of ESB but Smart Endpoints and Dumb Pipes [15]. It means that logic is embedded into the services, and the network communication is maintained as low as possible, normally, through a lightweight RESTful API or gRPC [15, 2].

The Microservices are optimal in the Cloud Continuum, where Hyper-distribution can be achieved [2]. The microservices might be spread to alternative hardware (as opposed to a monolith which is on one location). This makes it possible to have Image Capture Service deployed to the Edge (the front-end of the site) to be speedy and Data Archive Service deployed to the Cloud to be efficient [7]. In this architecture, Polyglot Programming is also supported. This is important in the case of SnapPark because we might have to run the AI and Computer Vision tasks with Python and the routing high-speed tasks with the use of Node.js because each of them might be the best suitable tool that would execute a specific task [15].

### Advantages

Microservices overcome a lot of the limitations of the Monolithic system and the SOA because microservices can be developed, deployed, and scaled independently. In comparison to monoliths, in which even the failure of one of the modules may lead to the system-wide crash, microservices provide better fault isolation [2]. Besides, the structure offers important sources of organizational benefits (The Law of Conway), to be able to decouple large engineering teams into small, independent teams and release features in parallel. Lastly is the polyglot programmability, where developers can choose the best technology stack in a given area of the problem, like Python-based AI-based analytics and Go or Node.js-based edge work [7].

### Disadvantages

In spite of these advantages, microservices also create significant complexity, also known as the Microservice Premium. The system distributed characteristic substitutes in-process calls to functions with network requests, which bring on latency and additional failure modes [5]. One of them is Observability; with a distributed system, one user request can be routed through dozens of services, so tracking down errors without deploying complicated distributed tracing infrastructure is hard [2]. Also, Data Consistency is much more difficult to control and patterns such as Saga and Event Sourcing are necessary.

## Choice of Architecture

Microservices were chosen as the basis of the SnapPark webpage after the analysis of these paradigms. The reason why monolithic systems were dismissed is that they do not support the granular, decentralized deployment that is required to support the Cloud Continuum [1, 7]. SOA has been discarded due to the bottlenecks in performance of the ESB and the bulky SOAP protocols not being fit for the needs of a modern real-time site that needs high speed [4, 6].

## Domain-Driven Design (DDD)

Probably the most difficult design issue to consider is developing the boundaries of microservices. Wrong boundaries will create a "Distributed Monolith," a combination of the poor features of both architectures. To avoid this, Domain-Driven Design (DDD) is used, namely, the notion of the Bounded Contexts. This makes sure that services are partitioned based on business domains (e.g., "Inventory" vs. "Billing") and not technical layers which makes services very cohesive and the services very loosely coupled. One of the elements of DDD is a definition of a Ubiquitous Language. This will see to it that the terms adopted in the code are an absolute match to the language in which the business stakeholders find themselves. When all these languages are entrenched in the Bounded Contexts, the developers will not have to deal with ambiguity. To take an example, a User in a Billing Context may be defined as a credit card number, whereas a User in a Shipping Context may be defined as an address in which the goods are delivered. The definitions are clearly defined by DDD, which avoids the production of a fat, common data model, which establishes implicit dependencies across the services [2].

## Database per Service Pattern

Decentralization of data persistence is one of the most significant changes distributed architecture has witnessed. Microservices impose a Database per Service pattern in order to achieve actual isolation [13]. This strategy gives development teams the freedom to choose the best storage technology to use in their particular case a phenomenon called Polyglot Persistence. Although this isolation will prevent the unwanted corruption of data of one service by another, it will necessitate a change between Strong Consistency and Eventual Consistency. External inconsistencies are temporary and the developers are required to make the system resilient to these anomalies.

## Command Query Responsibility Segregation (CQRS)

Database isolation also makes the data retrieval more difficult, since it makes it impossible to use standard SQL JOIN across the services. In order to address this, Command Query Responsibility Segregation (CQRS) pattern has often been embraced. The basis of CQRS is that it separates the data model into two separate directions: a Command model that will be used to write/update data, and a Query model that will be used to read [11]. This trend is especially useful in those cases when the read and write workloads are unbalanced, such as in a parking application where many users (thousands) may look at a parking space (High Read) but only one user may update its occupancy (Low Write). The Read database can be scaled without the Write database in order to accommodate the traffic load by scaling the Read database.

## Event Sourcing

Closely tied to CQRS is Event Sourcing. This approach builds up the current state using an immutable list of events. In our example, instead of only recording the current state (e.g. "The car is parked"), we record a series of facts as events (e.g. "CarArrived," "ParkingPaid," "CarDeparted") in an Event Store. To determine our current state, we replay these events. This provides a perfect audit history and allows us to determine at what point our application state was at a particular point. In our application and other distributed systems, this source of truth drives our Read Models and pushes events into Pub/Sub for other microservices to consume.

## Saga Pattern

However, in order to keep a number of distributed services in a synchronized fashion without a centralized database, certain ACID properties have to be sacrificed. In the case of a transaction that involves multiple services (for example, checking the availability of stocks and paying for parking), a service cannot inform another of a failure without the use of locks. The Saga Pattern is used to improve the situation by considering a distributed transaction as a set of local transactions. Compensation transactions (certain undo transactions) are used to reverse the process in case of a failure. There are two methods of implementing a Saga.

## Communication

Communication is how different parts of the system interact with each other. In microservices systems, all parts do not run in one place; it is necessary to have good communication over the network so they can run smoothly as separate services [2],[10]. The service communication affects: Speed, Reliability, and Scalability [2],[23]. If the communication is deficient, the system runs more slowly, it is not reliable once it fails, or the number of users it can handle at one time [2]. In SnapPark terms, image analysis may be lagging, the reasoning why it's not parked properly may not be accurate, the explanation may not match the image that was shared, or users may wait too long for an explanation.

### Service Discovery

While we addressed how services communicate with each other, now we delve into how they find each other to communicate. Services may scale dynamically or change their location during runtime [18],[14]. Service Discovery allows SnapPark to locate each service during runtime [18]. Instead of deciding service addresses and hard-coding them it works out the location while running, it registers the network location when the service starts with the service registry [18]. Services query the registry to find the exact location. Using this implementation, services can restart and relocate without any manual configuration. Not having to worry about the most important defects of the service communication, like Reliability and Scalability [14].

### Synchronous vs. Asynchronous (Pub/Sub)

In microservices-based systems, the communication between services can be implemented in the form of synchronous or asynchronous mechanisms. The choice of communication model has a direct impact on the system performance, reliability and scalability of the system. Synchronous communication follows a model of request - response communication in which one service sends a request to another service, and waits for a response before continuing the execution. This approach is simple and intuitive but it brings closer coupling between services and sensitivity to latency and failures of services [2], [10].

Asynchronous communication provides services with the ability to exchange information without needing an immediate response. A common implementation for this model is the Publish/Subscribe (Pub/Sub) communication, in which services publish events to a message broker and other services subscribe to the events that they are interested in. This disassociates services from time and execution which helps improve system resilience and scalability. Asynchronous communication is especially useful for workloads that can be executed in the background or yet another is a large number of consumers responding to the same occasion [10], [23].

In the context of SnapPark, both communication models are needed and they have different roles. Synchronous communication is required for user-facing interaction such as submitting an image and receiving a decision for whether a parking situation looks illegal or not along with an explanation. In these cases, users are expecting to get an immediate response. Asynchronous Pub/Sub communication is better suited for communications like storing analysis result, triggering explanation generation pipeline, update analytics or even log events for future improvement of models. By using a mix of synchronous and asynchronous communication, SnapPark provides low user feedback latency and can also scale and remain reliable as the system grows and becomes more taxing.

## References

[1] Martin Fowler, "MonolithFirst," martinfowler.com, 2015. [Online]. Available: https://martinfowler.com/bliki/MonolithFirst.html

[2] Sam Newman, "Microservices," samnewman.io, 2014. [Online]. Available: https://samnewman.io/patterns/architectural/microservices/

[3] P. Di Francesco, "Research on Architecting Microservices," IEEE Software (Open Access version), 2017. [Available for free on ResearchGate]

[4] AWS, "What is an Enterprise Service Bus (ESB)?," Amazon Web Services, 2024. [Online]. Available: https://aws.amazon.com/what-is/enterprise-service-bus/

[5] IBM, "What is SOA (Service-Oriented Architecture)?," IBM Documentation, 2023. [Online]. Available: https://www.ibm.com/topics/soa

[6] Microsoft Azure, "API Gateway pattern," Microsoft Learn, 2023. [Online]. Available: https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-routing

[7] S. Dustdar, "The Edge-Cloud Continuum," IEEE Internet Computing, 2020. [Available for free on ResearchGate]

[8] Docker Documentation, "Docker Overview," Docker Docs, 2024. [Online]. Available: https://docs.docker.com/get-started/overview/

[9] M. Satyanarayanan, "The Emergence of Edge Computing," IEEE Computer, 2017. [Available for free on CMU website]

[10] Chris Richardson, "Microservice Architecture Patterns," Microservices.io, 2023. [Online]. Available: https://microservices.io/

[11] Microsoft Azure, "CQRS Pattern," Microsoft Learn, 2023. [Online]. Available: https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs

[12] Martin Fowler, "Event Sourcing," martinfowler.com, 2005. [Online]. Available: https://martinfowler.com/eaaDev/EventSourcing.html

[13] AWS, "Database-per-service," AWS Prescriptive Guidance, 2024. [Online]. Available: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/database-per-service.html

[14] Kubernetes, "What is Kubernetes?," Kubernetes.io, 2024. [Online]. Available: https://kubernetes.io/docs/concepts/overview/

[15] J. Lewis and M. Fowler, "Microservices," martinfowler.com, 2014. [Online]. Available: https://martinfowler.com/articles/microservices.html

[16] V. Velepucha et al., "A Survey on Microservices Architecture: Principles, Patterns and Migration Challenges," 2022.

[17] D. Taibi et al., "Architectural Patterns for Microservices: A Systematic Mapping," 2025.

[18] C. Richardson, "Service Discovery Patterns," microservices.io, 2015.
