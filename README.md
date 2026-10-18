# System Design Academy

Visual, interactive lessons on system design concepts and design patterns: diagrams, step-by-step animations, simulations, and code in several languages where it helps. See `PLAN.md` for the roadmap.

## Run

```bash
npm install
npm run dev            # http://localhost:4321
npm run build          # static site in dist/
npm run check:samples  # runs JS samples with Node, Python samples with `python3`, C# samples with `dotnet run`
```

If `npm install` fails with a cache permission error, add `--cache .tmp/npm-cache`.

## Add a concept

Create `src/content/concepts/<slug>/` containing:

- `meta.json`: text content (validated by `src/content.config.ts`; `area` is one of scaling, data, messaging, reliability, api, security, observability, networking, distributed, deployment, databases, dataengineering, aiml; add new areas in `src/data/areas.ts` and `src/content.config.ts`)
- `visuals/steps.json`: actors and frames for the animation
- optional `code/<language-id>.<ext>`: samples, checked by `npm run check:samples`
- `src/playgrounds/<ConceptName>Playground.astro`: the simulation (name without spaces or punctuation)

Use `src/content/concepts/load-balancing/` as the template. New areas are added in `src/data/areas.ts`.

## Add a design pattern

Create `src/content/patterns/<slug>/` containing:

- `meta.json`: text content (validated by `src/content.config.ts`)
- `code/<language-id>.<ext>`: the "after" sample, one file per language
- `before/<language-id>.<ext>`: the naive sample for the before/after view
- `visuals/diagram.json`: UML classes and edges
- `visuals/steps.json`: actors and frames for the step-through player
- optional `src/playgrounds/<PatternName>Playground.astro`: interactive demo (pattern name without spaces, case-insensitive match)

Use `src/content/patterns/observer/` as the template.

## Add a language

1. Add an entry to `src/languages.config.ts`.
2. Add `<id>.<ext>` files to each pattern's `code/` and `before/` folders.
3. Add a runner for the extension in `scripts/check-samples.mjs`.

No page or component changes are needed.

## Deploy to GitHub Pages

1. Push to a GitHub repository with `main` as the default branch.
2. In Settings, Pages, set Source to "GitHub Actions".
3. `.github/workflows/deploy.yml` checks samples, builds with the correct `SITE` and `BASE`, and deploys on every push to `main`.

## Accessibility

What is built in:

- Skip link, landmarks, a single `h1` per page, and a heading order that never skips a level.
- Visible focus rings on every control, `scroll-padding` so the sticky header never covers a focused item, and 30px minimum control height.
- Colour contrast meets WCAG AA in light and dark themes (code colours use the GitHub "default" Shiki themes for that reason; accent buttons use `--on-accent`).
- Diagrams expose a generated text description (classes, members, relationships) through `<title>`/`<desc>`.
- The step player narrates each step in an `aria-live` region, keeps focus on Prev/Next at the ends (`aria-disabled`, not `disabled`), and skips motion when the user prefers reduced motion.
- A small script in `Layout.astro` restores keyboard focus when a playground rebuilds or disables the button you just pressed.
- Icon-only controls have accessible names that include their visible text.

How it was checked: axe-core was run on every page in both themes, including after stepping through each animation and pressing every playground control, plus manual keyboard checks (skip link, focus return, Next at the last step). To repeat it, `npm install --save-dev axe-core`, copy `node_modules/axe-core/axe.min.js` into `public/`, load it in a page and call `axe.run()`; remove the copy afterwards. Since then `npm run check:pages` also covers reflow: every page is loaded at 320px (400% zoom) with the WCAG text-spacing overrides applied and must not scroll sideways. Windows high-contrast (forced colours) was checked by emulation: pressed buttons, the current page and quiz answers use outlines, borders and text ("Best answer", "Your answer"), not colour alone. Keyboard-only runs of the quiz, review and mock interview confirmed focus order, a visible focus indicator on every control, and that focus moves to the next sensible place when a panel changes. Quiz options are shown in a random order each time. Not yet covered: testing with a real screen reader (NVDA, VoiceOver) and with real Windows high-contrast themes.

## Levels
Case studies are graded by what a reader needs to follow them, not by length: **beginner** is a familiar product built around one dominant idea (URL shortener, leaderboard, notifications); **intermediate** combines several standard techniques or has a real consistency or scale trade-off (news feed, chat, checkout); **advanced** needs consensus, distributed transactions, storage-engine internals or global-scale operation (distributed SQL database, ledger, wide-column store, stock exchange). Concepts follow the same idea at the level of a single technique.

## Learning features
- **Progress:** every concept, pattern and case study page has a "Mark as done" button. Progress is stored in `localStorage` (key `sda-progress`) and never leaves the browser; cards show a "Done" flag and the case-study list can hide finished ones.
- **Paths (`/paths/`):** curated sequences driven by `src/data/paths.ts` (concepts first, case studies last). Slugs are validated, so a typo fails the build. The page shows "n of m done" and highlights the next item.
- **Practise first:** each case study opens with a guided panel in four steps: clarify the task (then compare with the study's requirements), guess one number and compare it with the page's own Estimator (any output row, with `50k` or `2M` style input), sketch your design, then tick the design moves your answer had. Everything is saved per study in `localStorage`.
- **Test yourself:** every concept, design pattern and case study ends with a three-question scenario quiz (`quiz` in `meta.json`: question, four options, the index of the best answer, an explanation; validated by the schema). Wrong answers are explained too, and each one links to the part of the page that teaches it (and, for case studies, the concepts behind it). `src/learn.ts` finds that section by comparing the question, answer and explanation with each section's text, so new quizzes get links without extra data. The last result is kept in `localStorage`. Answer keys were checked blind by independent reviewers (all 756 questions), which caught and fixed 23 wrong pattern and study keys, and option lengths are balanced so the longest option is not a giveaway.
- **Practice hub (`/practice/`):** one nav entry that leads to review, the mock interview, learning paths and your progress.
- **Mock interview (`/interview/`):** draws a case study (by level, optionally only unfinished ones), runs a 30, 45 or 60 minute clock split into clarify, estimate, high-level design, deep dive and wrap-up (10/10/35/30/15%), keeps notes per stage in `localStorage`, and ends with a checklist of the study's design moves. `?study=<slug>&min=<n>` reproduces a draw.
- **My progress (`/progress/`):** done counts, review summary and last quiz results, plus a JSON backup you can download and restore in another browser (done marks are merged, everything else is replaced).
- **Review (`/review/`):** spaced review over every quiz question. Ten at a time, drawn from topics you marked done or from everything. A right answer returns after 1, 3, 7, 14 and 30 days, a wrong one the next day; answers given on the quiz pages feed the same schedule (`localStorage` key `sda-review`). It also counts misses per question, lists the topics where you slip most, and has a "Questions I have missed" scope.
- **Offline and installable:** a service worker (`src/pages/sw.js.ts`) keeps pages you have visited, plus the practice pages, available without a connection; pages load network-first so you always get the newest version online, hashed build files are cache-first, and each deploy starts a fresh cache and deletes old ones. A page you have not opened yet shows `/offline/`. `manifest.webmanifest` and the icons in `public/` let browsers offer to install the site as an app. Progress, notes and review history already live in the browser, so they work offline too.
- **Search (`/search/`):** one box over concepts, patterns, case studies and their quiz questions, with a type filter. The site also has canonical and social tags (with the 1200x630 `public/og.png` preview image), `sitemap.xml` and `robots.txt` (they need `SITE`, which the deploy workflow sets).
- **Case-study search:** `/case-studies/` has search, a level filter and a "hide finished" toggle (also in the URL: `?q=`, `?level=`, `?hide=done`).
- **Checks:** `npm run check:content` (seconds, no browser) validates links between pages, that every page has a quiz, quiz sanity (identical options, references to an option by position, correct option too often the longest) and that visuals and samples exist; run it before committing content. `npm run check:samples` runs every JavaScript, Python and C# sample and, for concepts and studies, fails if the three languages print different output. `npm run check:pages` (after a build) opens every page in Chromium and fails on script errors, console errors, accessibility violations (axe), horizontal scroll at 375px, and any playground control that throws. CI installs Playwright and axe-core with `npm install --no-save`, so they are not dependencies of the site. Add `--font "DejaVu Sans"` to reproduce a runner with a wider default font. `.github/workflows/deploy.yml` runs both checks before deploying, and `check.yml` runs them on pull requests.

## Compare pages
- `/compare/` (design patterns) is driven by `src/data/compare.ts`.
- `/compare-concepts/` (system design concepts) is driven by `src/data/compareConcepts.ts`. Slugs are validated, so a typo fails the build.

## Adding a case study
1. Create `src/content/studies/<slug>/meta.json` (validated by `src/content.config.ts`; `codeTitle` and `finalIntro` set the heading and intro for the code and final-flow sections): requirements, first attempt, `nodes` and `edges` for the growing diagram (each has `at`, and optionally `until`, as a step number), `steps`, `failures` and `alternatives`. Concept and pattern slugs are checked at build time.
2. Optional: `visuals/final.json` (a step player flow), `code/javascript.js`, `code/python.py` and `code/csharp.cs` (run by `npm run check:samples`).
3. Optional: `src/studies/<slug>/Estimator.astro` (back-of-the-envelope numbers) and `BreakIt.astro` (a load simulation). Both are picked up by name.
4. Concept pages list the studies that use them automatically.
