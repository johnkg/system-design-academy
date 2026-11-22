import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { url } from '../lib';
import { learnFor } from '../learn';

// Every quiz question on the site, for the review page (/review/). The page fetches this file after it has painted instead of carrying
// the questions in its own HTML: over a thousand questions made the page heavy enough to fall under its Lighthouse floor.
// Which questions are due lives in the browser (see sdaReview in the layout).
interface Q { id: string; title: string; href: string; question: string; options: string[]; answer: number; explanation: string; learn: { where: string; href: string; concepts: { name: string; href: string }[] } }

export const GET: APIRoute = async () => {
  const questions: Q[] = [];
  const conceptNames = new Map<string, string>(), patternNames = new Map<string, string>();
  for (const c of await getCollection('concepts')) conceptNames.set(c.id, c.data.name);
  for (const p of await getCollection('patterns')) patternNames.set(p.id, p.data.name);
  for (const [collection, key, dir] of [['concepts', 'concepts', 'concepts'], ['patterns', 'patterns', 'patterns'], ['studies', 'studies', 'case-studies']] as const) {
    for (const e of await getCollection(collection)) {
      (e.data.quiz ?? []).forEach((q, i) => questions.push({ id: `${key}/${e.id}#${i}`, title: e.data.name, href: url(`${dir}/${e.id}/#quiz`), ...q, learn: learnFor(key, e.id, e.data, q, conceptNames, patternNames) }));
    }
  }
  return new Response(JSON.stringify(questions), { headers: { 'Content-Type': 'application/json' } });
};
