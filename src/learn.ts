// "Why was I wrong?": for a quiz question, find the part of its page that teaches the idea, so a missed answer links to a lesson.
// It compares the words of the question, correct answer and explanation with each section of the page and picks the closest one.
// No per-question data is needed, so new quizzes get links automatically.
import type { CollectionEntry } from 'astro:content';
import { url } from './url.ts';

export interface LearnLink { where: string; href: string; concepts: { name: string; href: string }[] }
type Ref = { kind?: string; slug: string };
interface Section { id: string; label: string; text: string; concepts?: Ref[] }
interface Q { question: string; options: string[]; answer: number; explanation: string }

const STOP = new Set('about above after again also another because before being between both could does doing each from have having into just more most much must only other over same should since some such than that their them then there these they this those through under until very want what when where which while with without would your will been were was are and the for not but can its you our out any all one two how why who'.split(' '));
const MIN_WORD = 4; // shorter words are mostly grammar, so they do not tell sections apart
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= MIN_WORD && !STOP.has(w)));
// Long sections share more words with anything, so the score divides by a gentle power of the section's size (at least SMALL_SECTION words).
const SMALL_SECTION = 8, LENGTH_DAMPING = 0.35;

function best(q: Q, sections: Section[]) {
  const want = words(`${q.question} ${q.options[q.answer]} ${q.explanation} ${q.explanation}`);
  let top = sections[0], score = -1;
  for (const s of sections) {
    const have = words(s.text);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared++;
    const v = shared / Math.pow(Math.max(have.size, SMALL_SECTION), LENGTH_DAMPING);
    if (v > score) { score = v; top = s; }
  }
  return top;
}

export function conceptLinks(refs: Ref[], names: Map<string, string>, patternNames: Map<string, string>) {
  const seen = new Set<string>(), out: { name: string; href: string }[] = [];
  for (const r of refs) {
    const isPattern = r.kind === 'pattern', key = `${isPattern ? 'p' : 'c'}:${r.slug}`;
    const name = (isPattern ? patternNames : names).get(r.slug);
    if (!name || seen.has(key)) continue;
    seen.add(key); out.push({ name, href: url(`${isPattern ? 'patterns' : 'concepts'}/${r.slug}/`) });
  }
  return out;
}

type ConceptData = CollectionEntry<'concepts'>['data'];
type PatternData = CollectionEntry<'patterns'>['data'];
type StudyData = CollectionEntry<'studies'>['data'];

const conceptSections = (data: ConceptData): Section[] => [
  { id: 'problem', label: 'The problem', text: data.problem },
  ...data.howItWorks.map((step, i) => ({ id: `how-${i}`, label: `How it works: ${step.title}`, text: `${step.title} ${step.text}` })),
  { id: 'gain', label: 'Trade-offs: what you gain', text: data.pros.join(' ') },
  { id: 'cost', label: 'Trade-offs: what it costs', text: data.cons.join(' ') },
  { id: 'use-when', label: 'Judgment: use it when', text: data.whenToUse.join(' ') },
  { id: 'skip-when', label: 'Judgment: skip it when', text: data.whenNotToUse.join(' ') },
  { id: 'pitfalls', label: 'Judgment: watch out for', text: data.pitfalls.join(' ') },
];

const patternSections = (data: PatternData): Section[] => [
  { id: 'problem', label: 'The problem', text: `${data.problem} ${data.pain.join(' ')}` },
  { id: 'solution', label: 'The solution', text: `${data.solution} ${data.benefits.join(' ')}` },
  { id: 'use-when', label: 'Judgment: use it when', text: data.whenToUse.join(' ') },
  { id: 'skip-when', label: 'Judgment: skip it when', text: data.whenNotToUse.join(' ') },
  { id: 'pitfalls', label: 'Judgment: watch out for', text: data.pitfalls.join(' ') },
];

const studySections = (data: StudyData): Section[] => [
  { id: 'first-attempt', label: 'The first attempt', text: `${data.firstAttempt.text} ${data.firstAttempt.limits.join(' ')}` },
  ...data.steps.map((step, i) => ({ id: `step-${i + 1}`, label: `Step ${i + 1}: ${step.title}`, text: `${step.title} ${step.problem} ${step.fix} ${step.tradeoff}`, concepts: step.concepts })),
  ...data.failures.map((failure, i) => ({ id: `fail-${i}`, label: `What if something fails: ${failure.scenario}`, text: `${failure.scenario} ${failure.impact} ${failure.answer}`, concepts: failure.concepts })),
  ...(data.alternatives ?? []).map((choice, i) => ({ id: `alt-${i}`, label: `Choices: ${choice.title}`, text: `${choice.title} ${choice.options.map((o) => `${o.name} ${o.pro} ${o.con}`).join(' ')} ${choice.pick}` })),
];

/** The page's sections are told apart by the fields only that kind of page has. */
const sectionsFor = (data: ConceptData | PatternData | StudyData): Section[] =>
  'howItWorks' in data ? conceptSections(data) : 'pain' in data ? patternSections(data) : studySections(data);

export function learnFor(kind: 'concepts' | 'patterns' | 'studies', slug: string, data: ConceptData | PatternData | StudyData, q: Q, names: Map<string, string>, patternNames: Map<string, string>): LearnLink {
  const base = url(`${kind === 'studies' ? 'case-studies' : kind}/${slug}/`);
  const section = best(q, sectionsFor(data));
  // Only case-study sections point at concepts; for the other kinds this is an empty list.
  return { where: section.label, href: `${base}#${section.id}`, concepts: conceptLinks(section.concepts ?? [], names, patternNames) };
}
