# Lighthouse

`npm run check:lighthouse` (after `npm run build`) runs Lighthouse with its default mobile settings (a slow phone on a slow 4G connection) on six pages and fails when a score falls below its floor. CI runs it as the `Lighthouse` job. It needs Chrome (`CHROME_PATH`, or Google Chrome or Chromium installed) and fetches a pinned Lighthouse with npx; Lighthouse is not a dependency of the site.

| Page | Performance | Accessibility | Best practices | SEO | Largest paint |
|---|---|---|---|---|---|
| Home | 99 | 100 | 100 | 100 | 1.8 s |
| A concept (caching) | 99 | 100 | 100 | 100 | 2.0 s |
| A case study (URL shortener) | 98 | 100 | 100 | 100 | 2.1 s |
| Plan an idea | 99 | 100 | 100 | 100 | 2.0 s |
| Search | 94 | 100 | 100 | 100 | 2.6 s |
| Review | 100 | 100 | 100 | 100 | 1.5 s |

Measured on 2026-11-18 (Review re-measured on 2026-11-22 after its questions moved out of the page). The floors are 85 for performance and 95 for the other three, a few points under these scores, because a score moves by a few points between runs. Layout shift is under 0.03 and blocking time is 0 ms on every page.

## What is heavy

The two lowest scores are the two pages that carry the most text:

- **Review**: every quiz question on the site (over a thousand) used to be inside the page, 1.5 MB of HTML, and the score fell to 84 as questions were added. The questions are now in `/review-data.json`, fetched after the first paint (the page is 20 KB), and the score is 100. The service worker pre-caches the file so review still works offline.
- **Search** (0.8 MB of HTML): the searchable text of every page is in one block of JSON.

Both are still in the green range. If one drops under its floor, the fix is to move that text out of the page into a file that is fetched after the first paint. Mind the service worker (`src/pages/sw.js.ts`): a file fetched later has to be cached too, or search and review stop working offline.

Every other page measured, including the heaviest case studies (about 400 KB of HTML), scores 98 or more.

## Run one page

```bash
npm run build
CHROME_PATH=/path/to/chrome node scripts/check-lighthouse.mjs --only search --verbose
```
