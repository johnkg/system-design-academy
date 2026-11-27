# More design patterns: enterprise, distributed and concurrency families

## Intent
All 23 Gang of Four patterns are built. Readers also meet patterns that are not in that book (Repository, Sidecar, Reactor). Add 17 of them in the same rich pattern format (UML, before/after, code in three languages, step player, playground, quiz), so the format readers like is kept.

## Goals
- 17 new pattern pages in three families, grouped on the home page, compare page and cheat sheets.
- Every page passes `check:content`, `check:samples` (JS, Python and C# print the same output), `check:pages` and the walkthrough check.

## Non-goals
- No new concept pages in this project, and no copies of existing concepts (thread pool, dependency injection, anti-corruption layer as taught in DDD are linked, not repeated).
- No `factChecked` date on new pages until an independent review has happened.

## Constraints
- `category` is a hard-coded enum in `src/content.config.ts`, and repeated in `src/pages/index.astro`, `src/pages/compare.astro`, the cheat-sheet page, the area blurb ("The 23 classic...") and the pattern count that `scripts/check-content.mjs` reads from PLAN.md.

## Approaches
- A. Widen `category` with `enterprise`, `distributed`, `concurrency` (chosen).
- B. Add them as concepts in a new area: loses UML, before/after, code tabs.
- C. Separate `family` field beside `category`: second taxonomy to maintain.

## Design (A)
- Plumbing first: extend the enum, sub-groups and blurbs, compare-page groups and colours, cheat sheet sections, count text. Existing GoF pages must be unchanged.
- Batch 1, enterprise and domain (6): repository, unit-of-work, specification, null-object, data-mapper, object-pool.
- Batch 2, distributed and cloud (6): sidecar, ambassador, anti-corruption-layer, backends-for-frontends, scatter-gather, claim-check.
- Batch 3, concurrency (5): active-object, reactor, read-write-lock, double-checked-locking, future-promise.
- One commit per batch on the working branch, template `src/content/patterns/observer/`.
- Each page links related concepts and patterns; `related` slugs are checked at build time.

## Left to the builder
Scenarios, diagram layout, playground controls, quiz wording; difficulty per pattern; whether a pattern also earns a compare-page row.

## Later project (not in scope here)
AI depth: more concepts in the `aiml` area, with theory (attention, training, tuning, agents). Own design.
