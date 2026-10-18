import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { pageDates, metaPath } from '../freshness';

// A sitemap of every page, so search engines find the concepts, patterns and case studies. Needs SITE for absolute URLs.
export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const dates = pageDates();
  const paths: { path: string; lastmod?: string }[] = ['', '/case-studies', '/practice', '/paths', '/compare', '/compare-concepts', '/search', '/review', '/interview', '/progress', '/map', '/cheatsheets', '/whats-new'].map((path) => ({ path }));
  for (const [collection, dir] of [['concepts', 'concepts'], ['patterns', 'patterns'], ['studies', 'case-studies']] as const) {
    for (const entry of await getCollection(collection)) paths.push({ path: `/${dir}/${entry.id}`, lastmod: dates.updated.get(metaPath(collection, entry.id)) });
  }
  const locs = site ? paths.map((p) => `  <url><loc>${new URL(`${base}${p.path}/`, site).href}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}</url>`) : [];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.join('\n')}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
