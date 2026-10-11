# System Design Academy: Plan

## Goal
A visual, interactive site that teaches how software systems are designed: scaling, data, messaging, reliability, and the classic design patterns. Each concept is taught with a diagram, a step-by-step animation, something to play with, and code only where code actually helps.

## Direction change (recorded so the history makes sense)
The project began as "Design Patterns Academy" covering the 23 Gang of Four patterns. It is now a broader collection of system design concepts, and the GoF patterns are kept as one area.

## Decisions
| Topic | Decision |
|---|---|
| Stack | Astro 5 + TypeScript, static output, vanilla TS for interactivity |
| Hosting | GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`) |
| Areas | Scaling & infrastructure, Data & consistency, Messaging & async, Reliability & resilience, API design, Security, Observability, Networking, Distributed systems, Cloud & deployment, Databases & storage, Design patterns |
| Teaching format for concepts | Simulation first. Diagram, animation, interactive simulation, trade-offs. JS, Python and C# code only when a concept has meaningful code |
| Languages | JavaScript and C# at launch, Python added later; more through `languages.config.ts` |
| Case studies ("design a URL shortener") | Later, once concepts exist, linking back to them |

## Two content types
Both live in `src/content/<collection>/<slug>/`, are found automatically, and appear in one searchable catalog.

**Design pattern** (`patterns`): meta.json with problem, solution, roles, before/after; `code/` and `before/` per language; `visuals/diagram.json` (UML) and `visuals/steps.json`; a playground. URL: `/patterns/<slug>/`.

**Concept** (`concepts`): meta.json with problem, `howItWorks` steps, pros, cons, when to use, pitfalls, related concepts and patterns; `visuals/steps.json` (animation of a request or data flow); optional `code/`; a simulation in `src/playgrounds/<Name>Playground.astro`. URL: `/concepts/<slug>/`.

Concept page order: problem, how it works, watch it flow, simulate it, trade-offs, code (if any), judgment, related.

## Wave 1 roadmap (4 areas, 24 concepts)
Status: all four wave 1 areas are complete (24 of 24 concepts). Load Balancing is the reference implementation. The system design compare page (`/compare-concepts/`) is done. Sixty-one case studies are done, covering every area (`url-shortener` is the reference, then `rate-limiter-service`, `notification-system`, `chat-system`, `news-feed`, `video-streaming`, `ride-sharing`, `payment-system`, `search-autocomplete`, `web-crawler`, `key-value-store`, `file-sync`, `ticket-booking`, `metrics-monitoring`, `unique-id-generator`, `collaborative-editor`, `job-scheduler`, `leaderboard`, `stock-exchange`, `hotel-reservation`, `proximity-service`, `ecommerce-checkout`, `distributed-lock-service`, `object-storage`, `ad-click-aggregation`, `message-queue-service`, `photo-sharing`, `email-service`, `code-deployment`, `food-delivery`, `digital-wallet`, `feature-flag-service`, `log-aggregation`, `video-conferencing`, `recommendation-system`, `distributed-cache`, `social-graph`, `container-orchestrator`, `serverless-platform`, `time-series-database`, `search-engine`, `data-warehouse`, `distributed-sql-database`, `change-data-capture-pipeline`, `zero-downtime-database-migration`, `authentication-system`, `secrets-vault`, `ddos-protection-service`, `api-gateway`, `webhook-delivery-platform`, `content-delivery-network`, `global-dns-service`, `load-balancer-service`, `distributed-tracing-system`, `service-mesh`, `cluster-membership-service`, `shopping-cart-service`, `workflow-engine`, `ci-cd-system`, `multi-tenant-saas` and `database-connection-pooler`). Python samples exist for every JS and C# sample. Next: decide between more case studies and another area.

**Scaling & infrastructure** (done): load balancing, caching, CDN, horizontal vs vertical scaling, database sharding, database replication
**Data & consistency** (done): CAP theorem, ACID vs BASE, consistency models, database indexing, SQL vs NoSQL, consistent hashing
**Messaging & async** (done): message queues, pub/sub, event sourcing, CQRS, saga, transactional outbox
**Reliability & resilience** (done): rate limiting, circuit breaker, retries and backoff, idempotency, bulkhead, backpressure

## Wave 2
**API design** (done): API styles (REST, GraphQL, gRPC), pagination, API versioning, authentication and authorization, API gateway, webhooks
**Security** (done): password hashing, TLS and HTTPS, encryption, secrets management, injection and XSS, CSRF and CORS
**Observability** (done): structured logging, metrics, distributed tracing, SLOs and error budgets, alerting, health checks
**Networking** (done): DNS, TCP vs UDP, HTTP versions, proxies, real-time communication, latency and round trips
**Distributed systems** (done): leader election, consensus, quorums, logical clocks, gossip protocol, two-phase commit
**Databases & storage** (done, wave 3): LSM trees vs B-trees (the reference concept for this area), write-ahead log and crash recovery, MVCC and isolation levels, query planning and joins, online schema migrations, backups and point-in-time recovery
**Cloud & deployment** (done, wave 3): canary deployments (the reference concept for this area), blue-green and rolling deployments, feature flags, autoscaling, containers and orchestration, infrastructure as code, multi-region failover
Next candidates: data engineering (batch and stream processing); more cloud and deployment concepts (service mesh, GitOps, cost management); more case studies (a payments gateway, a social media timeline, a graph database, a recommendation feature store).

Simulation ideas: caching (hit/miss ratio with eviction policies), sharding and consistent hashing (add or remove a node and watch keys move), CAP (partition the network and choose consistency or availability), rate limiting (token bucket vs sliding window), circuit breaker (open/half-open/closed under failing calls), message queues (producers, consumers, a slow consumer).

## Later
- More areas: data engineering (batch and stream processing), cloud and deployment
- Lighthouse performance check; deploy

## Status
- Design patterns: all 23 built, with JS, Python and C# samples (verified by `npm run check:samples`)
- Site generalised: area-based catalog with search and filters, concept pages, breadcrumbs, `/compare/` for patterns
- Accessibility pass done (axe-core clean in light and dark, keyboard checks)
- Concepts: 67 across eleven areas (waves 1 to 3), each with a diagram, an animation, a simulation, and JS, C# and Python samples where there is meaningful code
- Case studies: 61 (every area has at least one), each with a build-up diagram, an estimator, a break-it simulation and JS, C# and Python samples
