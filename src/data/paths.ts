/**
 * Curated learning paths. Every step is a slug that must exist: the Paths page throws at build time on a typo.
 * Order matters: earlier items are the ones later items lean on.
 */
interface PathStep { kind: 'concept' | 'pattern' | 'study'; slug: string; group?: string }
// maxMinutes is a promise made in the title ("Thirty minutes"): the Paths page throws at build time if the estimated reading time goes over it.
interface LearningPath { id: string; title: string; audience: string; blurb: string; steps: PathStep[]; maxMinutes?: number }

const c = (slug: string): PathStep => ({ kind: 'concept', slug });
const s = (slug: string): PathStep => ({ kind: 'study', slug });
// Labels a step with the day or stage it belongs to.
const day = (group: string, ...steps: PathStep[]): PathStep[] => steps.map((st) => ({ ...st, group }));

export const paths: LearningPath[] = [
  {
    id: 'thirty-minutes',
    title: 'Thirty minutes to get the idea',
    audience: 'Start here',
    blurb: 'Three ideas that sit under almost every large system: keep copies close, share the work, and let a slow job wait in line. Read each page, try its simulation and answer its quiz.',
    maxMinutes: 30,
    steps: [c('caching'), c('load-balancing'), c('message-queues')],
  },
  {
    id: 'from-web-developer',
    title: 'From web developer to system design',
    audience: 'Start here',
    blurb: 'You already know requests, browsers and databases. This path starts from what you have seen in the browser and follows a request to the servers, caches and data stores behind it.',
    steps: [c('latency-and-round-trips'), c('dns'), c('http-caching-headers'), c('caching'), c('cdn'), c('load-balancing'), c('authentication-and-authorization'), c('jwt-and-session-tokens'), c('pagination'), c('database-indexing'), s('url-shortener'), s('photo-sharing')],
  },
  {
    id: 'interview-week',
    title: 'One week to an interview',
    audience: 'Start here',
    blurb: 'A plan for seven short sessions. Four days of building blocks, then complete designs; each step shows how long it takes. On the last day, draw a task on the Mock interview page and explain your design aloud.',
    steps: [
      ...day('Day 1', c('load-balancing'), c('caching'), c('database-indexing')),
      ...day('Day 2', c('database-replication'), c('database-sharding'), c('consistent-hashing')),
      ...day('Day 3', c('message-queues'), c('delivery-guarantees'), c('idempotency')),
      ...day('Day 4', c('cap-theorem'), c('consistency-models'), c('rate-limiting')),
      ...day('Day 5', s('url-shortener'), s('rate-limiter-service')),
      ...day('Day 6', s('news-feed'), s('chat-system')),
      ...day('Day 7', s('payment-system')),
    ],
  },
  {
    id: 'interview-foundations',
    title: 'Interview foundations',
    audience: 'Interview preparation',
    blurb: 'The ten ideas that appear in almost every system design interview, then four classic designs that combine them.',
    steps: [c('load-balancing'), c('caching'), c('database-indexing'), c('database-replication'), c('database-sharding'), c('consistent-hashing'), c('message-queues'), c('cap-theorem'), c('rate-limiting'), c('api-styles'), s('url-shortener'), s('rate-limiter-service'), s('news-feed'), s('chat-system')],
  },
  {
    id: 'reliable-systems',
    title: 'Build reliable systems',
    audience: 'Production engineers',
    blurb: 'How a service stays useful when dependencies are slow, overloaded or gone, and how you measure that promise.',
    steps: [c('retries-and-backoff'), c('timeouts-and-deadlines'), c('idempotency'), c('graceful-degradation'), c('circuit-breaker'), c('bulkhead'), c('backpressure'), c('load-shedding'), c('health-checks'), c('slos-and-error-budgets'), s('alerting-and-on-call-system'), s('chaos-engineering-platform'), s('multi-region-active-active')],
  },
  {
    id: 'distributed-data',
    title: 'Distributed data and agreement',
    audience: 'Going deeper',
    blurb: 'How copies of data stay consistent, how machines agree on one answer, and the systems built on those tools.',
    steps: [c('consistency-models'), c('quorums'), c('logical-clocks'), c('leader-election'), c('consensus'), c('leases-and-fencing-tokens'), c('crdts'), s('key-value-store'), s('distributed-lock-service'), s('coordination-service'), s('distributed-sql-database'), s('distributed-transaction-coordinator')],
  },
  {
    id: 'inside-the-database',
    title: 'Inside the database',
    audience: 'Going deeper',
    blurb: 'What a database does underneath the SQL: logs, trees, versions and plans, then how whole databases are designed.',
    steps: [c('write-ahead-log'), c('lsm-trees-vs-b-trees'), c('mvcc-and-isolation-levels'), c('query-planning-and-joins'), c('online-schema-migrations'), c('backups-and-point-in-time-recovery'), s('document-database'), s('wide-column-store'), s('time-series-database'), s('zero-downtime-database-migration')],
  },
  {
    id: 'ship-safely',
    title: 'Ship safely',
    audience: 'Platform and DevOps',
    blurb: 'From code in a repository to many machines running it, and how to roll out changes without an outage.',
    steps: [c('infrastructure-as-code'), c('containers-and-orchestration'), c('blue-green-and-rolling-deployments'), c('feature-flags'), c('canary-deployments'), c('autoscaling'), c('multi-region-failover'), s('ci-cd-system'), s('code-deployment'), s('progressive-delivery-platform'), s('container-orchestrator')],
  },
  {
    id: 'security-and-trust',
    title: 'Security and trust',
    audience: 'Everyone shipping to users',
    blurb: 'Protect secrets and passwords, prove who a caller is, and see how identity and key systems are built.',
    steps: [c('password-hashing'), c('encryption'), c('tls-and-https'), c('authentication-and-authorization'), c('jwt-and-session-tokens'), c('oauth-and-openid-connect'), c('secrets-management'), c('supply-chain-security'), s('authentication-system'), s('identity-provider-sso'), s('key-management-service'), s('secrets-vault')],
  },
  {
    id: 'data-platforms',
    title: 'Data platforms',
    audience: 'Data engineers',
    blurb: 'Batches and streams, late data and state, and how warehouses and lakehouses are put together.',
    steps: [c('batch-vs-stream-processing'), c('mapreduce-and-shuffles'), c('windowing-and-watermarks'), c('stateful-stream-processing'), c('pipeline-orchestration'), c('columnar-formats-and-partitioning'), c('table-formats-and-the-lakehouse'), s('change-data-capture-pipeline'), s('data-warehouse'), s('stream-processing-engine'), s('lakehouse-platform')],
  },
  {
    id: 'ai-systems',
    title: 'AI systems in production',
    audience: 'New',
    blurb: 'Retrieval, serving, caching, safety and evaluation for language models, from the concepts to full platforms.',
    steps: [c('embeddings-and-vector-search'), c('retrieval-augmented-generation'), c('llm-inference-and-kv-cache'), c('continuous-batching-and-model-serving'), c('llm-caching-and-routing'), c('guardrails-and-prompt-injection'), c('model-evaluation-and-drift'), s('vector-database'), s('rag-platform'), s('llm-inference-gateway'), s('ai-agent-orchestration-platform')],
  },
  {
    id: 'how-llms-work',
    title: 'How a language model works',
    audience: 'Going deeper',
    blurb: 'From text to tokens, through attention and training, to sampling, memory and the limits of what a model knows. Then the systems that serve it.',
    steps: [c('tokens-and-tokenization'), c('attention-and-transformers'), c('how-models-are-trained'), c('sampling-temperature-and-decoding'), c('context-windows-and-long-context'), c('llm-inference-and-kv-cache'), c('quantization-and-model-compression'), c('scaling-laws-and-model-size'), c('hallucination-and-grounding'), c('retrieval-augmented-generation')],
  },
  {
    id: 'solid-and-beyond',
    title: 'Design principles that people get wrong',
    audience: 'Writing code',
    blurb: 'SOLID, DRY and the rest, each with the usual misreading and what it costs to over-apply it. Start with coupling and cohesion, which explain why the five principles exist, then take them one at a time.',
    steps: [c('coupling-and-cohesion'), c('single-responsibility-principle'), c('open-closed-principle'), c('liskov-substitution-principle'), c('interface-segregation-principle'), c('dependency-inversion-principle'), c('dry-and-the-wrong-abstraction'), c('composition-over-inheritance')],
  },
  {
    id: 'big-o-traps',
    title: 'Big O and the traps that catch people',
    audience: 'Writing code',
    blurb: 'Start with what Big O does and does not say, then the places where cost hides: loops, resizes, hash collisions, deep recursion, worst-case input and memory. Every page counts operations so you can watch the curves cross.',
    steps: [c('big-o-notation-basics'), c('hidden-complexity-in-loops'), c('amortized-analysis'), c('hash-tables-and-worst-case'), c('recursion-memoization-and-dynamic-programming'), c('sorting-and-searching-complexity'), c('space-time-tradeoffs'), c('trees-graphs-and-worst-case-shapes')],
  },
  {
    id: 'concurrent-code',
    title: 'Concurrency without the mystery bugs',
    audience: 'Writing code',
    blurb: 'Why two updates at once lose data, what locks fix and what they break, how async differs from threads, and how to size the workers and queues around them. Every page runs the same program under every ordering.',
    steps: [c('race-conditions-and-atomicity'), c('locks-deadlocks-and-contention'), c('threads-async-and-the-event-loop'), c('thread-pools-and-sizing'), c('producer-consumer-and-bounded-queues')],
  },
  {
    id: 'trustworthy-tests',
    title: 'Tests you can trust',
    audience: 'Writing code',
    blurb: 'Where to put tests, why they flake, how mocks make broken code pass, what coverage misses and how to find inputs you did not think of.',
    steps: [c('test-pyramid-and-where-to-test'), c('flaky-tests'), c('test-doubles-and-over-mocking'), c('coverage-and-mutation-testing'), c('property-based-testing-and-fuzzing')],
  },
  {
    id: 'shaping-a-system',
    title: 'Shaping a system: where to draw the lines',
    audience: 'Going deeper',
    blurb: 'From one deployable to many, and back from many to something sane: what each split costs, how to keep rules away from vendors, how to name boundaries, how events hide coupling, and how to migrate without a big bang.',
    steps: [c('monolith-modular-monolith-and-microservices'), c('hexagonal-architecture-ports-and-adapters'), c('domain-driven-design-and-bounded-contexts'), c('event-driven-architecture'), c('strangler-fig-and-incremental-migration')],
  },
  {
    id: 'design-habits',
    title: 'Design habits for code that stays changeable',
    audience: 'Writing code',
    blurb: 'Small habits that keep each change cheap: say only what you need, keep contracts and errors honest, pass collaborators in, and pay debt back in small steps.',
    steps: [c('kiss-yagni-and-premature-abstraction'), c('law-of-demeter-and-tell-dont-ask'), c('command-query-separation'), c('design-by-contract-and-defensive-programming'), c('fail-fast-and-error-handling-strategies'), c('least-astonishment-and-interface-design'), c('dependency-injection-and-inversion-of-control'), c('anemic-vs-rich-domain-models'), c('stable-dependencies-and-package-design'), c('technical-debt-and-refactoring')],
  },
  {
    id: 'graphs-and-search',
    title: 'Graphs, searching and ordering',
    audience: 'Writing code',
    blurb: 'From binary search and heaps to graph traversal, shortest paths, dependency order and connectivity, with operation counts for each.',
    steps: [c('binary-search-and-its-traps'), c('heaps-and-priority-queues'), c('graph-traversal-bfs-and-dfs'), c('shortest-paths-dijkstra-and-friends'), c('topological-sort-and-dependency-ordering'), c('union-find-and-connected-components'), c('tries-and-prefix-trees'), c('balanced-trees-and-why-they-balance')],
  },
  {
    id: 'problem-solving-patterns',
    title: 'Problem-solving patterns and their limits',
    audience: 'Writing code',
    blurb: 'Two pointers, greedy, divide and conquer, backtracking and randomization: when each works, when it quietly gives a wrong answer, and what to do when the problem is NP-hard.',
    steps: [c('two-pointers-and-sliding-window'), c('greedy-algorithms-and-when-they-fail'), c('divide-and-conquer-and-the-master-theorem'), c('backtracking-and-search-space-pruning'), c('randomized-algorithms-and-reservoir-sampling'), c('np-hard-problems-and-practical-approximation')],
  },
  {
    id: 'attacks-and-defences',
    title: 'How attacks work and what stops them',
    audience: 'Everyone shipping to users',
    blurb: 'Model the threats, then walk through the common ones (forged server requests, stolen passwords, reading the records of other users, injected script) and the logging that lets you respond.',
    steps: [c('threat-modeling-and-attack-surface'), c('ssrf-and-server-side-request-risks'), c('credential-stuffing-and-multi-factor-authentication'), c('idor-and-broken-object-level-authorization'), c('content-security-policy-and-browser-hardening'), c('hashing-signatures-and-hmac'), c('zero-trust-and-network-segmentation'), c('security-logging-and-incident-response')],
  },
  {
    id: 'network-troubleshooting',
    title: 'Networks: why connections misbehave',
    audience: 'Platform and DevOps',
    blurb: 'Firewalls and NAT, private networks, pools and idle timeouts, TIME_WAIT, packet sizes and floods: the causes behind the errors that do not show up in your code.',
    steps: [c('nat-firewalls-and-security-groups'), c('vpc-vpn-and-private-networking'), c('connection-pooling-and-keep-alive'), c('tcp-states-time-wait-and-port-exhaustion'), c('mtu-fragmentation-and-path-mtu'), c('ddos-and-traffic-filtering')],
  },
];
