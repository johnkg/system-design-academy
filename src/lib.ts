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

export const url = (path: string) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
