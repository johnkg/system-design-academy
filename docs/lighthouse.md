# Lighthouse

`npm run check:lighthouse` (after `npm run build`) runs Lighthouse with its default mobile settings (a slow phone on a slow 4G connection) on six pages and fails when a score falls below its floor. CI runs it as the `Lighthouse` job. It needs Chrome (`CHROME_PATH`, or Google Chrome or Chromium installed) and fetches a pinned Lighthouse with npx; Lighthouse is not a dependency of the site.

| Page | Performance | Accessibility | Best practices | SEO | Largest paint |
|---|---|---|---|---|---|
| Home | 99 | 100 | 100 | 100 | 1.8 s |
| A concept (caching) | 99 | 100 | 100 | 100 | 2.0 s |
| A case study (URL shortener) | 98 | 100 | 100 | 100 | 2.1 s |
| Plan an idea | 99 | 100 | 100 | 100 | 2.0 s |
| Search | 94 | 100 | 100 | 100 | 2.6 s |
| Review | 89 | 100 | 100 | 100 | 3.2 s |

Measured on 2026-11-18. The floors are 85 for performance and 95 for the other three, a few points under these scores, because a score moves by a few points between runs. Layout shift is under 0.03 and blocking time is 0 ms on every page.

## What is heavy

The two lowest scores are the two pages that carry the most text:

- **Review** (1.2 MB of HTML before compression): every quiz question on the site is on the page, so the browser has a lot to parse before it paints.
- **Search** (0.8 MB of HTML): the searchable text of every page is in one block of JSON.

Both are still in the green range. If one drops under its floor, the fix is to move that text out of the page into a file that is fetched after the first paint. Mind the service worker (`src/pages/sw.js.ts`): a file fetched later has to be cached too, or search and review stop working offline.

Every other page measured, including the heaviest case studies (about 400 KB of HTML), scores 98 or more.

## Run one page

```bash
npm run build
CHROME_PATH=/path/to/chrome node scripts/check-lighthouse.mjs --only search --verbose
```
