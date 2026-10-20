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
| Areas | Scaling & infrastructure, Data & consistency, Messaging & async, Reliability & resilience, API design, Security, Observability, Networking, Distributed systems, Cloud & deployment, Databases & storage, Data engineering, Design patterns |
| Teaching format for concepts | Simulation first. Diagram, animation, interactive simulation, trade-offs. JS, Python and C# code only when a concept has meaningful code |
| Languages | JavaScript and C# at launch, Python added later; more through `languages.config.ts` |
| Case studies ("design a URL shortener") | Later, once concepts exist, linking back to them |

## Two content types
Both live in `src/content/<collection>/<slug>/`, are found automatically, and appear in one searchable catalog.

**Design pattern** (`patterns`): meta.json with problem, solution, roles, before/after; `code/` and `before/` per language; `visuals/diagram.json` (UML) and `visuals/steps.json`; a playground. URL: `/patterns/<slug>/`.

**Concept** (`concepts`): meta.json with problem, `howItWorks` steps, pros, cons, when to use, pitfalls, related concepts and patterns; `visuals/steps.json` (animation of a request or data flow); optional `code/`; a simulation in `src/playgrounds/<Name>Playground.astro`. URL: `/concepts/<slug>/`.

Concept page order: problem, how it works, watch it flow, simulate it, trade-offs, code (if any), judgment, related.

## Wave 1 roadmap (4 areas, 24 concepts)
Learning features (progress, paths, guided practice panel, case-study search, quizzes on every page, spaced review, whole-site search) are done; see the README. Status: all four wave 1 areas are complete (24 of 24 concepts). Load Balancing is the reference implementation. The system design compare page (`/compare-concepts/`) is done. One hundred and twenty-five case studies are done, covering every area (`url-shortener` is the reference, then `rate-limiter-service`, `notification-system`, `chat-system`, `news-feed`, `video-streaming`, `ride-sharing`, `payment-system`, `search-autocomplete`, `web-crawler`, `key-value-store`, `file-sync`, `ticket-booking`, `metrics-monitoring`, `unique-id-generator`, `collaborative-editor`, `job-scheduler`, `leaderboard`, `stock-exchange`, `hotel-reservation`, `proximity-service`, `ecommerce-checkout`, `distributed-lock-service`, `object-storage`, `ad-click-aggregation`, `message-queue-service`, `photo-sharing`, `email-service`, `code-deployment`, `food-delivery`, `digital-wallet`, `feature-flag-service`, `log-aggregation`, `video-conferencing`, `recommendation-system`, `distributed-cache`, `social-graph`, `container-orchestrator`, `serverless-platform`, `time-series-database`, `search-engine`, `data-warehouse`, `distributed-sql-database`, `change-data-capture-pipeline`, `zero-downtime-database-migration`, `authentication-system`, `secrets-vault`, `ddos-protection-service`, `api-gateway`, `webhook-delivery-platform`, `content-delivery-network`, `global-dns-service`, `load-balancer-service`, `distributed-tracing-system`, `service-mesh`, `cluster-membership-service`, `shopping-cart-service`, `workflow-engine`, `ci-cd-system`, `multi-tenant-saas` `database-connection-pooler`, `stream-processing-engine`, `batch-processing-framework`, `lakehouse-platform`, `data-pipeline-orchestrator`, `feature-store`, `data-catalog-and-lineage`, `graph-database`, `vector-database`, `usage-metering-and-billing`, `alerting-and-on-call-system`, `audit-log-system`, `chaos-engineering-platform`, `presence-service`, `configuration-management-service` `multi-region-active-active`, `double-entry-ledger`, `matchmaking-service`, `live-comments-and-reactions`, `graphql-federation-gateway`, `fraud-detection-system`, `web-application-firewall`, `container-registry`, `olap-analytics-engine` `backup-and-restore-service`, `online-auction-system`, `sms-otp-delivery-service`, `identity-provider-sso`, `error-tracking-service`, `distributed-file-system`, `document-database`, `experimentation-platform`, `bulk-import-export-service` `vpn-gateway-service`, `live-streaming-platform`, `incident-management-platform`, `preview-environments-platform`, `inventory-management-system`, `key-management-service`, `continuous-profiling-platform`, `coordination-service`, `wide-column-store`, `data-quality-monitoring-platform`, `event-streaming-platform`, `delayed-job-and-timer-service`, `developer-api-platform`, `websocket-gateway`, `service-discovery-registry`, `distributed-transaction-coordinator`, `content-moderation-pipeline`, `progressive-delivery-platform` and `mobile-backend-for-frontend`, `llm-inference-gateway`, `rag-platform`, `gpu-cluster-scheduler`, `ai-agent-orchestration-platform`, `llm-evaluation-platform`, `model-registry-and-serving-platform`, `payment-disputes-and-chargebacks`, `offline-first-sync-engine`, `search-relevance-pipeline`, `data-deletion-and-privacy-platform`, `virtual-waiting-room`, `maps-and-routing-service` and `package-registry`). Python samples exist for every JS and C# sample. Next: decide between more case studies and another area.

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
**Wave 5: Data engineering** (done): batch-vs-stream-processing, mapreduce-and-shuffles, windowing-and-watermarks, stateful-stream-processing, pipeline-orchestration, columnar-formats-and-partitioning, table-formats-and-the-lakehouse, slowly-changing-dimensions.

**Wave 6: AI & ML systems** (done): embeddings-and-vector-search, retrieval-augmented-generation, llm-inference-and-kv-cache, continuous-batching-and-model-serving, llm-caching-and-routing, model-evaluation-and-drift, guardrails-and-prompt-injection, distributed-training-and-parallelism.

**Wave 4: depth in thinner areas** (done): Security: oauth-and-openid-connect, jwt-and-session-tokens, access-control-models, supply-chain-security. Observability: cardinality-and-sampling, profiling-and-flame-graphs, red-use-and-golden-signals, synthetic-monitoring-and-rum. Networking: tcp-congestion-control, http-caching-headers, anycast-and-bgp-routing, cidr-and-subnetting. API design: graphql-n-plus-one-and-dataloader, schema-evolution-and-compatibility, optimistic-concurrency-and-etags, async-apis-and-long-running-operations. Reliability: timeouts-and-deadlines, load-shedding, graceful-degradation, hedged-requests-and-tail-latency, queueing-theory-and-littles-law. Distributed systems: crdts, merkle-trees-and-anti-entropy, failure-detection, leases-and-fencing-tokens. Messaging: delivery-guarantees, dead-letter-queues-and-poison-messages, ordering-and-partitioning
**Databases & storage** (done, wave 3): LSM trees vs B-trees (the reference concept for this area), write-ahead log and crash recovery, MVCC and isolation levels, query planning and joins, online schema migrations, backups and point-in-time recovery
**Cloud & deployment** (done, wave 3): canary deployments (the reference concept for this area), blue-green and rolling deployments, feature flags, autoscaling, containers and orchestration, infrastructure as code, multi-region failover
Next candidates: data engineering (batch and stream processing); more cloud and deployment concepts (service mesh, GitOps, cost management); more case studies (a payments gateway, a social media timeline, a graph database, a recommendation feature store).

Simulation ideas: caching (hit/miss ratio with eviction policies), sharding and consistent hashing (add or remove a node and watch keys move), CAP (partition the network and choose consistency or availability), rate limiting (token bucket vs sliding window), circuit breaker (open/half-open/closed under failing calls), message queues (producers, consumers, a slow consumer).

## Later
- More areas: none queued; propose the next one
- Lighthouse performance check; deploy

## Status
- Design patterns: all 23 built, with JS, Python and C# samples (verified by `npm run check:samples`)
- Site generalised: area-based catalog with search and filters, concept pages, breadcrumbs, `/compare/` for patterns
- Accessibility pass done (axe-core clean in light and dark, keyboard checks)
- Concepts: 111 across thirteen areas (waves 1 to 6, including AI & ML systems: waves 3 and 4 added Cloud & deployment, Databases & storage, Data engineering, and 28 deeper concepts in Security, Observability, Networking, API design, Reliability, Distributed systems and Messaging), each with a diagram, an animation, a simulation, and JS, C# and Python samples where there is meaningful code
- Case studies: 61 (every area has at least one), each with a build-up diagram, an estimator, a break-it simulation and JS, C# and Python samples
