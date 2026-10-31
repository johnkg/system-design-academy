/** What changed on the site, for readers. Newest first. Write what a learner would notice, not what a developer did. */
export interface Change { date: string; title: string; items: { text: string; href?: string }[] }

export const changelog: Change[] = [
  {
    date: '2026-10-31',
    title: 'Interview questions, readings under the animations and tidier how-to steps',
    items: [
      { text: '24 interview questions: ideas like caching and retries, classic designs like a rate limiter, and the "tell me about a time" kind. Open one to see what a strong answer covers, the follow-ups to expect, common slips and which pages to read next.', href: 'interview-questions/' },
      { text: 'A "Drill me" mode picks a question you have not tried, runs a 2, 3 or 5 minute clock you can pause, then lets you tick the points you covered. Your grades stay in this browser.', href: 'interview-questions/' },
      { text: 'Seven animations (caching, load balancing, rate limiting, circuit breaker, message queues, CDN and backpressure) now show small readings under the picture, such as tokens left in the bucket or database queries so far, that change as you step through.', href: 'concepts/rate-limiting/' },
      { text: 'Thirty-six "how to try it" steps now say what to press or set first, and 68 button and option names match the simulation exactly. The app icons and share image use the new colours.' },
      { text: 'Twelve more animations now show small readings under the picture: sharding, replication, consensus, retries, timeouts, load shedding, bulkheads, idempotency, quorums, leader election, consistent hashing, pub/sub, CQRS, sagas, health checks, autoscaling, DNS and failure detection.', href: 'concepts/autoscaling/' },
      { text: 'Interview questions you grade in the Drill come back on the same schedule as Review, and the Practice page shows your last mock interview score. Pages no longer jump while loading on a phone, and the concept map is filled in before the page finishes loading.' },
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
