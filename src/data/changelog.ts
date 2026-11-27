/** What changed on the site, for readers. Newest first. Write what a learner would notice, not what a developer did. */
export interface Change { date: string; title: string; items: { text: string; href?: string }[] }

export const changelog: Change[] = [
  {
    date: '2026-12-05',
    title: 'Six more AI concepts: building with language models',
    items: [
      { text: 'The AI & ML systems area now covers choosing between prompting, retrieval and fine-tuning, fine-tuning and LoRA, structured output and function calling, agents and tool use, how vector indexes (IVF, HNSW, product quantization) work, and training-serving skew. Each has a simulation, code in JavaScript, Python and C#, and a list of sources. They have not been fact-checked yet.', href: 'concepts/prompting-vs-fine-tuning-vs-rag/' },
      { text: 'A new learning path, Building with language models, and two new compare entries: Retrieval, fine-tuning or a better prompt, and Quantization, LoRA or scaling laws.', href: 'paths/' },
    ],
  },
  {
    date: '2026-12-04',
    title: 'A new area: how AI models work',
    items: [
      { text: 'Eight new concepts explain the machine itself: tokens and tokenization, attention and transformers, how models are trained, sampling and temperature, context windows, scaling laws, quantization, and why models hallucinate and how grounding helps. Each has a simulation whose numbers are worked out from stated assumptions, code in JavaScript, Python and C# where code helps, and a list of the primary sources behind it.', href: 'concepts/tokens-and-tokenization/' },
      { text: 'A new learning path, How a language model works, takes you from text to tokens to attention, training, sampling and serving.', href: 'paths/' },
      { text: 'Concept pages can now show a Sources list. These pages have not been fact-checked yet.', href: 'concepts/attention-and-transformers/' },
    ],
  },
  {
    date: '2026-12-03',
    title: 'Five concurrency design patterns',
    items: [
      { text: 'The third new family is Concurrency: how code that runs at the same time is structured. Active Object, Reactor, Read-Write Lock, Double-Checked Locking and Future/Promise each have a diagram, an animation, a simulation, before and after code in JavaScript, Python and C#, and a quiz. That brings the design patterns to 40. Double-Checked Locking states what is safe in each language and recommends the built-in lazy tools. They have not been fact-checked yet.', href: 'patterns/reactor/' },
      { text: 'New compare rows: Reactor vs Active Object vs Future/Promise, and Read-Write Lock vs Double-Checked Locking.', href: 'compare/' },
    ],
  },
  {
    date: '2026-12-02',
    title: 'Six distributed and cloud design patterns',
    items: [
      { text: 'A second new family: Distributed. Sidecar, Ambassador, Anti-Corruption Layer, Backends for Frontends, Scatter-Gather and Claim Check show how services cooperate across processes and networks. Each has a diagram, an animation, a simulation that prices the trade-off, before and after code in JavaScript, Python and C#, and a quiz. They have not been fact-checked yet.', href: 'patterns/sidecar/' },
      { text: 'The compare page has new rows, including Sidecar vs Ambassador vs Proxy and Anti-Corruption Layer vs Adapter vs Facade.', href: 'compare/' },
    ],
  },
  {
    date: '2026-12-01',
    title: 'Six enterprise design patterns',
    items: [
      { text: 'Design patterns now have more than the 23 Gang of Four. The first new family is Enterprise: how code organises data access and domain logic. Repository, Unit of Work, Specification, Null Object, Data Mapper and Object Pool each have a diagram, an animation, a simulation, before and after code in JavaScript, Python and C#, and a quiz. They are new and have not been fact-checked yet.', href: 'patterns/repository/' },
      { text: 'The compare page has new rows for them, including Repository vs Data Mapper vs Unit of Work.', href: 'compare/' },
    ],
  },
  {
    date: '2026-11-29',
    title: 'Checked against the documentation itself',
    items: [
      { text: 'Eleven claims that earlier reviews could only confirm from memory were re-checked against the primary sources (MDN, SLSA, OWASP, Kubernetes, Firebase, Apple, RabbitMQ, OpenTelemetry, the RFCs). Ten pages changed. Among them: SameSite is Lax by default only in Chromium-based browsers, with a two-minute exception for POST; SLSA Build L3 requires isolated builds and protected signing keys, not reproducible builds; Kubernetes marks a node unhealthy after 50 seconds in current releases; FCM keeps up to 100 pending messages and four collapse keys; APNs returns no delivery receipt.', href: 'accuracy/' },
      { text: 'Two sample fixes: the NP-hard sample now labels its brute-force count as orders, and the coupling sample\'s narrow-interface example really goes through public methods.', href: 'concepts/coupling-and-cohesion/' },
    ],
  },
  {
    date: '2026-11-28',
    title: 'Every lesson is now fact-checked',
    items: [
      { text: 'The last 49 case studies have been reviewed: migrations and data operations, chat and social, bookings and marketplaces, maps and video, API platforms, and email, sync and workflow systems. All 208 concepts, 23 patterns and 165 case studies now carry the Fact-checked badge. The review found and corrected claims on most pages; the new page says what it covers and where it stops.', href: 'accuracy/' },
    ],
  },
  {
    date: '2026-11-27',
    title: 'Fact-checked: 49 more case studies',
    items: [
      { text: 'Security and identity, observability, delivery, data and analytics, ML and AI, and search and media systems have been reviewed. 112 of the 165 case studies now carry the Fact-checked badge. The image-processing pipeline study had a model bug (a retried job re-entered the queue instantly and ran on many workers at once); it is fixed, and its break-it numbers changed. The ad-click aggregation design now saves its seen-click set with its checkpoints, so a crash cannot lose replayed clicks.', href: 'accuracy/' },
    ],
  },
  {
    date: '2026-11-26',
    title: 'Fact-checked: all 23 design patterns and 63 case studies',
    items: [
      { text: 'The design patterns have been reviewed against the Gang of Four book and by running their samples. Corrections include a Prototype page that called a one-level copy deep, a Flyweight sample that rebuilt the shared object every time, and an Undo in the Command sample that wiped the document when undoing an empty insert.', href: 'patterns/command/' },
      { text: 'The case studies of real systems (Dynamo, Bigtable, Spanner, Borg, GFS, MapReduce, Chubby, Dapper, Dremel, Percolator, Maglev, Discord, Dropbox, Facebook, Cloudflare and Figma) were checked against the papers and engineering posts. Fixes include a sampling rate that the Dapper paper measured as costing 2%, not nothing, and a Maglev health check that belongs to the forwarder, not the controller.', href: 'accuracy/' },
      { text: '42 more case studies were reviewed the same way: payments, data stores, streaming and job systems, platform infrastructure, and coordination and storage. Fixes include a Kubernetes zone-outage story with the wrong eviction rule, a stock exchange speed claim that was off by 10x, a ledger page that said a debit always adds money, and estimator defaults that no longer matched the scale in the prompt.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-11-25',
    title: 'Fact-checked badges',
    items: [
      { text: 'Lessons that have been through an independent accuracy review now carry a Fact-checked badge with the date. every concept (208) and 4 case studies have it so far; the review found and fixed wrong claims in most of them. The patterns and the other case studies follow. The new page explains what the review covers and what it does not.', href: 'accuracy/' },
    ],
  },
  {
    date: '2026-11-24',
    title: '38 new lessons: design principles, algorithms, security and networking',
    items: [
      { text: 'Design principles, ten more: KISS and YAGNI, the Law of Demeter, design by contract, fail fast, interface design, command-query separation, technical debt, dependency injection, anemic and rich models, and package design. Each shows what the habit saves and what it costs when overdone.', href: 'concepts/kiss-yagni-and-premature-abstraction/' },
      { text: 'Algorithms, fourteen more: binary search and its traps, sliding windows, heaps, graph traversal, shortest paths, topological sort, union-find, greedy, backtracking, divide and conquer, tries, balanced trees, randomized algorithms and NP-hard problems. The simulations count operations so you can watch the curves cross.', href: 'concepts/binary-search-and-its-traps/' },
      { text: 'Security, eight more: threat modeling, SSRF, credential stuffing and MFA, broken object-level authorization, signatures and HMAC, zero trust, content security policy, and logging and incident response.', href: 'concepts/threat-modeling-and-attack-surface/' },
      { text: 'Networking, six more: NAT and firewalls, connection pooling, TIME_WAIT and port exhaustion, VPCs and VPNs, MTU and fragmentation, and DDoS filtering.', href: 'concepts/connection-pooling-and-keep-alive/' },
      { text: 'Five new learning paths: design habits, graphs and searching, problem-solving patterns, how attacks work and what stops them, and why network connections misbehave.', href: 'paths/' },
    ],
  },
  {
    date: '2026-11-23',
    title: 'New area: software architecture, and two more case studies',
    items: [
      { text: 'Software architecture: monolith, modular monolith and microservices (and the distributed monolith that is worse than both), hexagonal architecture, bounded contexts, event-driven design, and the strangler fig for migrating without a big bang. Each simulation includes the over-applied extreme.', href: 'concepts/monolith-modular-monolith-and-microservices/' },
      { text: 'Design a monolith-to-services migration: move traffic in slices, keep the two databases in step, and see why keeping the shared database "for now" costs more than it saves.', href: 'case-studies/monolith-to-services-migration/' },
      { text: 'Design a concurrent job worker service: a noisy tenant, a pool bigger than the machine, a thread per job, and retries that run a side effect twice.', href: 'case-studies/concurrent-worker-pool-service/' },
    ],
  },
  {
    date: '2026-11-22',
    title: 'Two new areas (concurrency, testing), more depth, two case studies',
    items: [
      { text: 'Concurrency and parallelism: race conditions, locks and deadlocks, async and the event loop, thread pool sizing, and bounded queues. Each simulation runs every possible ordering of the same program, so you see how many of them go wrong.', href: 'concepts/race-conditions-and-atomicity/' },
      { text: 'Testing and quality: the test pyramid, flaky tests, over-mocking, coverage against mutation testing, and property-based testing. Each shows which injected bugs a suite catches, and how a plausible improvement can make it worse.', href: 'concepts/test-pyramid-and-where-to-test/' },
      { text: 'More depth in design principles and algorithms: separation of concerns, immutability and pure functions, choosing a data structure, and how a regular expression can take 26 days on 50 characters.', href: 'concepts/string-matching-and-regex-backtracking/' },
      { text: 'Design an LRU cache and eviction policy: an unbounded map that gets killed, a scan that empties the cache, and a frequency policy that cannot follow a moving hot set.', href: 'case-studies/lru-cache-and-eviction-design/' },
      { text: 'Design a plugin and extension platform: one misbehaving plugin, with and without isolation, and why a long timeout makes it worse.', href: 'case-studies/plugin-and-extension-platform/' },
    ],
  },
  {
    date: '2026-11-21',
    title: 'Two new areas: design principles, and algorithms and complexity',
    items: [
      { text: 'Design principles: SOLID one principle at a time, plus DRY, composition over inheritance, and coupling and cohesion. Each lesson covers what people usually get wrong (one reason to change is not one method per class; a Square that inherits Rectangle breaks callers; injecting a concrete class is not dependency inversion) and lets you over-apply the principle to see what that costs.', href: 'concepts/single-responsibility-principle/' },
      { text: 'Algorithms and complexity: Big O with the traps (a constant factor of 100, O(n²) that hides in a harmless loop, amortized cost and the latency spike it hides), hash tables and how they fail, memoization, sorting and searching, space against time, and trees and graphs in their worst shapes. The simulations count operations, so you can see where the curves cross.', href: 'concepts/big-o-notation-basics/' },
    ],
  },
  {
    date: '2026-11-20',
    title: 'Three case studies built on the new areas',
    items: [
      { text: 'Design a payment reconciliation service: three sources (your ledger, the processors, the bank) that never agree on the first try. Break it with files that arrive twice, a cut-off in the wrong time zone, and a matching rule loose enough to call two different payments one.', href: 'case-studies/payment-reconciliation-service/' },
      { text: 'Design a mobile release and rollout system: apps you cannot roll back, store review delays, and users who never update. Compare no monitoring, a daily look at the dashboard and an automatic gate, and see why a gate on too few users halts a healthy release.', href: 'case-studies/mobile-release-and-rollout-system/' },
      { text: 'Design product search for an online store: prices and stock that change faster than an hourly index, a flash sale that swamps real-time indexing, and a sales boost that buries new products.', href: 'case-studies/ecommerce-product-search/' },
    ],
  },
  {
    date: '2026-11-18',
    title: 'Three new areas: search, payments, and mobile and offline',
    items: [
      { text: 'Search systems: how BM25 ranks (and why a keyword-stuffed page loses), how new documents become searchable within a second by writing small immutable segments, why one slow shard sets the speed of the whole query, how autocomplete answers within a keystroke, and how to tell whether a ranking change really helped. The inverted-index lesson moves here from Databases.', href: 'concepts/bm25-and-relevance-ranking/' },
      { text: 'Payments & money: why money is whole numbers and not floats (and how to split $100 three ways), double-entry books that always balance, the life of a card payment from hold to settlement, keeping card numbers off your servers, and matching your records against the provider\'s.', href: 'concepts/money-representation-and-rounding/' },
      { text: 'Mobile & offline: apps that answer instantly and sync later, what happens when two offline devices edit the same record, push notifications that expire or collapse, a flaky network and ten thousand phones reconnecting at once, and old app versions you cannot update.', href: 'concepts/local-first-and-optimistic-ui/' },
    ],
  },
  {
    date: '2026-11-16',
    title: 'GitOps, cloud costs, and an image pipeline',
    items: [
      { text: 'GitOps: keep what should run in Git and let a controller in the cluster make it so. Simulate a hand-made change that the next deploy silently erases, a deleted job left running, and how long a broken version stays live on a slow poll.', href: 'concepts/gitops/' },
      { text: 'Cloud cost management: the same traffic for $7,488 or $1,179 a month. Right-size, autoscale, commit to the base load, burst on spot, switch the test environment off at night, and see what over-committing costs.', href: 'concepts/cloud-cost-management/' },
      { text: 'Design an image-processing pipeline: a marketplace where one seller imports 100,000 photos while others wait for theirs. Break it with a single queue, broken files retried for ever, and an autoscaler that hides the problem instead of fixing it.', href: 'case-studies/image-processing-pipeline/' },
    ],
  },
  {
    date: '2026-11-15',
    title: 'Plan an idea: describe what you want to build, see what it needs',
    items: [
      { text: 'A new page where you describe an app or a page in your own words. It ticks the needs it can read in your description (payments, live updates, search, limited stock and twenty more), and for each one lists what to use and why, the closest worked case studies, and an order to read them in. It matches words in your browser, it is not an AI, so you can tick or untick needs to correct it.', href: 'advisor/' },
    ],
  },
  {
    date: '2026-11-03',
    title: 'Three more famous systems from Google',
    items: [
      { text: 'How Google built Maglev (a load balancer made of ordinary servers, with a new kind of consistent hashing), Dremel (SQL over trillion-row nested data in seconds, with columns and a serving tree) and Percolator (updating the web index a little at a time with transactions on Bigtable). Each is built only from the original paper, listed at the end, with a diagram, animation, quiz, estimator, break-it simulation and code in three languages.', href: 'case-studies/' },
      { text: 'A second, deeper look at three papers already covered: Amazon\'s Dynamo, Google\'s Spanner and Google\'s Bigtable. Each deep dive follows the original paper through more steps, with a simulation that counts every possible read quorum (Dynamo), a commit-wait clock check (Spanner) and a read-path cost model (Bigtable). They are small teaching models, not Amazon\'s or Google\'s own.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-11-02',
    title: 'Six more famous systems, and a simulation for every new study',
    items: [
      { text: 'How Google built the Google File System (one master, 64 MB chunks, leases, record append) and MapReduce (map, shuffle, reduce, re-running lost work, backup tasks), how Facebook built Haystack for photos, how Google built Dapper (tracing), Chubby (locks and leader election) and Borg (cluster scheduling). Each is built only from the original paper or post, which is listed at the end.', href: 'case-studies/' },
      { text: 'The five studies added yesterday (Dynamo, Spanner, Bigtable, Stripe rate limiters and TAO) now also have a back-of-the-envelope estimator and a break-it simulation, like the older company studies.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-11-01',
    title: 'Eight more case studies from famous systems and real companies',
    items: [
      { text: 'How Amazon built Dynamo (always-writable shopping carts, sloppy quorums, hinted handoff, vector clocks), how Google built Spanner (TrueTime and commit wait) and Bigtable (tablets, memtables and SSTables), how Stripe scales its API with four kinds of rate limiter, and how Facebook built TAO. Each is built only from the original paper or post, which is listed at the end, and has a diagram that grows step by step, an animation and code in three languages.', href: 'case-studies/' },
      { text: 'How Stripe protects its API with four kinds of rate limiter and idempotency keys, how GitHub changes huge MySQL tables without stopping with gh-ost, and how Notion split one Postgres database into 480 logical shards. Each is built only from the company\'s own public posts and documentation, listed at the end of the page, and says plainly when a post does not give a number. The simulations and code are small teaching models, not the companies\' own.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-10-31',
    title: 'Interview questions, readings under the animations and tidier how-to steps',
    items: [
      { text: '24 interview questions: ideas like caching and retries, classic designs like a rate limiter, and the "tell me about a time" kind. Open one to see what a strong answer covers, the follow-ups to expect, common slips and which pages to read next.', href: 'interview-questions/' },
      { text: 'A "Drill me" mode picks a question you have not tried, runs a 2, 3 or 5 minute clock you can pause, then lets you tick the points you covered. Your grades stay in this browser.', href: 'interview-questions/' },
      { text: 'Seven animations (caching, load balancing, rate limiting, circuit breaker, message queues, CDN and backpressure) now show small readings under the picture, such as tokens left in the bucket or database queries so far, that change as you step through.', href: 'concepts/rate-limiting/' },
      { text: 'Thirty-six "how to try it" steps now say what to press or set first, and 68 button and option names match the simulation exactly. The app icons and share image use the new colours.' },
      { text: 'Eighteen more animations now show small readings under the picture: sharding, replication, consensus, retries, timeouts, load shedding, bulkheads, idempotency, quorums, leader election, consistent hashing, pub/sub, CQRS, sagas, health checks, autoscaling, DNS and failure detection.', href: 'concepts/autoscaling/' },
      { text: 'Interview questions you grade in the Drill come back on the same schedule as Review, and the Practice page shows your last mock interview score. Pages no longer jump while loading on a phone, and the concept map is filled in before the page finishes loading.' },
      { text: 'Four new concepts: back-of-the-envelope estimation, inverted indexes and text search, cache eviction with stampedes and write policies, and unique ID generation. Each has an animation with readings, a simulation, code in three languages and a quiz.', href: 'concepts/back-of-the-envelope-estimation/' },
      { text: 'Forty-two more animations show readings under the picture (nearly every security, networking, API, database, messaging and distributed-systems lesson).' },
    ],
  },
  {
    date: '2026-10-30',
    title: 'An interview guide',
    items: [
      { text: 'What a system design interview is judged on, how to spend 45 minutes, what to say at each stage, common mistakes, short answers to the usual follow-up questions, and a table that maps 18 classic questions to the case study and ideas to read.', href: 'interview-guide/' },
    ],
  },
  {
    date: '2026-10-29',
    title: 'Six more case studies from real companies',
    items: [
      { text: 'How Slack scaled its job queue, how Shopify survives flash sales, and how Cloudflare distributes configuration with Quicksilver. Like the earlier company studies, each is built only from the company\'s own public engineering posts, listed at the end of the page; the simulations and code are small teaching models, not their systems.', href: 'case-studies/' },
      { text: 'Three more: how Meta keeps its caches consistent with the database, how LinkedIn made Kafka a cheap, fast log, and how Cloudflare built Unimog, its edge load balancer.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-10-28',
    title: 'New look for four more pages, and moving dots in the animations',
    items: [
      { text: 'Case studies: a strip for the studies built from real company posts, a search box with level filters, and cards that show the level, how many fixes and how many concepts each study uses.', href: 'case-studies/' },
      { text: 'Practice: Review and Mock interview lead the page (with how many questions are due today), and the other tools sit underneath.', href: 'practice/' },
      { text: 'Search: results are marked as concept, pattern or case study, with counts for each, and a few ideas to try before you type.', href: 'search/' },
      { text: 'Compare: switch between design patterns and system design concepts with one control, and numbered sections.', href: 'compare/' },
      { text: 'The three coloured logos in the header are now one menu labelled "Code in", so it is clear that it chooses the language of every code sample.' },
      { text: 'In every animated lesson, requests now stream along the lines as moving dots while you read each step. Pick 0.5×, 1× or 2×, or pause the motion.', href: 'concepts/load-balancing/' },
      { text: '"Step by step" brings back the one-dot-per-step player. Your choice is remembered, and people who ask their device for reduced motion get the still version.' },
    ],
  },
  {
    date: '2026-10-27',
    title: 'Three case studies from real companies',
    items: [
      { text: 'How Discord stores trillions of messages, how Dropbox built Magic Pocket, and how Figma built multiplayer editing. Each is built only from the company\'s own public engineering posts, which are listed at the end of the page. Numbers and decisions are theirs as published at the time; the simulations and code are small teaching models, not their systems.', href: 'case-studies/' },
      { text: 'Search finds them by everyday words such as "hot partition", "erasure coding" or "multiplayer".', href: 'search/' },
    ],
  },
  {
    date: '2026-10-26',
    title: 'A new look',
    items: [
      { text: 'A calmer, more technical design in light and dark themes, with self-hosted IBM Plex Sans for text and JetBrains Mono for numbers and code.' },
      { text: 'The home page shows your progress, the next step on a start-here path and how many review questions are due today. The catalog has an area list, a level filter and a "Hide done" switch.' },
      { text: 'Concept, pattern and case-study pages have an "On this page" list that follows you as you read, numbered sections, and the time each page takes.', href: 'concepts/caching/' },
      { text: 'On a phone the main sections sit in a tab bar at the bottom of the screen, within reach of your thumb.' },
    ],
  },
  {
    date: '2026-10-25',
    title: 'Three new concepts and three new case studies',
    items: [
      { text: 'New concepts: probabilistic data structures (Bloom filters, HyperLogLog and count-min sketches), service discovery, and geospatial indexing (geohash, quadtrees, S2 and H3), each with an animation, a simulation and code.', href: 'concepts/' },
      { text: 'New case studies: a calendar and scheduling service, real-time ad bidding, and a flight search aggregator.', href: 'case-studies/' },
      { text: 'Case studies that use these ideas (key-value store, web crawler, proximity service, ride sharing, service mesh and others) now link to the new concept pages.' },
    ],
  },
  {
    date: '2026-10-23',
    title: 'Every case study reviewed',
    items: [
      { text: 'The remaining 95 case studies got the same review as the first 30: figures in requirements, steps and how-to lists now match what the simulations show, quiz answers are harder to guess by length and every wrong option is explained, and unfamiliar terms are explained where they first appear.', href: 'case-studies/' },
      { text: 'One case study quiz (maps and routing) was rewritten because its wrong options were not believable, and several others had a number or a wording that could not be worked out from the page.' },
    ],
  },
  {
    date: '2026-10-22',
    title: 'Diagrams that fit phones, smarter search and start-here paths',
    items: [
      { text: 'Animated diagrams no longer squeeze boxes together on a phone: boxes keep clear space between them and the diagram grows taller when it needs the room.' },
      { text: 'Search understands everyday words ("login", "duplicate messages", "slow database"), matches word forms like "queues" and "caching", and shows where on the page it found your words.', href: 'search/' },
      { text: 'Three start-here paths with a time for every step: thirty minutes, from web developer to system design, and one week to an interview.', href: 'paths/' },
      { text: 'All 134 concept and pattern pages were reviewed: wrong or unclear numbers in animations and how-to lists were corrected, quiz answers are harder to guess by length, and unfamiliar terms are explained where they first appear. The Undo button in the event sourcing simulation no longer cancels the same event twice.', href: 'concepts/' },
      { text: 'The thirty oldest case studies were checked again: short explanations for terms a newcomer may not know, quiz answers that are no longer recognisable by length, and a few corrected numbers in the how-to lists.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-10-20',
    title: 'Three new case studies, clearer quizzes and a full review',
    items: [
      { text: 'New case studies: a virtual waiting room for flash sales, a maps and routing service, and a package registry.', href: 'case-studies/' },
      { text: 'Spaced review is fairer: retrying a quiz or practising early no longer pushes a question to a long gap, and days now follow your own time zone.', href: 'review/' },
      { text: 'A missed case-study question now opens the diagram at the exact step that explains it, and following any "read this part again" link moves keyboard focus there.' },
      { text: 'Simulations that run on their own can be paused, results and estimates are announced to screen readers, and long logs and tables scroll with the keyboard.' },
      { text: 'Corrected numbers in several simulations and tables (ticket booking, package registry, metrics rollups, replication and leader election comparisons) and a smoother interview clock.' },
      { text: 'Fifteen quiz questions were tightened after a strict review: each now states the constraint that makes one answer clearly best, and a few weak or near-duplicate wrong options were replaced.' },
    ],
  },
  {
    date: '2026-10-18',
    title: 'Work offline, find your way, and learn from mistakes',
    items: [
      { text: 'Missed a quiz question? It now links to the exact section that explains it, and the concepts behind it.' },
      { text: 'Four new case studies: payment disputes and chargebacks, an offline-first sync engine, a search relevance pipeline, and data deletion and privacy.', href: 'case-studies/' },
      { text: 'Printable cheat sheets, one page per area, with when to use each idea, when to skip it and the main trap.', href: 'cheatsheets/' },
      { text: 'A concept map: pick a concept to see what to read first, what it opens the door to, and which case studies use it.', href: 'map/' },
      { text: 'The site can be installed as an app and pages you have opened keep working without a connection.' },
    ],
  },
  {
    date: '2026-10-17',
    title: 'Easier to read and to use',
    items: [
      { text: 'Quiz options now appear in a random order each time, and correct and wrong answers are labelled in words, not only colour.' },
      { text: 'Every page was checked at 400% zoom with extra letter and line spacing, in Windows high-contrast mode, and with the keyboard alone. Several layouts were fixed.' },
    ],
  },
  {
    date: '2026-10-16',
    title: 'Practise, not just read',
    items: [
      { text: 'Every concept, pattern and case study now ends with a three-question quiz (768 questions in all). Wrong answers are explained.' },
      { text: 'Review: spaced repetition over every quiz question, with a "questions I have missed" mode and a list of topics where you slip most.', href: 'review/' },
      { text: 'Mock interview: a random case study, a clock, and five stages from clarifying to wrap-up.', href: 'interview/' },
      { text: 'My progress: what you have finished and how your quizzes went, with a backup you can restore in another browser.', href: 'progress/' },
      { text: 'Search across the whole site, including quiz text.', href: 'search/' },
      { text: 'Case studies open with a guided four-step practice panel, including a number to estimate against the study’s own calculator.' },
    ],
  },
  {
    date: '2026-10-15',
    title: 'AI & ML systems, paths and progress',
    items: [
      { text: 'A new AI & ML systems area: eight concepts (embeddings, retrieval-augmented generation, inference and the KV cache, and more) and six case studies.', href: 'cheatsheets/aiml/' },
      { text: 'Mark pages as done, follow curated learning paths, and filter case studies by level.', href: 'paths/' },
      { text: 'Case-study levels were re-graded by what a reader needs to follow them (18 beginner, 52 intermediate, 48 advanced at the time).' },
      { text: 'Twenty-seven more case studies across messaging, delivery, security, platforms and databases.', href: 'case-studies/' },
    ],
  },
  {
    date: '2026-10-11',
    title: 'Three new areas and deeper coverage',
    items: [
      { text: 'New areas: Databases & storage, Cloud & deployment, and Data engineering.' },
      { text: 'Twenty-eight concepts deepening security, observability, networking, API design, reliability, distributed systems and messaging.' },
      { text: 'Dozens of new case studies, each with a back-of-the-envelope calculator and a simulation you can break.' },
    ],
  },
  {
    date: '2026-10-10',
    title: 'Python joins JavaScript and C#',
    items: [
      { text: 'Every code sample now also exists in Python, and all three languages print the same output.' },
      { text: 'The first wave of case studies: URL shortener, chat, news feed, payments, ticket booking and more.', href: 'case-studies/' },
    ],
  },
];
