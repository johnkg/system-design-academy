// A reading map derived from the existing data (no new content): concepts are linked by their `related` lists
// (same area, or both list each other), and a link points "backwards" when the other concept is easier. "Read first" = related and easier; "Opens the door to" = related and harder.
import { url } from './url.ts';

const rank = { beginner: 0, intermediate: 1, advanced: 2 } as const;
type Level = keyof typeof rank;
interface Node { slug: string; name: string; area: string; level: Level; href: string; first: string[]; next: string[]; studies: { slug: string; name: string; href: string }[] }


const MAX_READ_FIRST = 4; // the most connected easier concepts shown as "read first"; more becomes a reading list
export function buildGraph(concepts: any[], studies: any[]): Node[] {
  const by = new Map<string, any>(concepts.map((c) => [c.id, c]));
  const links = new Map<string, Set<string>>(concepts.map((c) => [c.id, new Set<string>()]));
  for (const c of concepts) for (const r of c.data.related ?? []) {
    if (r.kind !== 'concept' || !by.has(r.slug) || r.slug === c.id) continue;
    // A link counts when the two concepts share an area or list each other; a one-way link across areas is usually "also see", not "learn first".
    const mutual = (by.get(r.slug).data.related ?? []).some((x: any) => x.kind === 'concept' && x.slug === c.id);
    if (mutual || by.get(r.slug).data.area === c.data.area) { links.get(c.id)!.add(r.slug); links.get(r.slug)!.add(c.id); }
  }
  const used = new Map<string, { slug: string; name: string; href: string }[]>();
  for (const s of studies) {
    const seen = new Set<string>();
    for (const step of s.data.steps) for (const r of step.concepts) if ((r.kind ?? 'concept') === 'concept') seen.add(r.slug);
    for (const slug of seen) used.set(slug, [...(used.get(slug) ?? []), { slug: s.id, name: s.data.name, href: url(`case-studies/${s.id}/`) }]);
  }
  const degree = (slug: string) => links.get(slug)?.size ?? 0;
  const first = (slug: string) => [...links.get(slug)!].filter((o) => rank[by.get(o).data.difficulty as Level] < rank[by.get(slug).data.difficulty as Level])
    .sort((a, b) => degree(b) - degree(a) || a.localeCompare(b)).slice(0, MAX_READ_FIRST);
  const firsts = new Map(concepts.map((c) => [c.id, first(c.id)]));
  return concepts.map((c) => ({
    slug: c.id, name: c.data.name, area: c.data.area, level: c.data.difficulty, href: url(`concepts/${c.id}/`),
    first: firsts.get(c.id)!,
    next: concepts.filter((o) => firsts.get(o.id)!.includes(c.id)).map((o) => o.id).sort(),
    studies: (used.get(c.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
