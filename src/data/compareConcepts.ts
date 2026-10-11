/**
 * Hand-written guidance for the system design compare page.
 * Concept slugs are validated at build time (see pages/compare-concepts.astro): a typo fails the build.
 */
import type { Problem, Confusion } from './compare';

export const problems: Problem[] = [
  { text: 'Repeated reads are slow or put too much load on the database', patterns: [
    { slug: 'caching', why: 'Keep hot results in fast memory so most reads never reach the database.' },
    { slug: 'database-indexing', why: 'If one query is slow because it scans the whole table, index the column first.' },
    { slug: 'database-replication', why: 'Spread reads over replica copies when one database cannot serve them all.' } ] },
  { text: 'Users far from my servers see slow pages and images', patterns: [
    { slug: 'cdn', why: 'Serve copies of static content from edge servers close to each user.' },
    { slug: 'caching', why: 'Cache API responses and rendered pages at the edge or in the browser.' } ] },
  { text: 'One server cannot handle the traffic', patterns: [
    { slug: 'load-balancing', why: 'Spread requests over several identical servers.' },
    { slug: 'horizontal-vs-vertical-scaling', why: 'Decide between a bigger machine and more machines.' } ] },
  { text: 'My data no longer fits on one database server', patterns: [
    { slug: 'database-sharding', why: 'Split the data across servers, each owning a slice.' },
    { slug: 'consistent-hashing', why: 'Choose the slice for a key in a way that survives adding or removing servers.' } ] },
  { text: 'Add or remove servers without moving almost every key', patterns: [
    { slug: 'consistent-hashing', why: 'Only a small share of keys move when the set of nodes changes.' } ] },
  { text: 'Keep a copy of the data for failover and extra read capacity', patterns: [
    { slug: 'database-replication', why: 'A primary streams changes to replicas that can serve reads or take over.' } ] },
  { text: 'Choose between a relational and a non-relational database', patterns: [
    { slug: 'sql-vs-nosql', why: 'Compare data shape, query needs and scaling model.' },
    { slug: 'acid-vs-base', why: 'Decide how strict the guarantees for each write must be.' } ] },
  { text: 'Understand what my distributed database does during a network partition', patterns: [
    { slug: 'cap-theorem', why: 'During a partition you must choose between consistency and availability.' },
    { slug: 'consistency-models', why: 'The precise guarantees a reader gets, from strong to eventual.' } ] },
  { text: 'Readers sometimes see stale data and I need to know what to promise', patterns: [
    { slug: 'consistency-models', why: 'Pick read-your-writes, monotonic, causal or strong guarantees deliberately.' },
    { slug: 'database-replication', why: 'Replication lag is the usual cause of stale reads.' } ] },
  { text: 'Do slow work without making the user wait', patterns: [
    { slug: 'message-queues', why: 'Enqueue the job and let workers handle it at their own pace.' } ] },
  { text: 'Tell several services that something happened, without knowing who they are', patterns: [
    { slug: 'pub-sub', why: 'Publish an event; every subscriber gets its own copy.' } ] },
  { text: 'Keep a full history of changes, or rebuild state from the past', patterns: [
    { slug: 'event-sourcing', why: 'Store events, not current state; replay them to rebuild or time-travel.' } ] },
  { text: 'Reads and writes need different shapes or different scaling', patterns: [
    { slug: 'cqrs', why: 'Use separate models for commands and queries, often with separate stores.' } ] },
  { text: 'Update data in several services without a distributed transaction', patterns: [
    { slug: 'saga', why: 'A chain of local transactions, with compensating steps to undo on failure.' } ] },
  { text: 'Save to my database and publish an event, and never do only one of them', patterns: [
    { slug: 'transactional-outbox', why: 'Write the event in the same transaction, then relay it to the broker.' } ] },
  { text: 'Stop one client from using up capacity shared by everyone', patterns: [
    { slug: 'rate-limiting', why: 'Count requests per client and reject the excess with 429.' },
    { slug: 'bulkhead', why: 'Reserve separate capacity per tenant or function so one cannot drain the rest.' } ] },
  { text: 'A dependency is failing and my callers are stuck waiting on it', patterns: [
    { slug: 'circuit-breaker', why: 'Stop calling it, fail fast, and probe for recovery.' },
    { slug: 'bulkhead', why: 'Limit how many workers that dependency can hold.' } ] },
  { text: 'Recover from temporary failures without hammering the service', patterns: [
    { slug: 'retries-and-backoff', why: 'Retry with growing, randomised delays and a cap on attempts.' },
    { slug: 'circuit-breaker', why: 'Pair retries with a breaker so persistent failures stop being retried.' } ] },
  { text: 'A retry, double click or redelivered message must not charge or create twice', patterns: [
    { slug: 'idempotency', why: 'Use an idempotency key so repeats return the saved result.' },
    { slug: 'message-queues', why: 'Queues deliver at least once, which is why handlers need idempotency.' } ] },
  { text: 'A fast producer is overwhelming a slower consumer', patterns: [
    { slug: 'backpressure', why: 'Bound the buffer and slow the producer or shed load.' },
    { slug: 'message-queues', why: 'A queue absorbs bursts, but only if its size is watched and bounded.' } ] },
  { text: 'Choose between REST, GraphQL and gRPC for my API', patterns: [
    { slug: 'api-styles', why: 'Compare round trips, payload size, caching and who the callers are.' },
    { slug: 'api-gateway', why: 'A gateway can expose REST publicly while services talk gRPC inside.' } ] },
  { text: 'Return a very large list without slow or inconsistent pages', patterns: [
    { slug: 'pagination', why: 'Cursor pagination stays fast and does not repeat or skip items when data changes.' },
    { slug: 'database-indexing', why: 'Keyset queries rely on an index for the sort key.' } ] },
  { text: 'Change my API without breaking the apps and partners already using it', patterns: [
    { slug: 'api-versioning', why: 'Prefer additive changes, publish a new version for breaking ones, and retire on a schedule.' } ] },
  { text: 'Know who is calling my API and what they are allowed to do', patterns: [
    { slug: 'authentication-and-authorization', why: 'Verify a signed token for identity, then check permissions on every request.' },
    { slug: 'api-gateway', why: 'Verify tokens once at the edge instead of in every service.' } ] },
  { text: 'Give many backend services one public front door', patterns: [
    { slug: 'api-gateway', why: 'Route, authenticate, rate limit and protect in one place.' },
    { slug: 'load-balancing', why: 'Spread traffic over several instances of the gateway and of each service.' } ] },
  { text: 'Be told when something happens in another system, without polling', patterns: [
    { slug: 'webhooks', why: 'The other system calls your URL with a signed event, and retries if you are down.' },
    { slug: 'idempotency', why: 'Retries mean duplicate events, so handle each event id once.' } ] },
  { text: 'Store user passwords safely in case my database leaks', patterns: [
    { slug: 'password-hashing', why: 'Salt every password and hash it with a deliberately slow function.' },
    { slug: 'secrets-management', why: 'Keep the keys and credentials around it out of code and logs.' } ] },
  { text: 'Protect data from being read on the network or on a stolen disk', patterns: [
    { slug: 'tls-and-https', why: 'Encrypts and authenticates traffic between client and server.' },
    { slug: 'encryption', why: 'Encrypt stored data, with keys managed separately from the data.' } ] },
  { text: 'Keep API keys and database passwords out of source code', patterns: [
    { slug: 'secrets-management', why: 'Fetch secrets at runtime, scope and rotate them, and audit every read.' } ] },
  { text: 'Stop attackers from sneaking commands or scripts in through user input', patterns: [
    { slug: 'injection-and-xss', why: 'Parameterize queries and encode output so input stays data.' } ] },
  { text: 'Stop other websites from acting as my logged-in users', patterns: [
    { slug: 'csrf-and-cors', why: 'SameSite cookies, CSRF tokens and origin checks, plus a careful CORS policy.' },
    { slug: 'authentication-and-authorization', why: 'Check permissions on every request, not just that a cookie exists.' } ] },
  { text: 'Find out why one request was slow or failed across many services', patterns: [
    { slug: 'distributed-tracing', why: 'One trace shows every hop as a timed span, so the slow one stands out.' },
    { slug: 'structured-logging', why: 'A shared request id lets you pull all log lines for one request.' } ] },
  { text: 'See how my service is doing over time, and spot slow users', patterns: [
    { slug: 'metrics', why: 'Cheap counters, gauges and histograms, with percentiles for latency.' } ] },
  { text: 'Decide how reliable my service needs to be, and when to stop shipping features', patterns: [
    { slug: 'slos-and-error-budgets', why: 'An objective gives an error budget, and a policy for when it runs out.' } ] },
  { text: 'Be woken up for real problems and not for blips', patterns: [
    { slug: 'alerting', why: 'Alert on symptoms and sustained burn, link a runbook, and review noisy alerts.' },
    { slug: 'slos-and-error-budgets', why: 'Burn-rate alerts are based on how fast the budget is spent.' } ] },
  { text: 'Restart stuck instances and send traffic only to ready ones', patterns: [
    { slug: 'health-checks', why: 'Liveness restarts stuck instances, readiness controls who gets traffic.' },
    { slug: 'load-balancing', why: 'The load balancer uses the readiness result to choose instances.' } ] },
  { text: 'Turn a domain name into an address, and move a service without long outages', patterns: [
    { slug: 'dns', why: 'A cached, hierarchical directory whose TTL controls how fast changes spread.' },
    { slug: 'load-balancing', why: 'Pair DNS with a load balancer for fast failover that caches cannot delay.' } ] },
  { text: 'Pick between TCP and UDP for my traffic', patterns: [
    { slug: 'tcp-vs-udp', why: 'TCP for every byte in order, UDP when late data is useless.' } ] },
  { text: 'Make pages with many files load faster over the network', patterns: [
    { slug: 'http-versions', why: 'HTTP/2 and HTTP/3 multiplex requests and cut handshakes.' },
    { slug: 'latency-and-round-trips', why: 'Count and remove the round trips before the first byte.' },
    { slug: 'cdn', why: 'Shorten every trip by serving from a nearby edge.' } ] },
  { text: 'Hide and protect my servers, or filter what my users reach', patterns: [
    { slug: 'proxies', why: 'A reverse proxy fronts your servers, a forward proxy fronts your clients.' } ] },
  { text: 'Push live updates to browsers without hammering my server', patterns: [
    { slug: 'real-time-communication', why: 'Choose between polling, long polling, server-sent events and WebSockets.' },
    { slug: 'pub-sub', why: 'Route each event to whichever server holds the recipient\'s connection.' } ] },
  { text: 'Make sure only one node acts as the leader, and replace it automatically when it fails', patterns: [
    { slug: 'leader-election', why: 'Majority voting in numbered terms picks exactly one leader per term.' },
    { slug: 'consensus', why: 'The same machinery keeps the replicated log agreed after the change.' } ] },
  { text: 'Have replicas agree on the same order of writes, even when some crash', patterns: [
    { slug: 'consensus', why: 'A replicated log is committed once a majority has stored each entry.' },
    { slug: 'quorums', why: 'Leaderless alternative: overlapping read and write quorums, without a single order.' } ] },
  { text: 'Tune how many replicas must answer to balance consistency and speed', patterns: [
    { slug: 'quorums', why: 'Pick N, W and R: R + W greater than N means reads see the latest write.' },
    { slug: 'consistency-models', why: 'Names the guarantee you end up with.' } ] },
  { text: 'Order events across machines whose clocks disagree', patterns: [
    { slug: 'logical-clocks', why: 'Lamport and vector clocks follow cause and effect, not wall-clock time.' } ] },
  { text: 'Let every node in a big cluster learn about failures and new members', patterns: [
    { slug: 'gossip-protocol', why: 'Each node tells a few random peers per round, reaching everyone in about log N rounds.' } ] },
  { text: 'Update data in several databases so that it all commits or none of it does', patterns: [
    { slug: 'two-phase-commit', why: 'Prepare and commit phases give strict atomicity, at the cost of locks and blocking.' },
    { slug: 'saga', why: 'Give up strict isolation for compensating actions when participants are slow or external.' } ] },
  { text: 'Release a new version without taking the site down', patterns: [
    { slug: 'blue-green-and-rolling-deployments', why: 'Replace servers in batches, or switch traffic between two full environments, so users never see an outage.' },
    { slug: 'canary-deployments', why: 'Send the new version to a few users first, and let measured error rates decide whether to continue.' },
    { slug: 'health-checks', why: 'Only send traffic to instances that report themselves ready.' } ] },
  { text: 'Ship code often, but release features when the business is ready', patterns: [
    { slug: 'feature-flags', why: 'Deploy the code switched off, then turn it on for chosen users, and off again instantly if it misbehaves.' },
    { slug: 'canary-deployments', why: 'Roll a risky change out to a small share of traffic while watching the results.' } ] },
  { text: 'Handle traffic spikes without paying for idle servers all day', patterns: [
    { slug: 'autoscaling', why: 'Add and remove instances from a metric, accepting a delay while new ones warm up.' },
    { slug: 'horizontal-vs-vertical-scaling', why: 'Scaling out is the precondition: the app must run happily as many copies.' },
    { slug: 'load-balancing', why: 'New instances only help once the balancer starts sending them requests.' } ] },
  { text: 'Run many copies of a service and keep them running when machines die', patterns: [
    { slug: 'containers-and-orchestration', why: 'An orchestrator places containers on machines and replaces them to match the desired count.' },
    { slug: 'health-checks', why: 'Liveness and readiness probes tell the orchestrator what to restart and what to route to.' } ] },
  { text: 'Build the same environment every time, and see what a change will do before it happens', patterns: [
    { slug: 'infrastructure-as-code', why: 'Describe infrastructure in versioned files, review a plan, then apply it, and detect hand-made drift.' } ] },
  { text: 'Survive an entire region or data centre going down', patterns: [
    { slug: 'multi-region-failover', why: 'Decide the recovery time and data loss you can accept, then pick a standby and a failover method.' },
    { slug: 'database-replication', why: 'Replication lag decides how many recent writes are lost on failover.' },
    { slug: 'dns', why: 'DNS time-to-live decides how long clients keep going to the failed region.' } ] },
  { text: 'Understand why my database is slow at writes or at reads, and what the storage engine is doing', patterns: [
    { slug: 'lsm-trees-vs-b-trees', why: 'B-trees update pages in place and read fast; LSM trees append and merge, so they write fast and pay in compaction.' },
    { slug: 'database-indexing', why: 'An index is what turns a scan into a handful of page reads.' } ] },
  { text: 'Be sure committed data survives a crash or a power cut', patterns: [
    { slug: 'write-ahead-log', why: 'Log the change durably before touching data pages, then replay the log after a crash.' },
    { slug: 'database-replication', why: 'A replica holds a second copy of the data, fed from the same log.' } ] },
  { text: 'Let many users read and write at once without seeing half-finished or inconsistent data', patterns: [
    { slug: 'mvcc-and-isolation-levels', why: 'Snapshots keep readers and writers apart, and the isolation level decides which anomalies remain.' },
    { slug: 'acid-vs-base', why: 'Choose how strict the guarantees for a transaction must be.' } ] },
  { text: 'Find out why a query suddenly became slow', patterns: [
    { slug: 'query-planning-and-joins', why: 'Read the plan: compare estimated and actual rows, and check the join method and statistics.' },
    { slug: 'database-indexing', why: 'A missing or unusable index is the most common cause.' } ] },
  { text: 'Change a table or move a database while the application keeps running', patterns: [
    { slug: 'online-schema-migrations', why: 'Expand, dual-write, backfill in batches, switch, then contract; or copy into a shadow table and swap.' },
    { slug: 'blue-green-and-rolling-deployments', why: 'The application versions must work with both the old and the new schema while you roll out.' } ] },
  { text: 'Get my data back after a bad deploy, an accidental DELETE or a lost server', patterns: [
    { slug: 'backups-and-point-in-time-recovery', why: 'Restore a base backup and replay the archived log up to just before the mistake.' },
    { slug: 'database-replication', why: 'A replica is not a backup: it copies the mistake within a second.' } ] },
  { text: 'Let users sign in with another account, or let an app act for them with limited access', patterns: [
    { slug: 'oauth-and-openid-connect', why: 'The authorization code flow with PKCE hands out tokens without sharing passwords.' },
    { slug: 'jwt-and-session-tokens', why: 'Choose between server-side sessions and signed tokens, and decide how revocation works.' } ] },
  { text: 'Decide who may see or edit what in an app with teams, folders and sharing', patterns: [
    { slug: 'access-control-models', why: 'Compare ACLs, roles, attribute rules and relationship-based checks, and how each grows.' } ] },
  { text: 'Keep a bad dependency or build step from reaching production', patterns: [
    { slug: 'supply-chain-security', why: 'Lockfiles, integrity hashes, scoped registries and release-age gates limit the damage of a malicious update.' } ] },
  { text: 'Find out why one service is slow, starting from nothing', patterns: [
    { slug: 'red-use-and-golden-signals', why: 'A short checklist of request and resource signals that points at the failing component.' },
    { slug: 'profiling-and-flame-graphs', why: 'Once you know which process, a profile shows which function burns the time.' },
    { slug: 'synthetic-monitoring-and-rum', why: 'Probes and real-user data tell you whether users, in each region, feel it.' } ] },
  { text: 'Cut the cost of metrics, logs and traces without losing the errors', patterns: [
    { slug: 'cardinality-and-sampling', why: 'Bound the labels, and sample so that errors and slow requests are always kept.' } ] },
  { text: 'Make pages and API responses load faster by caching them correctly', patterns: [
    { slug: 'http-caching-headers', why: 'Cache-Control, ETag and hashed file names decide what browsers and CDNs may reuse.' },
    { slug: 'cdn', why: 'Shared caches near users serve what the headers allow.' } ] },
  { text: 'Understand why downloads are slow on a long or lossy link, or why a route changes', patterns: [
    { slug: 'tcp-congestion-control', why: 'The congestion window, slow start and loss recovery set how fast a transfer can go.' },
    { slug: 'anycast-and-bgp-routing', why: 'Routing picks the nearest site by network path, and withdrawals move traffic.' },
    { slug: 'cidr-and-subnetting', why: 'Address plans and route tables decide what can reach what.' } ] },
  { text: 'Keep a service up when traffic spikes or a dependency gets slow', patterns: [
    { slug: 'timeouts-and-deadlines', why: 'Bound every wait, and pass the remaining time down the call chain.' },
    { slug: 'load-shedding', why: 'Refuse some work early so the rest finishes in time.' },
    { slug: 'graceful-degradation', why: 'Serve a simpler page instead of an error when an optional part fails.' },
    { slug: 'queueing-theory-and-littles-law', why: 'Explains why latency explodes near full utilisation and how to size pools.' } ] },
  { text: 'Cut the slowest requests when one user request fans out to many servers', patterns: [
    { slug: 'hedged-requests-and-tail-latency', why: 'Send a second copy after the p95 delay and take the first answer.' } ] },
  { text: 'Stop two users or services from silently overwriting each other', patterns: [
    { slug: 'optimistic-concurrency-and-etags', why: 'Send the version you read, and reject the write if it changed.' },
    { slug: 'crdts', why: 'For offline or multi-master data, merge instead of rejecting.' } ] },
  { text: 'Change a message or API format without breaking older producers and consumers', patterns: [
    { slug: 'schema-evolution-and-compatibility', why: 'Know which changes are backward and forward compatible, and never reuse a field number.' },
    { slug: 'api-versioning', why: 'Version the contract itself when a change cannot be made compatible.' } ] },
  { text: 'Offer an API for work that takes longer than a request should wait', patterns: [
    { slug: 'async-apis-and-long-running-operations', why: 'Return 202 with a status resource, poll with backoff, or call back.' },
    { slug: 'graphql-n-plus-one-and-dataloader', why: 'Batch the lookups behind a nested query so one request does not become hundreds.' } ] },
  { text: 'Make sure each message is handled once, in order, and bad ones do not block the rest', patterns: [
    { slug: 'delivery-guarantees', why: 'At-least-once delivery plus idempotent processing gives effectively once.' },
    { slug: 'ordering-and-partitioning', why: 'Order holds per key within a partition, and parallelism is capped by the partition count.' },
    { slug: 'dead-letter-queues-and-poison-messages', why: 'Park messages that always fail so they stop blocking healthy ones.' } ] },
  { text: 'Decide that a machine is dead, and make sure it cannot do harm if it is wrong', patterns: [
    { slug: 'failure-detection', why: 'Heartbeats and phi accrual trade detection speed against false alarms.' },
    { slug: 'leases-and-fencing-tokens', why: 'Fencing tokens make a stale owner harmless when the lease moved on.' },
    { slug: 'merkle-trees-and-anti-entropy', why: 'Replicas find and repair their differences by comparing hash trees.' } ] },
];

export const confusions: Confusion[] = [
  {
    title: 'Message queue or pub/sub?',
    blurb: 'Both move messages between services asynchronously. The difference is how many receivers each message reaches.',
    patterns: ['message-queues', 'pub-sub'],
    rows: [
      { aspect: 'Who receives a message', values: ['Exactly one consumer from a group of competing workers', 'Every subscriber gets its own copy'] },
      { aspect: 'Typical purpose', values: ['Share out work: jobs, emails, image processing', 'Broadcast a fact: "order placed", "user signed up"'] },
      { aspect: 'Sender knows the receivers?', values: ['No, but it expects the work to get done', 'No, and does not care how many there are'] },
      { aspect: 'Adding a consumer', values: ['More throughput for the same work', 'A new reaction to the same event, with no change to the publisher'] },
      { aspect: 'Failure handling', values: ['Retry, then a dead-letter queue', 'Per subscriber: each tracks its own progress or retries'] },
    ],
    rule: 'If one worker should do each task, use a queue. If several parties should each react to the same event, use pub/sub. Real systems often put a queue behind each subscriber.',
  },
  {
    title: 'CAP, ACID/BASE and consistency models',
    blurb: 'All three use the word "consistency", but they answer different questions.',
    patterns: ['cap-theorem', 'acid-vs-base', 'consistency-models'],
    rows: [
      { aspect: 'Question it answers', values: ['What must a distributed system give up when the network splits?', 'How strong are the guarantees of a single transaction or a whole database?', 'What exactly can a reader see after a write?'] },
      { aspect: 'Scope', values: ['A trade-off during a partition', 'A style of database design', 'A spectrum of read and write guarantees'] },
      { aspect: 'Choices', values: ['Consistency or availability, when partitioned', 'ACID (strict) or BASE (available, eventually consistent)', 'Strong, causal, read-your-writes, eventual, and more'] },
      { aspect: 'Common mistake', values: ['Treating it as "pick two of three" all the time', 'Assuming NoSQL means no transactions and SQL means no scale', 'Thinking "eventual" means "unpredictable"'] },
    ],
    rule: 'CAP says why you must choose, ACID/BASE describes the two broad styles of choosing, and consistency models name the exact guarantee you end up with.',
  },
  {
    title: 'Caching, CDN, replication or an index?',
    blurb: 'All four make reads faster by avoiding work, but they do it at different layers.',
    patterns: ['caching', 'cdn', 'database-replication', 'database-indexing'],
    rows: [
      { aspect: 'What it does', values: ['Remembers results of expensive work in fast memory', 'Keeps copies of content at edge servers near users', 'Keeps full copies of the database on other servers', 'Adds a lookup structure so queries skip a full scan'] },
      { aspect: 'Where it lives', values: ['In front of the database or service', 'Around the world, outside your data centre', 'Next to the primary database', 'Inside the database'] },
      { aspect: 'Can be stale?', values: ['Yes, until it expires or is invalidated', 'Yes, until the TTL ends or it is purged', 'Yes, by the replication lag', 'No, it is updated with every write'] },
      { aspect: 'Costs', values: ['Invalidation logic and memory', 'Purging and cache-control headers', 'Lag, failover logic, write goes only to the primary', 'Slower writes and more storage'] },
      { aspect: 'Best for', values: ['Hot, repeated reads', 'Static files and cacheable pages for global users', 'Read scaling and failover', 'Slow queries on specific columns'] },
    ],
    rule: 'Start with an index for a slow query, add a cache for hot repeated reads, use a CDN for content users download, and add replicas when one database cannot serve the read volume.',
  },
  {
    title: 'Replication or sharding?',
    blurb: 'Both spread a database over several machines, but one copies data and the other divides it.',
    patterns: ['database-replication', 'database-sharding'],
    rows: [
      { aspect: 'What happens to the data', values: ['Every replica holds all of it', 'Each shard holds only part of it'] },
      { aspect: 'Helps with', values: ['Read capacity, failover, backups', 'Data size and write capacity'] },
      { aspect: 'Does not help with', values: ['Write capacity (writes still go to one primary)', 'Availability by itself: losing a shard loses its slice unless it is also replicated'] },
      { aspect: 'Main complication', values: ['Replication lag and stale reads', 'Choosing a shard key, cross-shard queries and rebalancing'] },
    ],
    rule: 'Replicate first: it is simpler and solves reads and failover. Shard only when data or write volume outgrows one primary, and then replicate each shard.',
  },
  {
    title: 'Retries, circuit breaker, bulkhead and rate limiting',
    blurb: 'Four tools that protect a system from failure and overload. They guard against different things and work best together.',
    patterns: ['retries-and-backoff', 'circuit-breaker', 'bulkhead', 'rate-limiting'],
    rows: [
      { aspect: 'Protects', values: ['The caller, from temporary glitches', 'The caller and the failing dependency', 'Each part of the system from the others', 'The service, from its own clients'] },
      { aspect: 'Acts on', values: ['Outgoing calls that fail', 'Outgoing calls to a dependency that keeps failing', 'Shared pools of threads, connections or quota', 'Incoming requests'] },
      { aspect: 'What it does', values: ['Tries again after a growing, randomised delay', 'Stops calling and fails fast until the dependency recovers', 'Limits how much of a resource each part can use', 'Rejects requests beyond a rate with 429'] },
      { aspect: 'Danger if used alone', values: ['Retry storms against a struggling service', 'A sensitive threshold trips on noise', 'Idle capacity in one compartment', 'Does nothing for a failing dependency'] },
    ],
    rule: 'Retry transient errors with backoff, stop calling a dependency that keeps failing with a breaker, isolate capacity with bulkheads, and cap what clients may send with a rate limit.',
  },
  {
    title: 'Rate limiting or backpressure?',
    blurb: 'Both say "slow down", but they are triggered by different things.',
    patterns: ['rate-limiting', 'backpressure'],
    rows: [
      { aspect: 'Trigger', values: ['A fixed policy: this client may send N per second', 'The real, current state of the consumer: its buffer is full'] },
      { aspect: 'Who is told', values: ['Clients, with 429 and Retry-After', 'The upstream producer or stage'] },
      { aspect: 'Adapts to load', values: ['No, the limit stays the same until changed', 'Yes, it follows the consumer\'s actual speed'] },
      { aspect: 'Typical place', values: ['API gateway or edge', 'Between stages inside a pipeline or between services'] },
    ],
    rule: 'Use rate limiting to enforce fairness and quotas at the edge. Use backpressure to keep internal pipelines stable when a stage is slower than the one before it.',
  },
  {
    title: 'Event sourcing, CQRS or the outbox?',
    blurb: 'They often appear together, but each solves a different problem and none requires the others.',
    patterns: ['event-sourcing', 'cqrs', 'transactional-outbox'],
    rows: [
      { aspect: 'Core idea', values: ['Store the sequence of events as the source of truth', 'Use separate models for writing and for reading', 'Write the event in the same transaction as the data, then relay it'] },
      { aspect: 'Solves', values: ['Full history, audit, rebuilding state', 'Different read and write needs, independent scaling', 'Saving data and publishing an event without losing either'] },
      { aspect: 'Introduces', values: ['Replay cost, snapshots, event versioning', 'Read models that lag behind writes', 'A relay process and duplicate events'] },
      { aspect: 'Works without the others?', values: ['Yes', 'Yes', 'Yes'] },
    ],
    rule: 'Reach for event sourcing when history matters, CQRS when reads and writes pull in different directions, and the outbox whenever a database change must reliably produce a message.',
  },
  {
    title: 'API gateway or load balancer?',
    blurb: 'Both sit in front of your servers and forward requests, but they solve different problems.',
    patterns: ['load-balancing', 'api-gateway'],
    rows: [
      { aspect: 'Main job', values: ['Spread traffic over identical instances of one service', 'Be the single front door to many different services'] },
      { aspect: 'Understands', values: ['Connections and health, sometimes paths and headers', 'Routes, tokens, API keys, rate limits and request shapes'] },
      { aspect: 'Typical features', values: ['Health checks, balancing algorithms, failover', 'Authentication, rate limiting, routing by path, caching, logging'] },
      { aspect: 'Relationship', values: ['Often placed in front of the gateway and behind it, for each service', 'Sends each request to the right service, which sits behind its own load balancer'] },
    ],
    rule: 'A load balancer answers "which copy of this service should take the request?". A gateway answers "which service should take it, and may this caller make it at all?". Most systems use both.',
  },
  {
    title: 'Webhooks, message queues or pub/sub?',
    blurb: 'All three deliver events asynchronously. They differ in who runs the infrastructure and how delivery is guaranteed.',
    patterns: ['webhooks', 'message-queues', 'pub-sub'],
    rows: [
      { aspect: 'Transport', values: ['An HTTP request to a URL the receiver exposes', 'A broker that holds messages until a worker takes them', 'A broker that copies each event to every subscriber'] },
      { aspect: 'Where it fits', values: ['Between organisations or separate systems with no shared infrastructure', 'Inside one system, to share out work', 'Inside one system, to broadcast facts to several consumers'] },
      { aspect: 'If the receiver is down', values: ['The sender retries on a schedule and may eventually give up', 'Messages wait in the queue until a worker returns', 'Each subscriber catches up from its own position'] },
      { aspect: 'Receiver must', values: ['Verify signatures, reply fast and deduplicate', 'Acknowledge each message and be idempotent', 'Handle its own copy and be idempotent'] },
    ],
    rule: 'Use webhooks to push events across a company boundary, and a queue or pub/sub inside your own system. A common pattern is a webhook endpoint that does nothing but verify the request and put it on a queue.',
  },
  {
    title: 'Hashing, encryption or signing?',
    blurb: 'Three tools that all turn data into something unreadable. They answer different questions.',
    patterns: ['password-hashing', 'encryption', 'authentication-and-authorization'],
    rows: [
      { aspect: 'Reversible?', values: ['No: you can only compare a new hash to the stored one', 'Yes: with the key you get the original back', 'A signature is checked, not reversed'] },
      { aspect: 'Question it answers', values: ['Does this password match the one set earlier?', 'Can anyone without the key read this?', 'Is this token genuine and unchanged, and is its holder allowed to do this?'] },
      { aspect: 'Needs a key?', values: ['No key, but a unique salt per value', 'Yes, and protecting it is the hard part', 'Yes: a secret or private key to sign, a matching key to verify'] },
      { aspect: 'Typical use', values: ['Storing passwords', 'Protecting data at rest and in transit', 'Login tokens and API authentication'] },
    ],
    rule: 'If you never need the original back, hash it (passwords). If you do, encrypt it. If you only need to prove it came from you and was not changed, sign it.',
  },
  {
    title: 'XSS, CSRF or SQL injection?',
    blurb: 'Three of the most common web attacks. They abuse trust in different places.',
    patterns: ['injection-and-xss', 'csrf-and-cors'],
    rows: [
      { aspect: 'What is abused', values: ['The application treats user input as code: SQL for the database or script for the browser', 'The server trusts a request because the browser attached the user\'s cookie'] },
      { aspect: 'Where the attacker\'s content runs', values: ['In the database, or in every visitor\'s browser', 'It does not run: the user\'s own browser sends a forged request'] },
      { aspect: 'Main defences', values: ['Parameterized queries, output encoding, content security policy', 'SameSite cookies, CSRF tokens, Origin checks'] },
      { aspect: 'Does CORS help?', values: ['No', 'No: CORS controls reading responses, not sending requests'] },
    ],
    rule: 'Injection is about untrusted input becoming code, CSRF is about untrusted sites causing trusted requests. XSS can defeat CSRF tokens, so fix both.',
  },
  {
    title: 'Logs, metrics or traces?',
    blurb: 'The three pillars of observability. Each answers a different question, and they work best together.',
    patterns: ['structured-logging', 'metrics', 'distributed-tracing'],
    rows: [
      { aspect: 'What it records', values: ['Individual events with details', 'Numbers aggregated over time', 'The path and timing of one request across services'] },
      { aspect: 'Best question', values: ['What exactly happened in this case?', 'Is it healthy, and is it getting worse?', 'Where did this request spend its time?'] },
      { aspect: 'Cost', values: ['High: large, indexed per event', 'Low: compact, fixed size per series', 'Medium to high, usually sampled'] },
      { aspect: 'Link to the others', values: ['A trace id on each line leads to the trace', 'An alert leads to logs and traces for that time', 'Spans link back to the logs of each service'] },
    ],
    rule: 'Metrics tell you that something is wrong, traces tell you where, and logs tell you why. Put a shared request id on all three.',
  },
  {
    title: 'SLI, SLO and alerts',
    blurb: 'Three layers that are often confused. Each builds on the one before.',
    patterns: ['metrics', 'slos-and-error-budgets', 'alerting'],
    rows: [
      { aspect: 'What it is', values: ['A measured signal, such as the share of requests that succeed (the SLI)', 'A target for that signal and the budget it implies', 'A rule that notifies a person when the target is at risk'] },
      { aspect: 'Question it answers', values: ['How are we doing right now?', 'How good do we need to be?', 'Does a human need to act right now?'] },
      { aspect: 'Changes how often', values: ['Continuously', 'Rarely, by agreement', 'Whenever tuning shows noise or gaps'] },
    ],
    rule: 'Measure with metrics, set a target with an SLO, and alert only when the target is being spent too fast.',
  },
  {
    title: 'Liveness, readiness or a deep check?',
    blurb: 'Three kinds of health check that must not be mixed up, or a minor problem can become an outage.',
    patterns: ['health-checks', 'load-balancing', 'circuit-breaker'],
    rows: [
      { aspect: 'Question', values: ['Liveness: is this process stuck? Readiness: can it take traffic now?', 'Which instances should receive the next request?', 'Is a dependency failing, so calls to it should stop?'] },
      { aspect: 'Acts on', values: ['The orchestrator restarts, or the balancer removes the instance', 'The load balancer, using the readiness result', 'Callers, which fail fast for a while'] },
      { aspect: 'Should depend on', values: ['The instance itself only', 'Readiness results from each instance', 'The dependency, from the caller\'s own calls'] },
    ],
    rule: 'Liveness and readiness look inward. Failing dependencies are handled by circuit breakers and fallbacks, so one shared outage does not remove every instance.',
  },
  {
    title: 'Real-time technique, HTTP version or transport?',
    blurb: 'Three different layers that are easy to mix up when talking about "how data gets to the browser".',
    patterns: ['real-time-communication', 'http-versions', 'tcp-vs-udp'],
    rows: [
      { aspect: 'Who starts each exchange', values: ['Polling: the client, every interval. Long polling: the client, held open until an event.', 'HTTP/2 and HTTP/3 let one connection carry many of these streams at once', 'The transport underneath: TCP for all four, UDP only under HTTP/3 (QUIC)'] },
      { aspect: 'Question it answers', values: ['How should the server tell the client something happened?', 'How can many requests share a connection efficiently?', 'How are packets delivered across the network?'] },
      { aspect: 'Layer', values: ['Application technique', 'Application protocol version', 'Transport protocol'] },
    ],
    rule: 'Choose the real-time technique for your use case, then let the HTTP version and the transport be decided by your server and CDN. They stack: a WebSocket may run over HTTP/1.1 on TCP, while HTTP/3 runs on UDP.',
  },
  {
    title: 'Forward proxy, reverse proxy, API gateway or load balancer?',
    blurb: 'These all sit in the middle of traffic, but for different sides and different jobs.',
    patterns: ['proxies', 'api-gateway', 'load-balancing'],
    rows: [
      { aspect: 'Sits on', values: ['Either side: client side (forward) or server side (reverse)', 'The server side, in front of many APIs', 'The server side, in front of copies of one service'] },
      { aspect: 'Main job', values: ['Hide, filter, cache, terminate TLS, compress', 'Authenticate, rate limit, route to the right service, version', 'Spread requests over healthy instances'] },
      { aspect: 'Knows about', values: ['HTTP requests and caching rules', 'API routes, tokens and consumers', 'Instance health and capacity'] },
    ],
    rule: 'A reverse proxy is the generic building block. A load balancer and an API gateway are reverse proxies with a specific job, and one product often does several of these jobs.',
  },
  {
    title: 'Leader election, consensus or quorums?',
    blurb: 'Three ways replicas coordinate. They overlap in ideas but solve different problems.',
    patterns: ['leader-election', 'consensus', 'quorums'],
    rows: [
      { aspect: 'What it decides', values: ['Which one node is in charge right now', 'The agreed order of operations in a log', 'How many replicas a read or write must touch'] },
      { aspect: 'Needs', values: ['A majority of nodes to vote', 'A majority to store each entry', 'R + W greater than N for fresh reads'] },
      { aspect: 'Single writer?', values: ['Yes: the leader', 'Yes: the leader orders writes, replicas agree', 'No: any replica can coordinate'] },
      { aspect: 'Gives you', values: ['Automatic failover, no split brain', 'Strong consistency and no lost committed writes', 'Tunable consistency and availability'] },
    ],
    rule: 'Consensus algorithms such as Raft include leader election. Quorum systems skip the leader and trade strict ordering for availability.',
  },
  {
    title: 'Two-phase commit, saga or consensus?',
    blurb: 'Three answers to agreement across machines. They differ in what must agree and what happens during failure.',
    patterns: ['two-phase-commit', 'saga', 'consensus'],
    rows: [
      { aspect: 'Agreement about', values: ['One transaction across several databases: commit everywhere or nowhere', 'A business process, undone by compensating steps on failure', 'A replicated log or a single value inside one replicated group'] },
      { aspect: 'Isolation', values: ['Strong: locks until the decision', 'None: intermediate states are visible', 'Strong inside the group'] },
      { aspect: 'On coordinator failure', values: ['Participants block holding locks', 'Compensations run from a durable record', 'A new leader takes over from the majority'] },
      { aspect: 'Best for', values: ['A few fast, reliable databases', 'Long-running work across many services', 'Metadata, locks and replicated state'] },
    ],
    rule: 'Use consensus to make a single coordinator reliable, two-phase commit for strict atomicity across a few stores, and sagas when services are many, slow or outside your control.',
  },
  {
    title: 'Blue-green, rolling or canary?',
    blurb: 'Three ways to put a new version into production. They trade speed, cost and how much risk users carry.',
    patterns: ['blue-green-and-rolling-deployments', 'canary-deployments', 'feature-flags'],
    rows: [
      { aspect: 'What changes', values: ['Where the traffic goes: a whole environment, or a few servers at a time', 'How much traffic the new version gets, in measured stages', 'Which users see a feature, without redeploying the code'] },
      { aspect: 'Rollback', values: ['Flip the router back (blue-green) or reverse the batches (rolling)', 'Route all traffic back to the stable version', 'Switch the flag off, in seconds'] },
      { aspect: 'Extra cost', values: ['A second full environment for blue-green; a little extra capacity for rolling', 'A small separate group of canary instances and a good metrics gate', 'A flag service, plus cleanup of old flags'] },
      { aspect: 'Catches problems that only show under real traffic', values: ['Only after the switch, though blue-green rolls back instantly', 'Yes, on a small share first', 'Yes, per user group'] },
    ],
    rule: 'They stack. Use a rolling or blue-green method to replace servers safely, a canary to learn whether the new version is healthy before everyone gets it, and a flag to decouple the release of a feature from the deploy.',
  },
  {
    title: 'Autoscaling, orchestration or infrastructure as code?',
    blurb: 'Three automation layers that are often described in the same breath. Each decides something different.',
    patterns: ['autoscaling', 'containers-and-orchestration', 'infrastructure-as-code'],
    rows: [
      { aspect: 'Decides', values: ['How many copies should run right now, from a metric', 'Which machine runs each copy, and replaces copies that die', 'What machines, networks and databases exist at all'] },
      { aspect: 'Reacts to', values: ['Load: CPU, requests, queue depth, a schedule', 'The gap between the desired and the actual state', 'A reviewed change to a configuration file'] },
      { aspect: 'Timescale', values: ['Seconds to minutes, with warm-up and cooldown', 'Seconds', 'Minutes to hours, when a person applies a change'] },
      { aspect: 'Typical failure', values: ['Flapping, or scaling too late for a spike', 'Pods that cannot be placed, or are evicted for lack of memory', 'A rename or immutable change that destroys and recreates a resource'] },
    ],
    rule: 'Infrastructure as code creates the cluster, the orchestrator runs the containers on it, and autoscaling changes how many of them there are. A problem in one layer often shows up as a symptom in another.',
  },
  {
    title: 'Write-ahead log, replication or backup?',
    blurb: 'Three ways of keeping a second copy of your data. They protect against different things, and none replaces the others.',
    patterns: ['write-ahead-log', 'database-replication', 'backups-and-point-in-time-recovery'],
    rows: [
      { aspect: 'Protects against', values: ['A crash or power loss on this one server', 'Losing a server or a zone, and read load', 'A bad deploy, an accidental delete, corruption, losing everything'] },
      { aspect: 'Does it copy a mistake?', values: ['Yes, it records every change, including a bad one', 'Yes, within a second or so', 'No: you restore to a moment before the mistake'] },
      { aspect: 'Where it lives', values: ['The same machine, as a fast sequential file', 'Other machines, kept up to date continuously', 'Separate storage, ideally another account or region'] },
      { aspect: 'Recovery time', values: ['Seconds to minutes: replay since the last checkpoint', 'Seconds: promote the replica', 'Minutes to hours: restore, then replay the log'] },
    ],
    rule: 'They are layers fed by the same log. The log gets you through a crash, a replica through a failed machine, and a backup with the archived log through a human mistake. Test the restore, not just the backup.',
  },
];
