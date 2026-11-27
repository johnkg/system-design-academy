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
| Areas | Scaling & infrastructure, Data & consistency, Messaging & async, Reliability & resilience, API design, Security, Observability, Networking, Distributed systems, Cloud & deployment, Databases & storage, Data engineering, AI & ML systems, Design patterns |
| Teaching format for concepts | Simulation first. Diagram, animation, interactive simulation, trade-offs. JS, Python and C# code only when a concept has meaningful code |
| Languages | JavaScript and C# at launch, Python added later; more through `languages.config.ts` |
| Case studies ("design a URL shortener") | Later, once concepts exist, linking back to them |

## Two content types
Both live in `src/content/<collection>/<slug>/`, are found automatically, and appear in one searchable catalog.

**Design pattern** (`patterns`): meta.json with problem, solution, roles, before/after; `code/` and `before/` per language; `visuals/diagram.json` (UML) and `visuals/steps.json`; a playground. URL: `/patterns/<slug>/`.

**Concept** (`concepts`): meta.json with problem, `howItWorks` steps, pros, cons, when to use, pitfalls, related concepts and patterns; `visuals/steps.json` (animation of a request or data flow); optional `code/`; a simulation in `src/playgrounds/<Name>Playground.astro`. URL: `/concepts/<slug>/`.

Concept page order: problem, how it works, watch it flow, simulate it, trade-offs, code (if any), judgment, related.

## Wave 1 roadmap (4 areas, 24 concepts)
Learning features (progress, paths, guided practice panel, case-study search, quizzes on every page, spaced review, whole-site search) are done; see the README. Status: all four wave 1 areas are complete (24 of 24 concepts). Load Balancing is the reference implementation. The system design compare page (`/compare-concepts/`) is done. Case studies cover every area; the list is the folder `src/content/studies/` (`url-shortener` is the reference, then `rate-limiter-service`, `notification-system`, `chat-system`). Current counts: run `npm run check:content`, which prints the number of pages and quiz questions. Python samples exist for every JS and C# sample. Next: decide between more case studies and another area.

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
**Cloud & deployment** (done, wave 3): canary deployments (the reference concept for this area), blue-green and rolling deployments, feature flags, autoscaling, containers and orchestration, infrastructure as code, multi-region failover, GitOps and cloud cost management (added later)
**Wave 7: three new areas** (done): Search systems (bm25-and-relevance-ranking, segments-and-near-real-time-indexing, distributed-search-scatter-gather, autocomplete-and-typeahead, search-quality-evaluation, plus the existing inverted-indexes-and-text-search), Payments & money (money-representation-and-rounding, double-entry-bookkeeping, card-payment-lifecycle, tokenization-and-pci-scope, reconciliation-and-settlement), Mobile & offline (local-first-and-optimistic-ui, sync-queues-and-conflict-resolution, push-notifications-delivery, unreliable-mobile-networks, old-app-versions-and-api-compatibility).
Wave 7 case studies (done): payment-reconciliation-service, mobile-release-and-rollout-system, ecommerce-product-search.
**Wave 8: Design principles and Algorithms & complexity** (done): Design principles (single-responsibility-principle, open-closed-principle, liskov-substitution-principle, interface-segregation-principle, dependency-inversion-principle, dry-and-the-wrong-abstraction, composition-over-inheritance, coupling-and-cohesion) and Algorithms & complexity (big-o-notation-basics, hidden-complexity-in-loops, amortized-analysis, hash-tables-and-worst-case, recursion-memoization-and-dynamic-programming, sorting-and-searching-complexity, space-time-tradeoffs, trees-graphs-and-worst-case-shapes). Each teaches the usual misreading of the idea, with a simulation of its cost and, for principles, of what it costs to over-apply it.
**Wave 9** (done): Concurrency & parallelism (race-conditions-and-atomicity, locks-deadlocks-and-contention, threads-async-and-the-event-loop, thread-pools-and-sizing, producer-consumer-and-bounded-queues), Testing & quality (test-pyramid-and-where-to-test, flaky-tests, test-doubles-and-over-mocking, coverage-and-mutation-testing, property-based-testing-and-fuzzing), depth in principles and algorithms (separation-of-concerns-and-layering, immutability-and-pure-functions, choosing-a-data-structure, string-matching-and-regex-backtracking). Case studies: lru-cache-and-eviction-design, plugin-and-extension-platform.
**Wave 11: depth in four areas** (done, 38 concepts): Design principles (kiss-yagni-and-premature-abstraction, law-of-demeter-and-tell-dont-ask, design-by-contract-and-defensive-programming, fail-fast-and-error-handling-strategies, least-astonishment-and-interface-design, command-query-separation, technical-debt-and-refactoring, dependency-injection-and-inversion-of-control, anemic-vs-rich-domain-models, stable-dependencies-and-package-design). Algorithms (binary-search-and-its-traps, two-pointers-and-sliding-window, heaps-and-priority-queues, graph-traversal-bfs-and-dfs, shortest-paths-dijkstra-and-friends, topological-sort-and-dependency-ordering, union-find-and-connected-components, greedy-algorithms-and-when-they-fail, backtracking-and-search-space-pruning, divide-and-conquer-and-the-master-theorem, tries-and-prefix-trees, balanced-trees-and-why-they-balance, randomized-algorithms-and-reservoir-sampling, np-hard-problems-and-practical-approximation). Security (threat-modeling-and-attack-surface, ssrf-and-server-side-request-risks, credential-stuffing-and-multi-factor-authentication, idor-and-broken-object-level-authorization, hashing-signatures-and-hmac, zero-trust-and-network-segmentation, content-security-policy-and-browser-hardening, security-logging-and-incident-response). Networking (nat-firewalls-and-security-groups, connection-pooling-and-keep-alive, tcp-states-time-wait-and-port-exhaustion, vpc-vpn-and-private-networking, mtu-fragmentation-and-path-mtu, ddos-and-traffic-filtering).
**Wave 10: Software architecture** (done): monolith-modular-monolith-and-microservices, hexagonal-architecture-ports-and-adapters, domain-driven-design-and-bounded-contexts, event-driven-architecture, strangler-fig-and-incremental-migration. Case studies: monolith-to-services-migration, concurrent-worker-pool-service.
**Wave 12: new pattern families** (in progress): Design patterns now have a `category` list in `src/data/patternCategories.ts`. Enterprise (done): repository, unit-of-work, specification, null-object, data-mapper, object-pool. Distributed and cloud (done): sidecar, ambassador, anti-corruption-layer, backends-for-frontends, scatter-gather, claim-check. Concurrency follows, see `docs/superpowers/plans/2026-11-27-more-patterns.md`.
Next candidates: more depth in these two areas (concurrency and locks, testing principles, string algorithms), a path through the principles for newcomers, or a further area.

Simulation ideas: caching (hit/miss ratio with eviction policies), sharding and consistent hashing (add or remove a node and watch keys move), CAP (partition the network and choose consistency or availability), rate limiting (token bucket vs sliding window), circuit breaker (open/half-open/closed under failing calls), message queues (producers, consumers, a slow consumer).

## Later
- More areas: none queued; propose the next one
- Walkthrough check: a few steps still quote a rounded figure that the check accepts (the time-series database study says "45 GB" where the page shows 45.3 GB); find out why and decide whether to tighten it

## Status
- Design patterns: all 35 built, with JS, Python and C# samples (verified by `npm run check:samples`)
- Site generalised: area-based catalog with search and filters, concept pages, breadcrumbs, `/compare/` for patterns
- Accessibility pass done (axe-core clean in light and dark, keyboard checks)
- Plan an idea (`/advisor/`): describe an app or a page and see which of 24 needs it has, what to use for each and the closest case studies. Word matching in the browser, no AI. Ideas for later: more needs, a need-by-need comparison of options, and an optional AI mode where the reader brings their own key
- Walkthrough check: every number a "how to try it" step quotes is reproduced by `npm run check:walkthroughs` (298 lists; the baseline of known gaps is empty and its cap is 0, see `docs/walkthrough-hand-check.md`). The code that reads a step as a script is in `scripts/walkthrough-steps.mjs` and has unit tests
- Lighthouse: six pages score 89 to 99 for performance and 98 to 100 for everything else on mobile settings; a CI job keeps them above their floors (`docs/lighthouse.md`). The review and search pages are the heaviest
- Concepts: 208 across twenty-one areas (waves 1 to 6, including AI & ML systems: waves 3 and 4 added Cloud & deployment, Databases & storage, Data engineering, and 28 deeper concepts in Security, Observability, Networking, API design, Reliability, Distributed systems and Messaging), each with a diagram, an animation, a simulation, and JS, C# and Python samples where there is meaningful code
- Case studies: 165 (every area has at least one; twenty-nine are named after real companies and cite their public write-ups), each with a build-up diagram, an estimator, a break-it simulation and JS, C# and Python samples
