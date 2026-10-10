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
| Areas | Scaling & infrastructure, Data & consistency, Messaging & async, Reliability & resilience, API design, Security, Observability, Networking, Distributed systems, Design patterns |
| Teaching format for concepts | Simulation first. Diagram, animation, interactive simulation, trade-offs. JS and C# code only when a concept has meaningful code |
| Languages | JavaScript and C# at launch; more later through `languages.config.ts` |
| Case studies ("design a URL shortener") | Later, once concepts exist, linking back to them |

## Two content types
Both live in `src/content/<collection>/<slug>/`, are found automatically, and appear in one searchable catalog.

**Design pattern** (`patterns`): meta.json with problem, solution, roles, before/after; `code/` and `before/` per language; `visuals/diagram.json` (UML) and `visuals/steps.json`; a playground. URL: `/patterns/<slug>/`.

**Concept** (`concepts`): meta.json with problem, `howItWorks` steps, pros, cons, when to use, pitfalls, related concepts and patterns; `visuals/steps.json` (animation of a request or data flow); optional `code/`; a simulation in `src/playgrounds/<Name>Playground.astro`. URL: `/concepts/<slug>/`.

Concept page order: problem, how it works, watch it flow, simulate it, trade-offs, code (if any), judgment, related.

## Wave 1 roadmap (4 areas, 24 concepts)
Status: all four wave 1 areas are complete (24 of 24 concepts). Load Balancing is the reference implementation. The system design compare page (`/compare-concepts/`) is done. Six case studies are done (`url-shortener` is the reference, then `rate-limiter-service`, `notification-system`, `chat-system`, `news-feed` and `video-streaming`). Next: decide between more case studies, more areas, or a Python sample set.

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
Next candidates: more case studies (ride sharing); data engineering; cloud and deployment; Python as a third language.

Simulation ideas: caching (hit/miss ratio with eviction policies), sharding and consistent hashing (add or remove a node and watch keys move), CAP (partition the network and choose consistency or availability), rate limiting (token bucket vs sliding window), circuit breaker (open/half-open/closed under failing calls), message queues (producers, consumers, a slow consumer).

## Later
- More areas: data engineering (batch and stream processing), cloud and deployment
- Python as the third language
- Lighthouse performance check; deploy

## Status
- Design patterns: all 23 built, with JS and C# samples (verified by `npm run check:samples`)
- Site generalised: area-based catalog with search and filters, concept pages, breadcrumbs, `/compare/` for patterns
- Accessibility pass done (axe-core clean in light and dark, keyboard checks)
- Concepts: 18 of 24 in wave 1 (Scaling & infrastructure, Data & consistency, Messaging & async)
