// The pure half of the idea advisor (/advisor/): reads a description of an app or a page and says which needs it shows
// and which case studies are closest to it. No AI and no server: it matches words, in the browser, so the page can say
// exactly which words it went by and the reader can correct it. Tested in tests/advisor.test.ts.

/** Something on the site to use for a need, with the reason in one line. */
export interface Use { kind: 'concept' | 'pattern' | 'study'; slug: string; because: string }
/** A need an idea can have ("people see each other's changes live") and what to use for it. */
export interface Need {
  id: string;
  /** The tick box: the need in the reader's words. */
  label: string;
  /** What this need means for the design, in one or two sentences. */
  why: string;
  /** Words and phrases in a description that show the need. Lower case; "real time" also matches "real-time". */
  words: string[];
  use: Use[];
}

const MIN_STEM = 4; // words this short are left alone
/** "queues" and "queue", "caching" and "cache", "payments" and "payment" should meet. The same rule the site search uses. */
export const stem = (w: string) => {
  if (w.length <= MIN_STEM) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > MIN_STEM + 2) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > MIN_STEM + 1) return w.slice(0, -2);
  return w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
};

/** The words of a text, lower case and stemmed, in order. Punctuation and hyphens separate words. */
export const tokens = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

/** Which needs a description shows: need id to the trigger words found, in the order of `needs`. */
export function detect(text: string, needs: Need[]): Map<string, string[]> {
  const hay = ` ${tokens(text).join(' ')} `;
  const out = new Map<string, string[]>();
  for (const need of needs) {
    const found = need.words.filter((w) => hay.includes(` ${tokens(w).join(' ')} `));
    if (found.length) out.set(need.id, found);
  }
  return out;
}

// Words that say nothing about which system an idea resembles.
const COMMON = new Set(tokens(`a an the and or but of to in on at for from with without by as is are be it its this that these those
  i we you they he she my our your their me us them can could should would will want wants need needs like make makes made
  build builds built create creates app apps application page pages site website web mobile platform system service tool
  user users people person customer customers someone everyone each every all any some many more most other others also
  have has do does get gets let lets use uses using used see sees show shows new one two when where what which who how
  then than so if not no only just very much up out into over about their there here
  design designs built how simple small big online list thing things something`));

/** A page to compare an idea with: the words of its name and of the rest of its text, already through tokens(). */
export interface Doc { key: string; name: string[]; body: string[] }
export interface Match { key: string; score: number; shared: string[] }

const NAME_WEIGHT = 3; // a word in a page's name says more than one in its text
const MIN_SCORE = 1.2; // below this the overlap is a coincidence
const NEAR_BEST = 0.5; // and a page must come this close to the best match to be listed beside it
/** The pages whose words overlap the description most. A word that few pages use counts for more than a common one. */
export function closest(text: string, docs: Doc[], limit: number): Match[] {
  const asked = [...new Set(tokens(text))].filter((w) => w.length > 2 && !COMMON.has(w));
  if (!asked.length || !docs.length) return [];
  const count = new Map<string, number>();
  for (const d of docs) for (const w of new Set([...d.name, ...d.body])) count.set(w, (count.get(w) ?? 0) + 1);
  const rarity = (w: string) => Math.log(1 + docs.length / (count.get(w) ?? docs.length));
  const scored = docs.map((d) => {
    const name = new Set(d.name), body = new Set(d.body);
    const shared = asked.filter((w) => name.has(w) || body.has(w));
    const score = shared.reduce((sum, w) => sum + rarity(w) * (name.has(w) ? NAME_WEIGHT : 1), 0);
    // One shared word deep in a page's text is a coincidence; in its name, or with a second word, it is a lead.
    const lead = shared.length > 1 || shared.some((w) => name.has(w));
    return { key: d.key, score: lead ? score : 0, shared };
  }).filter((m) => m.score >= MIN_SCORE).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.filter((m) => m.score >= scored[0].score * NEAR_BEST).slice(0, limit);
}
