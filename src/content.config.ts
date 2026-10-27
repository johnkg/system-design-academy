import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Self-check shown at the end of a page: scenario questions with one best answer each.
export const QUIZ_QUESTIONS = 3; // per page
export const QUIZ_OPTIONS = 4; // per question
const quizSchema = z.array(z.object({
  question: z.string(),
  options: z.array(z.string()).length(QUIZ_OPTIONS),
  answer: z.number().int().min(0).max(QUIZ_OPTIONS - 1),
  explanation: z.string(),
})).length(QUIZ_QUESTIONS).optional();

const patterns = defineCollection({
  // One folder per pattern; the folder name is the slug.
  loader: glob({
    pattern: '*/meta.json',
    base: './src/content/patterns',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    name: z.string(),
    category: z.enum(['creational', 'structural', 'behavioral']),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    intent: z.string(), // one-line summary
    scenario: z.string(), // the example every language implements
    problem: z.string(),
    solution: z.string(),
    pain: z.array(z.string()), // what hurts in the "before" code
    benefits: z.array(z.string()), // what the pattern buys in the "after" code
    whenToUse: z.array(z.string()),
    whenNotToUse: z.array(z.string()),
    pitfalls: z.array(z.string()),
    related: z.array(z.string()).default([]),
    roles: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
    quiz: quizSchema,
  }),
});

const concepts = defineCollection({
  // System design concepts: one folder per concept under src/content/concepts.
  loader: glob({
    pattern: '*/meta.json',
    base: './src/content/concepts',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    name: z.string(),
    area: z.enum(['scaling', 'data', 'messaging', 'reliability', 'api', 'security', 'observability', 'networking', 'distributed', 'deployment', 'databases', 'dataengineering', 'aiml']),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    intent: z.string(), // one-line summary
    scenario: z.string(), // the running example used in the animation and simulation
    problem: z.string(),
    howItWorks: z.array(z.object({ title: z.string(), text: z.string() })),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
    whenToUse: z.array(z.string()),
    whenNotToUse: z.array(z.string()),
    pitfalls: z.array(z.string()),
    related: z.array(z.object({ kind: z.enum(['concept', 'pattern']), slug: z.string() })).default([]),
    roles: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
    quiz: quizSchema,
  }),
});

const conceptRef = z.object({ kind: z.enum(['concept', 'pattern']).default('concept'), slug: z.string() });

const studies = defineCollection({
  // Case studies: "design X" walkthroughs that combine concepts. One folder per study under src/content/studies.
  loader: glob({
    pattern: '*/meta.json',
    base: './src/content/studies',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    name: z.string(),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    intent: z.string(), // one-line summary
    prompt: z.string(), // the problem as an interviewer would pose it
    codeTitle: z.string().default('Code'), // heading text after "Code:"
    finalIntro: z.string().default('One request through the finished design.'),
    functional: z.array(z.string()),
    nonFunctional: z.array(z.string()),
    firstAttempt: z.object({ text: z.string(), limits: z.array(z.string()) }),
    // The diagram grows one step at a time. Nodes and edges appear at `at` and disappear before `until`.
    // Step 0 is the first attempt; each entry in `steps` is step 1, 2, ...
    nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string(), x: z.number(), y: z.number(), at: z.number().default(0), until: z.number().optional() })),
    edges: z.array(z.object({ from: z.string(), to: z.string(), at: z.number().default(0), until: z.number().optional() })),
    quiz: quizSchema,
    steps: z.array(z.object({
      title: z.string(),
      problem: z.string(),
      fix: z.string(),
      tradeoff: z.string(),
      concepts: z.array(conceptRef),
    })),
    failures: z.array(z.object({ scenario: z.string(), impact: z.string(), answer: z.string(), concepts: z.array(conceptRef) })),
    alternatives: z.array(z.object({
      title: z.string(),
      options: z.array(z.object({ name: z.string(), pro: z.string(), con: z.string() })),
      pick: z.string(),
    })),
    roles: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
    // Public write-ups a company-named study is built from. Shown at the end of the page; check:content requires https links.
    sources: z.array(z.object({ title: z.string(), publisher: z.string(), year: z.number().int(), url: z.string().url() })).optional(),
  }),
});

export const collections = { patterns, concepts, studies };
