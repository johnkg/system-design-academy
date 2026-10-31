import { defineConfig } from 'astro/config';

// On GitHub Pages the site lives at https://<owner>.github.io/<repo>/.
// The deploy workflow sets SITE and BASE; locally both fall back to root.
export default defineConfig({
  site: process.env.SITE || undefined,
  base: process.env.BASE || '/',
  trailingSlash: 'always',
  markdown: {
    shikiConfig: { themes: { light: 'github-light-default', dark: 'github-dark-default' } },
  },
});
