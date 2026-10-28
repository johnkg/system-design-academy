import { languages } from './languages.config';

type RawModules = Record<string, string>;

const codeModules = import.meta.glob('/src/content/*/*/code/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as RawModules;

const beforeModules = import.meta.glob('/src/content/*/*/before/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as RawModules;

const jsonModules = import.meta.glob('/src/content/*/*/visuals/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, unknown>;

export interface Sample {
  lang: (typeof languages)[number];
  code: string;
}

export type Collection = 'patterns' | 'concepts' | 'studies';

function pick(modules: RawModules, collection: Collection, slug: string, dir: string): Sample[] {
  return languages.flatMap((lang) => {
    const key = `/src/content/${collection}/${slug}/${dir}/${lang.id}.${lang.ext}`;
    return key in modules ? [{ lang, code: modules[key] }] : [];
  });
}

export const getCode = (slug: string, collection: Collection = 'patterns') => pick(codeModules, collection, slug, 'code');
export const getBefore = (slug: string, collection: Collection = 'patterns') => pick(beforeModules, collection, slug, 'before');

export function getVisual<T>(slug: string, name: string, collection: Collection = 'patterns'): T | undefined {
  return jsonModules[`/src/content/${collection}/${slug}/visuals/${name}.json`] as T | undefined;
}

// A concept or pattern may ship an interactive simulation at src/playgrounds/<Name>Playground.astro,
// matched by its display name ignoring case, spaces and punctuation (scripts/check-content.mjs uses the same rule).
const playgrounds = import.meta.glob('/src/playgrounds/*.astro', { eager: true }) as Record<string, { default: any }>;
export const playgroundFor = (name: string) => {
  const want = `/${name.replace(/[^a-z0-9]+/gi, '')}playground.astro`.toLowerCase();
  return Object.entries(playgrounds).find(([p]) => p.toLowerCase().endsWith(want))?.[1].default;
};

/** The deploy base path without a trailing slash ('' locally, '/system-design-academy' on GitHub Pages). */
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (path: string) => `${base}/${path.replace(/^\//, '')}`;

// How long a page takes: the words on it at reading speed, plus time for its simulation and quiz.
const READ_WPM = 200;
const TRY_MINUTES = 3; // simulation and quiz on a concept or pattern page
const TRY_MINUTES_STUDY = 8; // the estimator, the break-it widget and the quiz on a case study
const words = (v: unknown): number =>
  typeof v === 'string' ? v.split(/\s+/).filter(Boolean).length
  : Array.isArray(v) ? v.reduce((n: number, x) => n + words(x), 0)
  : v && typeof v === 'object' ? Object.entries(v).reduce((n, [k, x]) => n + (['slug', 'href', 'answer', 'pick'].includes(k) ? 0 : words(x)), 0)
  : 0;
export const minutesFor = (kind: string, data: unknown) => Math.ceil(words(data) / READ_WPM) + (kind === 'study' ? TRY_MINUTES_STUDY : TRY_MINUTES);

/** Two-digit section number for lesson headings ("01"). */
export const pad = (n: number) => String(n).padStart(2, '0');

export interface Section { id: string; label: string; num: string }
/** Number the sections that exist on this page, in order; falsy entries (a part this page lacks) are skipped. */
export const numbered = (list: (readonly [string, string] | false | undefined | null)[]): Section[] =>
  list.filter((x): x is readonly [string, string] => !!x).map(([id, label], i) => ({ id, label, num: pad(i + 1) }));

// Lessons that stream moving dots by default (Flow mode in StepPlayer). A pilot: widen it once the look is approved.
export const FLOW_PILOT = new Set(['load-balancing', 'caching', 'url-shortener']);
