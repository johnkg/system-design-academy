/** Interview questions with model answers. Each `covers` list is what a strong answer includes, written as short points to self-grade against.
 *  `read` links must name pages that exist: interview-questions.astro throws at build and scripts/check-content.mjs fails on an unknown slug. */
export type QuestionKind = 'concept' | 'design' | 'tradeoff';
export type QuestionLevel = 'beginner' | 'intermediate' | 'advanced';
export interface ReadLink { kind: 'concept' | 'study'; slug: string }
export interface InterviewQuestion {
  id: string;
  kind: QuestionKind;
  level: QuestionLevel;
  question: string;
  /** One or two sentences: the answer in short. */
  summary: string;
  /** 4 to 6 short points a strong answer includes. */
  covers: string[];
  /** 2 or 3 questions the interviewer is likely to ask next. */
  followUps: string[];
  /** 1 or 2 common ways to answer badly. */
  pitfalls: string[];
  read: ReadLink[];
}

export const kindLabels: Record<QuestionKind, string> = {
  concept: 'Concept',
  design: 'Design',
  tradeoff: 'Trade-off and story',
};

export const interviewQuestions: InterviewQuestion[] = [
  // Concept questions
  {
    id: 'cache-consistency', kind: 'concept', level: 'intermediate',
    question: 'How would you keep a cache consistent with the database?',
    summary: 'Treat the database as the source of truth, update it first, then delete the cached copy so the next read refills it. Put a time limit on every entry as a safety net, and accept that a short window of stale data is the price of speed.',
    covers: [
      'The database is the source of truth; the cache is a copy that can be thrown away.',
      'Cache-aside: read the cache, on a miss read the database and fill the cache.',
      'On a write, update the database first, then delete the cache key (deleting is safer than updating it).',
      'Give every entry a time to live, so a missed delete heals itself.',
      'Say the race out loud: a slow reader can put an old value back after a write.',
      'State what staleness the feature can tolerate, and skip the cache where it cannot.',
    ],
    followUps: [
      'What happens if the database write works but the cache delete fails?',
      'What happens when a popular key expires and thousands of requests miss at once?',
      'When would you update the cache on a write instead of deleting it?',
    ],
    pitfalls: [
      'Promising that the cache is never stale. Two copies of data can always disagree for a moment.',
      'Updating the cache before the database, so a failed write leaves a value that was never saved.',
    ],
    read: [{ kind: 'concept', slug: 'caching' }, { kind: 'study', slug: 'meta-cache-consistency' }, { kind: 'concept', slug: 'transactional-outbox' }],
  },
  {
    id: 'sql-or-nosql', kind: 'concept', level: 'beginner',
    question: 'When would you pick a relational database, and when a NoSQL store?',
    summary: 'Pick relational when the data has relationships, you need joins and multi-row transactions, and the questions you will ask are not fully known yet. Pick a key-value or document store when access is by key, the shape varies, or you must spread writes across many machines.',
    covers: [
      'Relational: tables, joins, transactions across rows, flexible queries.',
      'NoSQL is a family: key-value, document, wide-column and graph stores differ a lot.',
      'Choose from the access pattern: what do you read and write, and how often?',
      'Scaling writes is easier when data is split by a key, which NoSQL stores are built for.',
      'Many products use both: one for the core records, one for a specific heavy workload.',
    ],
    followUps: [
      'How would you store a social network\'s "follows" relationships?',
      'Can a relational database scale to a lot of traffic?',
    ],
    pitfalls: [
      'Saying NoSQL is faster or relational is old. Neither is true in general.',
      'Naming a product before saying what the data and queries look like.',
    ],
    read: [{ kind: 'concept', slug: 'sql-vs-nosql' }, { kind: 'concept', slug: 'acid-vs-base' }, { kind: 'concept', slug: 'database-indexing' }],
  },
  {
    id: 'idempotent-requests', kind: 'concept', level: 'intermediate',
    question: 'A client retries a payment request because the first one timed out. How do you avoid charging twice?',
    summary: 'Make the operation idempotent. The client sends a unique key with each attempt; the server stores the key with the result, and a repeat with the same key returns the stored result instead of charging again.',
    covers: [
      'A timeout means "unknown", not "failed": the first request may have worked.',
      'The client generates one idempotency key per intended action and reuses it on retries.',
      'The server saves the key and the outcome in the same transaction as the charge.',
      'A repeat with a known key returns the saved outcome; it does not run the work again.',
      'A uniqueness rule in the database stops two simultaneous attempts from both winning.',
      'Keys expire after a sensible period, such as a day or more.',
    ],
    followUps: [
      'What if two requests with the same key arrive at the same moment?',
      'What if the same key arrives with a different amount?',
      'Which HTTP methods are idempotent by definition?',
    ],
    pitfalls: [
      'Checking "was this charged already?" and then charging, as two separate steps. Two requests can both pass the check.',
      'Making the server create the key. The client must create it, or a retry looks like a new request.',
    ],
    read: [{ kind: 'concept', slug: 'idempotency' }, { kind: 'concept', slug: 'retries-and-backoff' }, { kind: 'study', slug: 'payment-system' }],
  },
  {
    id: 'safe-retries', kind: 'concept', level: 'beginner',
    question: 'How should a service retry a failed call to another service?',
    summary: 'Retry only errors that may succeed later, wait longer between attempts with some randomness, stop after a few tries, and only retry operations that are safe to repeat. Otherwise retries turn a small outage into a large one.',
    covers: [
      'Retry timeouts and temporary errors; do not retry errors caused by a bad request.',
      'Exponential backoff: wait 100 ms, 200 ms, 400 ms and so on.',
      'Add jitter (a random wait) so clients do not all retry at the same moment.',
      'Cap the number of attempts and the total time.',
      'Only retry operations that are idempotent, or make them so.',
      'Set a timeout on every call so a retry is not waiting forever on the first one.',
    ],
    followUps: [
      'What is a retry storm, and how do you stop one?',
      'How does a circuit breaker work with retries?',
    ],
    pitfalls: [
      'Retrying immediately and forever. It adds load to a service that is already struggling.',
      'Retrying at every layer, so three layers with three tries each make 27 calls.',
    ],
    read: [{ kind: 'concept', slug: 'retries-and-backoff' }, { kind: 'concept', slug: 'timeouts-and-deadlines' }, { kind: 'concept', slug: 'circuit-breaker' }],
  },
  {
    id: 'choose-shard-key', kind: 'concept', level: 'intermediate',
    question: 'How do you choose a shard key?',
    summary: 'Choose a key that spreads data and traffic evenly and that your most common query includes, so one request touches one shard. Avoid keys that grow in order or that a few users dominate.',
    covers: [
      'Sharding splits one big dataset across machines so no machine holds it all.',
      'Start from the main query: the shard key should be in it, so a request hits one shard.',
      'Look for even spread; a few hot keys (a celebrity account) can overload one shard.',
      'A key that always increases, like a timestamp, sends all new writes to the newest shard.',
      'Hashing the key spreads load, but makes range queries harder.',
      'Say what gets hard: cross-shard queries and transactions, and moving data when you add shards.',
    ],
    followUps: [
      'How do you add a shard without moving most of the data?',
      'How would you run a query that needs data from every shard?',
      'What do you do about one very hot key?',
    ],
    pitfalls: [
      'Sharding too early. Caching and read replicas are simpler and often enough.',
      'Picking a key that looks natural (country, say) when the load is very uneven across its values.',
    ],
    read: [{ kind: 'concept', slug: 'database-sharding' }, { kind: 'concept', slug: 'consistent-hashing' }, { kind: 'concept', slug: 'ordering-and-partitioning' }],
  },
  {
    id: 'read-your-writes', kind: 'concept', level: 'intermediate',
    question: 'A user saves a profile change, reloads, and sees the old value. What is going on, and how do you fix it?',
    summary: 'Most likely the write went to the primary database and the read hit a replica that has not caught up yet. Fix it by sending that user\'s reads to the primary for a short while after a write, or by tracking how far the replica must have caught up.',
    covers: [
      'Replicas copy the primary with a small delay, called replication lag.',
      'The read came from a replica that had not yet received the write.',
      'The guarantee users expect is "read your own writes".',
      'Fix: read from the primary for a short time after that user writes.',
      'Alternative: remember the position of the write and only read from a replica that has reached it.',
      'Other users seeing the old value for a moment is usually fine; the writer seeing it is not.',
    ],
    followUps: [
      'What if the user opens the app on a second device?',
      'What other odd things can lag cause besides stale reads?',
    ],
    pitfalls: [
      'Sending all reads to the primary. It works, but removes the reason you added replicas.',
      'Blaming the cache without checking whether replicas are involved.',
    ],
    read: [{ kind: 'concept', slug: 'database-replication' }, { kind: 'concept', slug: 'consistency-models' }, { kind: 'concept', slug: 'cap-theorem' }],
  },
  {
    id: 'load-balancer-basics', kind: 'concept', level: 'beginner',
    question: 'What does a load balancer do, and how does it decide where to send a request?',
    summary: 'It spreads requests across several servers so no one server is overloaded and one failure does not take the service down. It picks a server by a rule such as round robin or fewest active connections, and stops using servers that fail health checks.',
    covers: [
      'It sits in front of several identical servers and gives clients one address.',
      'Simple rules: round robin (take turns), least connections (pick the least busy).',
      'Health checks remove a broken server and add it back when it recovers.',
      'Servers behind it should be stateless, or sessions must be stored elsewhere.',
      'The load balancer itself must not be a single point of failure: run more than one.',
    ],
    followUps: [
      'What if one user needs to keep talking to the same server?',
      'How is a layer 4 balancer different from a layer 7 one?',
    ],
    pitfalls: [
      'Forgetting that the balancer can be the single point of failure.',
      'Saying "round robin" without noticing that requests can have very different costs.',
    ],
    read: [{ kind: 'concept', slug: 'load-balancing' }, { kind: 'concept', slug: 'health-checks' }, { kind: 'concept', slug: 'horizontal-vs-vertical-scaling' }],
  },
  {
    id: 'why-a-queue', kind: 'concept', level: 'beginner',
    question: 'Why put a message queue between two services instead of calling one from the other?',
    summary: 'A queue lets the sender hand work off and move on, absorbs bursts of traffic, and keeps the work safe if the receiver is slow or down. The cost is that the result is not immediate and the receiver may see a message more than once.',
    covers: [
      'Decoupling: the sender does not wait for the receiver or need it to be up.',
      'Smoothing: a burst waits in the queue instead of overwhelming the receiver.',
      'Work can be shared by many workers reading the same queue.',
      'Cost: the answer is not immediate, so the user-facing flow must allow for that.',
      'Messages can be delivered more than once, so workers must handle repeats.',
      'Failed messages need a plan, such as a dead-letter queue to inspect later.',
    ],
    followUps: [
      'What if the queue grows faster than workers can drain it?',
      'How do you handle a message that always fails?',
    ],
    pitfalls: [
      'Using a queue for something the user must see the result of straight away.',
      'Assuming each message is processed exactly once with no extra work from you.',
    ],
    read: [{ kind: 'concept', slug: 'message-queues' }, { kind: 'concept', slug: 'backpressure' }, { kind: 'concept', slug: 'dead-letter-queues-and-poison-messages' }],
  },
  {
    id: 'how-indexes-work', kind: 'concept', level: 'beginner',
    question: 'What is a database index, and what does it cost?',
    summary: 'An index is a separate sorted structure that lets the database find rows by a column without reading the whole table. It makes matching reads faster but takes space and slows every write, because the index must be updated too.',
    covers: [
      'Without an index, a lookup reads every row (a full scan).',
      'An index is a sorted structure, often a B-tree, that finds rows quickly.',
      'It helps filters, joins and sorting on the indexed columns.',
      'Every insert, update and delete must also update each index.',
      'Indexes take storage space and memory.',
      'Index the columns your real queries use, not every column.',
    ],
    followUps: [
      'In which order do you list the columns of an index on two columns?',
      'How can you tell whether a query is using an index?',
    ],
    pitfalls: [
      'Adding an index for every column "just in case".',
      'Forgetting that an index on a column with only a few distinct values may not help.',
    ],
    read: [{ kind: 'concept', slug: 'database-indexing' }, { kind: 'concept', slug: 'query-planning-and-joins' }, { kind: 'concept', slug: 'lsm-trees-vs-b-trees' }],
  },
  {
    id: 'exactly-once', kind: 'concept', level: 'advanced',
    question: 'Can a message system deliver every message exactly once?',
    summary: 'Not as a pure network guarantee. Networks lose acknowledgements, so a system can promise at-most-once or at-least-once delivery. You get an exactly-once effect by delivering at least once and making the receiver ignore repeats.',
    covers: [
      'At-most-once: never repeats, but may lose messages.',
      'At-least-once: never loses, but may repeat messages.',
      'A lost acknowledgement means the sender cannot know whether the message arrived.',
      'Exactly-once effect = at-least-once delivery + an idempotent receiver.',
      'Dedupe using a message id stored in the same transaction as the work.',
      'Some platforms offer exactly-once inside their own system; the limit is at the edges, where other systems are involved.',
    ],
    followUps: [
      'How would you make a worker that sends an email idempotent?',
      'How do you update a database and publish an event without losing one of them?',
    ],
    pitfalls: [
      'Saying "we use a queue that guarantees exactly-once" and stopping there.',
      'Storing the dedupe id in a different place from the work, so a crash between the two breaks it.',
    ],
    read: [{ kind: 'concept', slug: 'delivery-guarantees' }, { kind: 'concept', slug: 'idempotency' }, { kind: 'concept', slug: 'transactional-outbox' }],
  },

  // Design questions: how a strong answer is structured
  {
    id: 'design-rate-limiter', kind: 'design', level: 'intermediate',
    question: 'Design a rate limiter for a public API.',
    summary: 'Clarify who is limited and what happens at the limit, pick an algorithm such as a token bucket, keep the counters in a fast shared store, and return a clear 429 response. Then discuss races, failure of the counter store, and many regions.',
    covers: [
      'Clarify: limit per user, API key or IP? Which limits? What does the client get when over?',
      'Algorithm: token bucket allows short bursts at a steady average; fixed window is simple but lets a double burst through at the edge.',
      'Where it runs: at the gateway or a shared service, before the real work.',
      'Counters live in a fast shared store, updated atomically so parallel requests cannot both slip through.',
      'Respond with 429 and a Retry-After header so well-behaved clients back off.',
      'Failure choice: if the counter store is down, allow requests (fail open) or block them (fail closed), and say why.',
    ],
    followUps: [
      'How do you keep limits accurate across several data centres?',
      'How would you give paying customers a higher limit?',
      'What if one user sends a huge burst all at once?',
    ],
    pitfalls: [
      'Keeping the counters in each server\'s memory, so the real limit grows with the number of servers.',
      'Not saying what clients see when blocked.',
    ],
    read: [{ kind: 'study', slug: 'rate-limiter-service' }, { kind: 'concept', slug: 'rate-limiting' }, { kind: 'concept', slug: 'load-shedding' }],
  },
  {
    id: 'design-url-shortener', kind: 'design', level: 'beginner',
    question: 'Design a URL shortener.',
    summary: 'Clarify scale and features, estimate that reads far outnumber writes, generate a short unique code for each link, store code to URL in a key-value store, and put a cache in front for popular links.',
    covers: [
      'Clarify: custom aliases, expiry, analytics? How many links per day, and how many clicks?',
      'Estimate: reads outnumber writes by a large factor, so the design is read-heavy.',
      'API: create a short link, and redirect (an HTTP 301 or 302) from the code to the long URL.',
      'Code generation: a counter encoded in base 62, or random codes checked for collisions.',
      'Storage: a key-value lookup from code to URL; it is simple to split by code.',
      'A cache for hot links, and a note on 301 (browsers cache it) versus 302 (you can still count clicks).',
    ],
    followUps: [
      'How do you stop two servers generating the same code?',
      'How would you count clicks without slowing the redirect?',
      'How long should a code be?',
    ],
    pitfalls: [
      'Using a hash of the URL and ignoring collisions.',
      'Sending every redirect to the database when a small cache would serve most of them.',
    ],
    read: [{ kind: 'study', slug: 'url-shortener' }, { kind: 'concept', slug: 'caching' }, { kind: 'study', slug: 'unique-id-generator' }],
  },
  {
    id: 'design-chat', kind: 'design', level: 'intermediate',
    question: 'Design a chat system.',
    summary: 'Keep a long-lived connection per online user, route each message to the connection holding the recipient, store every message durably first, and use a queue or push notification for people who are offline.',
    covers: [
      'Clarify: one-to-one or groups, group size, history, delivery receipts, media.',
      'A persistent connection (WebSocket) per online client for instant delivery.',
      'A way to find which server holds a user\'s connection, so a message can be routed there.',
      'Store the message before acknowledging it, so a crash does not lose it.',
      'Ordering inside one conversation, for example by a per-conversation sequence number.',
      'Offline users: keep messages for later sync and send a push notification.',
    ],
    followUps: [
      'How does a group of 100,000 people change the design?',
      'What happens to messages if a connection server crashes?',
      'How do you show who is online?',
    ],
    pitfalls: [
      'Polling the server every second instead of keeping a connection open.',
      'Ignoring offline users and message order.',
    ],
    read: [{ kind: 'study', slug: 'chat-system' }, { kind: 'concept', slug: 'real-time-communication' }, { kind: 'concept', slug: 'ordering-and-partitioning' }],
  },
  {
    id: 'design-news-feed', kind: 'design', level: 'intermediate',
    question: 'Design a news feed.',
    summary: 'Decide when to build each user\'s feed. Build it at write time (push) for ordinary accounts, build it at read time (pull) for accounts with huge followings, and mix the two. Cache the finished feeds and rank only a small set of candidates.',
    covers: [
      'Clarify: ranking or newest first, how many followers, how fresh must it be?',
      'Fan-out on write (push): when someone posts, add the post to each follower\'s feed list. Reads are fast.',
      'Fan-out on read (pull): build the feed when the user opens it. Writes are cheap, reads are slower.',
      'Mix: push for most accounts, pull for very large accounts, merged at read time.',
      'Cache each feed (a short list of post ids), then fetch post contents.',
      'Pagination with a cursor, so new posts do not shift the pages.',
    ],
    followUps: [
      'What happens when someone with 50 million followers posts?',
      'How would you add ranking?',
      'How do you handle a user who has been away for a month?',
    ],
    pitfalls: [
      'Choosing only push and forgetting accounts with huge followings.',
      'Reading every followed account\'s posts from the database on each page load.',
    ],
    read: [{ kind: 'study', slug: 'news-feed' }, { kind: 'concept', slug: 'pub-sub' }, { kind: 'concept', slug: 'caching' }],
  },
  {
    id: 'design-notifications', kind: 'design', level: 'intermediate',
    question: 'Design a notification system that sends push, email and SMS.',
    summary: 'Accept events through an API, check each user\'s preferences, put one job per channel on a queue, and let workers call the delivery providers with retries and deduplication. Track status so you can see what was sent.',
    covers: [
      'Clarify: which channels, volume, urgency, and whether a duplicate or a late message is worse.',
      'An entry point that accepts an event and fans it out to the right channels.',
      'Preferences and limits: opt-outs, quiet hours, and a cap so users are not flooded.',
      'A queue per channel so a slow email provider does not delay push messages.',
      'Workers retry with backoff and use an idempotency key so retries do not send twice.',
      'Status tracking and a dead-letter queue for messages that keep failing.',
    ],
    followUps: [
      'How do you send a million notifications for a sale without overloading providers?',
      'What if the email provider is down for an hour?',
      'How do you make sure a one-time code is sent only once?',
    ],
    pitfalls: [
      'Calling the provider directly inside the user\'s request.',
      'Retrying with no limit, which sends the same message many times.',
    ],
    read: [{ kind: 'study', slug: 'notification-system' }, { kind: 'concept', slug: 'message-queues' }, { kind: 'concept', slug: 'idempotency' }],
  },
  {
    id: 'design-leaderboard', kind: 'design', level: 'beginner',
    question: 'Design a game leaderboard that shows the top 100 and a player\'s own rank.',
    summary: 'Keep scores in a sorted structure that can give a rank quickly, such as a sorted set in an in-memory store, with the database holding the permanent record. For huge player counts, split by game or season and approximate far-down ranks.',
    covers: [
      'Clarify: number of players, update rate, global or friends, how live must it be?',
      'The slow way: sorting a table for every request does not scale.',
      'A sorted structure (for example a sorted set) gives top N and a player\'s rank in logarithmic time.',
      'The database remains the durable source; the sorted structure can be rebuilt from it.',
      'Scale: separate boards per game mode and season keeps each one small.',
      'Say that exact rank far down the list can be approximate (for example "top 5%").',
    ],
    followUps: [
      'How do you split a leaderboard that no longer fits on one machine?',
      'How would you reset it every week?',
    ],
    pitfalls: [
      'Running ORDER BY score on a huge table for every page view.',
      'Treating the in-memory copy as the only copy.',
    ],
    read: [{ kind: 'study', slug: 'leaderboard' }, { kind: 'concept', slug: 'caching' }, { kind: 'concept', slug: 'database-sharding' }],
  },
  {
    id: 'design-ticket-booking', kind: 'design', level: 'advanced',
    question: 'Design a ticket booking system where thousands of people want the same seats.',
    summary: 'Never sell a seat twice: hold a seat for a short time while the buyer pays, enforce that with a database rule or conditional update, release holds that expire, and control the crowd with a waiting queue.',
    covers: [
      'Clarify: numbered seats or general admission, hold time, how big the peak is.',
      'Correctness first: a seat must never be sold twice.',
      'Hold then buy: a seat is reserved with an expiry while the user pays.',
      'Enforce with an atomic conditional update (only if the seat is still free) or a version check.',
      'A job or expiry time releases abandoned holds.',
      'Protect the system at peak with a waiting room or queue, and make the payment step idempotent.',
    ],
    followUps: [
      'What if a payment succeeds just after the hold expired?',
      'Two users click the last seat at the same moment. What happens?',
      'How do you keep bots from taking all the seats?',
    ],
    pitfalls: [
      'Reading "is the seat free?" and then writing, as two steps without protection.',
      'Optimizing for speed before saying how double selling is prevented.',
    ],
    read: [{ kind: 'study', slug: 'ticket-booking' }, { kind: 'concept', slug: 'optimistic-concurrency-and-etags' }, { kind: 'study', slug: 'virtual-waiting-room' }],
  },
  {
    id: 'design-payments', kind: 'design', level: 'advanced',
    question: 'Design a payment system for an online shop.',
    summary: 'Treat money as something that must be correct before it is fast. Make every request idempotent, record every step in an append-only ledger, handle a multi-step flow with a saga and compensating actions, and reconcile against the provider\'s records.',
    covers: [
      'Clarify: card payments through an outside provider, refunds, multiple currencies?',
      'Idempotency keys on every payment request so retries never double charge.',
      'A payment moves through states (created, authorized, captured, failed), saved at every step.',
      'An append-only ledger: record changes, never edit past entries.',
      'Multi-step flows use a saga: if a later step fails, run an undo step for the earlier ones.',
      'Reconciliation: compare your records with the provider\'s every day and investigate differences.',
    ],
    followUps: [
      'The provider times out. Did the charge happen?',
      'How do you refund part of an order?',
      'How do you keep the order service and payment service in agreement?',
    ],
    pitfalls: [
      'Using floating point numbers for money. Use whole minor units such as cents.',
      'Assuming a call either succeeded or failed, with no "unknown" state.',
    ],
    read: [{ kind: 'study', slug: 'payment-system' }, { kind: 'concept', slug: 'idempotency' }, { kind: 'concept', slug: 'saga' }],
  },

  // Trade-off and behavioural questions
  {
    id: 'story-simple-beat-clever', kind: 'tradeoff', level: 'beginner',
    question: 'Tell me about a time a simple design beat a clever one.',
    summary: 'Use a real story of your own. Describe a problem where you or someone else wanted a sophisticated solution, the simple option you chose and why, and how it turned out, including what you gave up.',
    covers: [
      'Situation: the problem, in two sentences and in plain words.',
      'Task: what you were responsible for and what "good" looked like (cost, time, reliability).',
      'Action: the clever option, the simple option, and the facts that made you choose simple.',
      'Result: a measurable outcome, such as shipped sooner, fewer incidents or less code to run.',
      'Trade-off: what the simple design could not do, and what would make you revisit it.',
      'Lesson: how it changes the way you start the next design.',
    ],
    followUps: [
      'What would have made you pick the complex option?',
      'How did you convince others?',
    ],
    pitfalls: [
      'Inventing a perfect story. A real one, with a cost you accepted, is more believable.',
      'Describing what "we" did without saying what you did.',
    ],
    read: [{ kind: 'concept', slug: 'horizontal-vs-vertical-scaling' }, { kind: 'concept', slug: 'caching' }, { kind: 'concept', slug: 'graceful-degradation' }],
  },
  {
    id: 'story-disagreement', kind: 'tradeoff', level: 'intermediate',
    question: 'Tell me about a design disagreement with a teammate and how it ended.',
    summary: 'Pick a disagreement about the design, not about a person. Show that you listened, turned opinions into questions you could test, and committed to the result even if it was not your choice.',
    covers: [
      'Situation: what was being designed and what each side wanted.',
      'Task: your role, and why the decision mattered.',
      'Action: you wrote down each option, the criteria, and tested the risky assumption (a small experiment or a rough calculation).',
      'Result: what was decided, by whom, and how the team felt about it.',
      'If you were wrong, say so. If you were right, say what you learned about handling it.',
      'Lesson: how you will run the next disagreement earlier.',
    ],
    followUps: [
      'What if you could not agree?',
      'Would you make the same call today?',
    ],
    pitfalls: [
      'Telling a story where the other person was simply wrong.',
      'Skipping the Result and ending with how you felt.',
    ],
    read: [{ kind: 'concept', slug: 'sql-vs-nosql' }, { kind: 'concept', slug: 'cap-theorem' }, { kind: 'concept', slug: 'consistency-models' }],
  },
  {
    id: 'story-outage', kind: 'tradeoff', level: 'intermediate',
    question: 'Tell me about an outage or incident you dealt with. What did you change afterwards?',
    summary: 'Tell it in order: what users saw, how you found the cause, how you stopped the harm, and what you changed so it is less likely or less severe next time. Show calm, clear communication and learning without blame.',
    covers: [
      'Situation: what users saw, and how you found out (an alert or a customer).',
      'Task: your role in the response.',
      'Action: reduce harm first (roll back, turn a feature off), then find the cause.',
      'Communication: who you told, and how often.',
      'Result: how long it lasted and what was fixed for good.',
      'Follow-up: a better alert, a test, a safer deploy, or a design change, and how you chose it.',
    ],
    followUps: [
      'How did you know it was fixed?',
      'What would have caught it sooner?',
    ],
    pitfalls: [
      'Blaming one person or team.',
      'Describing the debugging in detail but not what changed afterwards.',
    ],
    read: [{ kind: 'concept', slug: 'alerting' }, { kind: 'concept', slug: 'slos-and-error-budgets' }, { kind: 'concept', slug: 'canary-deployments' }],
  },
  {
    id: 'story-vague-requirements', kind: 'tradeoff', level: 'beginner',
    question: 'How do you start a design when the requirements are vague?',
    summary: 'Ask questions first, write down assumptions, and design for the numbers you estimate rather than for an imagined huge scale. Check back with the people who asked, and make the design easy to change where you are least sure.',
    covers: [
      'Ask who uses it, how many, how fast it must be, and what must never go wrong.',
      'Write the assumptions down where everyone can see and correct them.',
      'Estimate a few numbers: requests per second, data per year.',
      'Start with the simplest design that meets those numbers.',
      'Mark the riskiest assumption and say how you would test it early.',
      'Agree what is out of scope for now.',
    ],
    followUps: [
      'What if the person cannot answer your questions?',
      'How do you avoid asking so many questions that you never start?',
    ],
    pitfalls: [
      'Starting to draw boxes before asking anything.',
      'Designing for a billion users because the requirements did not say otherwise.',
    ],
    read: [{ kind: 'concept', slug: 'horizontal-vs-vertical-scaling' }, { kind: 'concept', slug: 'slos-and-error-budgets' }, { kind: 'study', slug: 'url-shortener' }],
  },
  {
    id: 'tradeoff-consistency-or-availability', kind: 'tradeoff', level: 'advanced',
    question: 'Your service must stay up during a network split. Which data do you keep strictly correct, and which can be briefly stale?',
    summary: 'Decide per feature, not once for the whole system. Money, stock counts and unique names favour correctness, even if some requests must wait or fail. Feeds, view counts and recommendations favour staying available with slightly old data.',
    covers: [
      'During a network partition you cannot have both a correct answer everywhere and every request served.',
      'Choose per feature, based on the cost of a wrong answer versus the cost of an error.',
      'Strict: payments, inventory, unique usernames. Prefer to refuse a request than to be wrong.',
      'Relaxed: feeds, likes, counters. Serve the last known value and fix it up later.',
      'Say how the relaxed side recovers: merge rules, retries, or reconciliation.',
      'Tell the user what happened, such as "your like will appear shortly".',
    ],
    followUps: [
      'How would you merge two conflicting updates after the split heals?',
      'What does the user see for the strict features during the split?',
    ],
    pitfalls: [
      'Saying "we pick availability" or "we pick consistency" for the whole product.',
      'Treating the CAP idea as a menu where you pick two at all times, rather than a choice during a partition.',
    ],
    read: [{ kind: 'concept', slug: 'cap-theorem' }, { kind: 'concept', slug: 'consistency-models' }, { kind: 'concept', slug: 'graceful-degradation' }],
  },
  {
    id: 'tradeoff-scale-or-wait', kind: 'tradeoff', level: 'advanced',
    question: 'How do you decide when to scale a system and when to leave it alone?',
    summary: 'Measure first. Scale when a number you watch (latency, errors, saturation) approaches a limit you set, fix the actual bottleneck with the cheapest change, and avoid adding complexity for traffic you do not have yet.',
    covers: [
      'Define goals as numbers, such as a latency target and an error budget.',
      'Watch signals: latency, error rate, how full the resources are.',
      'Find the real bottleneck before changing anything (a slow query is not fixed by more servers).',
      'Prefer the cheapest fix first: an index, a cache, then replicas, then sharding.',
      'Plan ahead where changes are slow, such as data migrations, and not where they are easy.',
      'Name the cost of scaling too soon: more moving parts, more to break, more to operate.',
    ],
    followUps: [
      'How would you test that a design handles ten times the load?',
      'What would make you shard earlier than you would like?',
    ],
    pitfalls: [
      'Scaling on a guess without any measurement.',
      'Adding servers to a problem that is actually a single slow query or lock.',
    ],
    read: [{ kind: 'concept', slug: 'slos-and-error-budgets' }, { kind: 'concept', slug: 'horizontal-vs-vertical-scaling' }, { kind: 'concept', slug: 'queueing-theory-and-littles-law' }],
  },
];
