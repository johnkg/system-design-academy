/** What changed on the site, for readers. Newest first. Write what a learner would notice, not what a developer did. */
export interface Change { date: string; title: string; items: { text: string; href?: string }[] }

export const changelog: Change[] = [
  {
    date: '2026-10-20',
    title: 'Clearer quiz questions',
    items: [
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
