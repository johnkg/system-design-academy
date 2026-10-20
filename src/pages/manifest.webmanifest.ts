import type { APIRoute } from 'astro';
import { base } from '../lib';

// Lets browsers offer to install the site as an app. Paths follow the deploy base, so this is generated rather than a static file.
export const GET: APIRoute = () => {
  return new Response(JSON.stringify({
    name: 'System Design Academy',
    short_name: 'Sys Design',
    description: 'Learn system design concepts, patterns and case studies visually, with simulations, code and quizzes.',
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#0e1016',
    theme_color: '#4f46e5',
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${base}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2), { headers: { 'Content-Type': 'application/manifest+json' } });
};
