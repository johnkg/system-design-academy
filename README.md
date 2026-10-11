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

- `meta.json`: text content (validated by `src/content.config.ts`; `area` is one of scaling, data, messaging, reliability, api, security, observability, networking, distributed, deployment, databases; add new areas in `src/data/areas.ts` and `src/content.config.ts`)
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

How it was checked: axe-core was run on every page in both themes, including after stepping through each animation and pressing every playground control, plus manual keyboard checks (skip link, focus return, Next at the last step). To repeat it, `npm install --save-dev axe-core`, copy `node_modules/axe-core/axe.min.js` into `public/`, load it in a page and call `axe.run()`; remove the copy afterwards. Not yet covered: testing with a real screen reader, 200% zoom/reflow, and Windows high-contrast mode.

## Compare pages
- `/compare/` (design patterns) is driven by `src/data/compare.ts`.
- `/compare-concepts/` (system design concepts) is driven by `src/data/compareConcepts.ts`. Slugs are validated, so a typo fails the build.

## Adding a case study
1. Create `src/content/studies/<slug>/meta.json` (validated by `src/content.config.ts`; `codeTitle` and `finalIntro` set the heading and intro for the code and final-flow sections): requirements, first attempt, `nodes` and `edges` for the growing diagram (each has `at`, and optionally `until`, as a step number), `steps`, `failures` and `alternatives`. Concept and pattern slugs are checked at build time.
2. Optional: `visuals/final.json` (a step player flow), `code/javascript.js`, `code/python.py` and `code/csharp.cs` (run by `npm run check:samples`).
3. Optional: `src/studies/<slug>/Estimator.astro` (back-of-the-envelope numbers) and `BreakIt.astro` (a load simulation). Both are picked up by name.
4. Concept pages list the studies that use them automatically.
