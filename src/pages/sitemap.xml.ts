import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// A sitemap of every page, so search engines find the concepts, patterns and case studies. Needs SITE for absolute URLs.
export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const paths = ['', '/case-studies', '/paths', '/compare', '/compare-concepts'];
  for (const [collection, dir] of [['concepts', 'concepts'], ['patterns', 'patterns'], ['studies', 'case-studies']] as const) {
    for (const entry of await getCollection(collection)) paths.push(`/${dir}/${entry.id}`);
  }
  const locs = site ? paths.map((p) => `  <url><loc>${new URL(`${base}${p}/`, site).href}</loc></url>`) : [];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.join('\n')}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
