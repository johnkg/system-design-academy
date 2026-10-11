# Build prompt: next wave of system design concepts

Copy everything below the line into a new Claude Code session opened in this folder.

---

Read `PLAN.md` and `README.md` first. The site is System Design Academy: a catalog of system design concepts and design patterns. Load Balancing (`src/content/concepts/load-balancing/` plus `src/playgrounds/LoadBalancingPlayground.astro`) is the reference concept. Match its structure, tone and quality.

Waves 1 to 4 (95 concepts across eleven areas, including API design, Security, Observability, Networking, Distributed systems, Cloud & deployment and Databases & storage), the compare pages and sixty-one case studies (URL shortener, rate limiter, notifications, chat, news feed, video streaming, ride sharing, payments, autocomplete, web crawler, key-value store, file sync, ticket booking, metrics and monitoring, unique IDs, collaborative editor, job scheduler, leaderboard, stock exchange, hotel reservations, proximity search, e-commerce checkout, distributed locks, object storage, ad click aggregation, message queue, photo sharing, email, code deployment, food delivery, digital wallet, feature flag service, log aggregation, video conferencing, recommendations, distributed cache, social graph, container orchestrator, serverless platform, time-series database, search engine, data warehouse, distributed SQL database, change data capture, zero-downtime database migration, authentication, secrets vault, DDoS protection, API gateway, webhook delivery, CDN, global DNS, load balancer, distributed tracing, service mesh, cluster membership, shopping cart, workflow engine, CI system, multi-tenant SaaS, database connection pooler) are done. Propose what to build next (data engineering as a new area, more cloud and deployment concepts, more case studies such as a graph database), with a recommendation, and wait for my choice.

For each concept:
- `meta.json` with an accurate problem statement, 4 to 6 `howItWorks` steps, honest pros and cons, when to use and skip it, and real pitfalls. Link related concepts and patterns.
- `visuals/steps.json` animating one concrete request or data flow (6 to 9 frames) using the existing step player. Keep actor positions inside 10 to 90 percent so they work on phones.
- A simulation the reader can play with, where something observable changes (hit rate, queue length, keys moving between nodes). Build DOM once and update it, never rebuild controls on a timer. Pause timers when the page is hidden.
- JS, Python and C# samples only if the concept has meaningful code. If you add code, `npm run check:samples` must pass. A new sample needs a file for every language in `src/languages.config.ts` (JavaScript, C#, Python) with identical output.

Rules:
- Quality over quantity: one accurate, well-tested concept beats three shallow ones.
- Keep accessibility intact: headings never skip a level, controls are labelled, colours use the existing tokens, motion respects reduced-motion, and focus is never lost. Re-check with axe-core on new pages in light and dark.
- Verify before saying done: build, sample checks, and open each page in the browser (desktop and 375px wide).
- Do not add dependencies. Put ideas in `IDEAS.md` rather than building them unasked.
