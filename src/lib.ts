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

export { base, url } from './url.ts';
export { minutesFor, pad, numbered, type Section } from './format.ts';
