/**
 * Curated learning paths. Every step is a slug that must exist: the Paths page throws at build time on a typo.
 * Order matters: earlier items are the ones later items lean on.
 */
export interface PathStep { kind: 'concept' | 'pattern' | 'study'; slug: string; group?: string }
// maxMinutes is a promise made in the title ("Thirty minutes"): the Paths page throws at build time if the estimated reading time goes over it.
export interface LearningPath { id: string; title: string; audience: string; blurb: string; steps: PathStep[]; maxMinutes?: number }

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
];
