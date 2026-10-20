// "Why was I wrong?": for a quiz question, find the part of its page that teaches the idea, so a missed answer links to a lesson.
// It compares the words of the question, correct answer and explanation with each section of the page and picks the closest one.
// No per-question data is needed, so new quizzes get links automatically.
import { url } from './lib';

export interface LearnLink { where: string; href: string; concepts: { name: string; href: string }[] }
type Ref = { kind?: string; slug: string };
interface Section { id: string; label: string; text: string; concepts?: Ref[] }
interface Q { question: string; options: string[]; answer: number; explanation: string }

const STOP = new Set('about above after again also another because before being between both could does doing each from have having into just more most much must only other over same should since some such than that their them then there these they this those through under until very want what when where which while with without would your will been were was are and the for not but can its you our out any all one two how why who'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));

function best(q: Q, sections: Section[]) {
  const want = words(`${q.question} ${q.options[q.answer]} ${q.explanation} ${q.explanation}`);
  let top = sections[0], score = -1;
  for (const s of sections) {
    const have = words(s.text);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared++;
    const v = shared / Math.pow(Math.max(have.size, 8), 0.35); // long sections should not win just for being long
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

export function learnFor(kind: 'concepts' | 'patterns' | 'studies', slug: string, data: any, q: Q, names: Map<string, string>, patternNames: Map<string, string>): LearnLink {
  const base = url(`${kind === 'studies' ? 'case-studies' : kind}/${slug}/`);
  if (kind === 'concepts') {
    const sections: Section[] = [
      { id: 'problem', label: 'The problem', text: data.problem },
      ...data.howItWorks.map((s: any, i: number) => ({ id: `how-${i}`, label: `How it works: ${s.title}`, text: `${s.title} ${s.text}` })),
      { id: 'gain', label: 'Trade-offs: what you gain', text: data.pros.join(' ') },
      { id: 'cost', label: 'Trade-offs: what it costs', text: data.cons.join(' ') },
      { id: 'use-when', label: 'Judgment: use it when', text: data.whenToUse.join(' ') },
      { id: 'skip-when', label: 'Judgment: skip it when', text: data.whenNotToUse.join(' ') },
      { id: 'pitfalls', label: 'Judgment: watch out for', text: data.pitfalls.join(' ') },
    ];
    const s = best(q, sections);
    return { where: s.label, href: `${base}#${s.id}`, concepts: [] };
  }
  if (kind === 'patterns') {
    const sections: Section[] = [
      { id: 'problem', label: 'The problem', text: `${data.problem} ${data.pain.join(' ')}` },
      { id: 'solution', label: 'The solution', text: `${data.solution} ${data.benefits.join(' ')}` },
      { id: 'use-when', label: 'Judgment: use it when', text: data.whenToUse.join(' ') },
      { id: 'skip-when', label: 'Judgment: skip it when', text: data.whenNotToUse.join(' ') },
      { id: 'pitfalls', label: 'Judgment: watch out for', text: data.pitfalls.join(' ') },
    ];
    const s = best(q, sections);
    return { where: s.label, href: `${base}#${s.id}`, concepts: [] };
  }
  const sections: Section[] = [
    { id: 'first-attempt', label: 'The first attempt', text: `${data.firstAttempt.text} ${data.firstAttempt.limits.join(' ')}`, concepts: [] },
    ...data.steps.map((s: any, i: number) => ({ id: `step-${i + 1}`, label: `Step ${i + 1}: ${s.title}`, text: `${s.title} ${s.problem} ${s.fix} ${s.tradeoff}`, concepts: s.concepts })),
    ...data.failures.map((f: any, i: number) => ({ id: `fail-${i}`, label: `What if something fails: ${f.scenario}`, text: `${f.scenario} ${f.impact} ${f.answer}`, concepts: f.concepts })),
    ...(data.alternatives ?? []).map((a: any, i: number) => ({ id: `alt-${i}`, label: `Choices: ${a.title}`, text: `${a.title} ${a.options.map((o: any) => `${o.name} ${o.pro} ${o.con}`).join(' ')} ${a.pick}`, concepts: [] })),
  ];
  const s = best(q, sections);
  return { where: s.label, href: `${base}#${s.id}`, concepts: conceptLinks(s.concepts ?? [], names, patternNames) };
}
