# More Design Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 17 patterns in three new families (enterprise, distributed, concurrency) to the site, in the same format as the 23 GoF patterns.

**Architecture:** The pattern `category` becomes a list in one module (`src/data/patternCategories.ts`) that the schema, home page, compare page and cheat sheets read, so a new family is one entry. Each pattern is a folder under `src/content/patterns/<slug>/` plus a playground, copied in shape from `observer`.

**Tech Stack:** Astro 5, TypeScript, JS/Python/C# samples, Node test runner, Playwright checks.

**Spec:** `docs/superpowers/specs/2026-11-27-more-patterns-design.md`

## Global Constraints

- Template for every pattern: `src/content/patterns/observer/` (meta.json, `code/` and `before/` in `javascript.js`, `python.py`, `csharp.cs`, `visuals/diagram.json`, `visuals/steps.json`) and `src/playgrounds/<PatternName>Playground.astro` (name without spaces or punctuation, case-insensitive match).
- New pages have **no** `factChecked` field.
- House style in all content: no em or en dashes (`check:content` warns); plain English; no filler.
- Each meta.json has exactly 3 quiz questions with 4 options each; the best option must not be the longest too often (`check:content` checks).
- JS, Python and C# `code/` samples must print identical output (`npm run check:samples`). `before/` samples show the naive version.
- `related` slugs must exist. Do not edit existing GoF pages' content.
- `PLAN.md` line `- Design patterns: all N built` must equal the folder count after each batch (`check:content` enforces).
- Work on branch `claude/laughing-noether-t5e5qo`; one commit per task; no pull request unless the user asks.

## Review Focus

- A GoF page, its URL and its home-page group must look unchanged after the plumbing task.
- Home page still shows sub-group headings in a stable order (GoF three first, then the new ones) and hides a group that has no pages.
- Compare page and cheat sheets list a new pattern under the right group; a category missing from the list fails the build, not silently vanishes.
- Cheat-sheet and area text no longer says "23" or "Gang of Four" for the whole patterns area.
- A new pattern whose scenario output differs between languages fails `check:samples`.

## Pattern task checklist (used by Tasks 2 to 7, 9 to 14, 16 to 20)

Each pattern task does these steps with the values given in its own section:

- [ ] Create `meta.json` from the Observer shape: `name`, `category`, `difficulty`, `intent`, `scenario`, `problem`, `solution`, `pain` (4), `benefits` (4), `whenToUse` (3), `whenNotToUse` (3), `pitfalls` (4), `related`, `roles`, `quiz` (3 scenario questions, answer index varied across the three).
- [ ] Create `before/*` and `code/*` in the three languages; the scenario prints the same lines in each. Run `npm run check:samples` and confirm the new folder passes.
- [ ] Create `visuals/diagram.json` (UML classes and edges; one class per role) and `visuals/steps.json` (actors and frames walking the scenario).
- [ ] Create `src/playgrounds/<PatternName>Playground.astro` with controls that show the pattern's trade-off, and a "how to try it" list whose quoted numbers the page displays.
- [ ] Update the PLAN.md pattern count, run `npm run check:content`, commit `Add <Name> pattern`.

Per-pattern values below give: slug, difficulty, scenario, roles, related, playground idea.

---

### Task 1: Pattern categories module and plumbing

**Files:**
- Create: `src/data/patternCategories.ts`, `tests/pattern-categories.test.ts`
- Modify: `src/content.config.ts:26`, `src/pages/index.astro:34,136`, `src/pages/compare.astro:20-24`, `src/pages/cheatsheets/[area].astro:16`, `src/data/areas.ts:24`, `PLAN.md` (area text)

**Interfaces:**
- Produces: `patternCategories: { id: PatternCategory; label: string; blurb: string; color: string }[]` in the order creational, structural, behavioral, enterprise, distributed, concurrency; `type PatternCategory`; `patternCategoryIds: [PatternCategory, ...PatternCategory[]]` (tuple, for `z.enum`); `categoryLabel(id: string): string`.
- Blurbs: enterprise "How code organises data access and domain logic"; distributed "How services cooperate across processes and networks"; concurrency "How code that runs at the same time is structured". Colors reuse `var(--role-1)` to `var(--role-6)`; check `src/styles/global.css` for the available `--role-N` tokens and use distinct ones.

- [ ] **Step 1: Write the failing test** `tests/pattern-categories.test.ts`: ids are unique; first three are `creational`, `structural`, `behavioral`; every entry has non-empty `label`, `blurb`, `color`; `categoryLabel('enterprise')` is `'Enterprise'`; `categoryLabel('nope')` returns `'nope'`.
- [ ] **Step 2: Run** `npm test` and expect FAIL (module missing).
- [ ] **Step 3: Implement** the module; make `content.config.ts` use `z.enum(patternCategoryIds)`; make `index.astro` take sub-group ids and `subBlurb` from the module (keep GoF blurbs verbatim); make `compare.astro` `groups` come from the module; make the cheat-sheet pattern sort follow module order (not alphabetical) and its `tag` use `categoryLabel`.
- [ ] **Step 4: Fix text** in `areas.ts` patterns blurb to "Classic and modern patterns for structuring code, from the 23 Gang of Four to enterprise, distributed and concurrency patterns"; update the README cheat-sheet line ("one for the 23 patterns" to "one for the design patterns").
- [ ] **Step 5: Verify**: `npm test`, `npm run check:content`, `npm run check:types`, `npm run build` all pass; open `dist/index.html` and confirm the GoF three groups still render and the empty new groups do not.
- [ ] **Step 6: Commit** `Make pattern categories a shared list`.

### Task 2: Repository (enterprise)

slug `repository`, difficulty intermediate. Scenario: an order service reads and saves orders; the domain code asks a collection-like `OrderRepository` instead of writing SQL, with an in-memory and a "database" implementation. Roles: client, repository (interface), concrete repository, entity. Related: `data-mapper`, `unit-of-work`, `specification`, `hexagonal-architecture-ports-and-adapters`. Playground: swap the store (memory, SQL-like) and count how many places change; show query count when the client loops (N+1 trap).

### Task 3: Unit of Work (enterprise)

slug `unit-of-work`, difficulty intermediate. Scenario: a checkout changes three records; changes are tracked and written in one transaction on `commit()`, or none on a failure. Roles: unit of work, tracked entity, data store. Related: `repository`, `data-mapper`, `acid-vs-base`, `transactional-outbox`. Playground: inject a failure at write N and compare "write immediately" with "commit once" (records left half-written).

### Task 4: Specification (enterprise)

slug `specification`, difficulty intermediate. Scenario: eligibility rules for a discount (`isActive AND NOT isBlocked AND orderTotal >= 100`) combined with `and`, `or`, `not`. Roles: specification (interface), leaf specification, composite specification, candidate. Related: `composite`, `strategy`, `repository`, `open-closed-principle`. Playground: build a rule from checkboxes, see which of ten sample customers pass, and show the number of `if` branches avoided.

### Task 5: Null Object (enterprise)

slug `null-object`, difficulty beginner. Scenario: a service logs through a `Logger`; when none is configured, a `NullLogger` does nothing, so callers need no `if (logger != null)`. Roles: client, abstract object, real object, null object. Related: `strategy`, `state`, `fail-fast-and-error-handling-strategies`. Playground: toggle "logger present" and count null checks in the client; show the pitfall of a null object that hides a real configuration error.

### Task 6: Data Mapper (enterprise)

slug `data-mapper`, difficulty intermediate. Scenario: a `User` domain object has no knowledge of the `users` table; a `UserMapper` converts rows to objects and back when a column is renamed. Roles: domain object, mapper, row/record, client. Related: `repository`, `unit-of-work`, `anemic-vs-rich-domain-models`. Playground: rename a column and count the classes that change with and without a mapper.

### Task 7: Object Pool (enterprise)

slug `object-pool`, difficulty intermediate. Scenario: a pool of 3 expensive connection objects serves 8 requests; objects are reset when returned. Roles: client, pool, pooled object, factory. Related: `connection-pooling-and-keep-alive`, `thread-pools-and-sizing`, `flyweight`. Playground: pool size and request burst sliders show wait time, creations avoided, and the leak when a client forgets to return an object.

### Task 8: Batch 1 wrap-up

**Files:** Modify `PLAN.md`, `src/data/changelog.ts`, `README.md`

- [ ] Set PLAN.md `- Design patterns: all 29 built` and add a "Wave 12" line listing the six patterns.
- [ ] Add a changelog entry (newest first, today's date, links to the six pages; `check:content` verifies links and order).
- [ ] Add rows to `src/data/compare.ts` for look-alike confusions: Repository vs Data Mapper, Null Object vs State vs Strategy (rows must have one value per pattern).
- [ ] Verify: `npm test`, `npm run check:content`, `npm run check:types`, `npm run check:samples`, `npm run build`, `npm run check:pages`, `npm run check:walkthroughs`; all pass.
- [ ] Commit `Add six enterprise patterns` and push `git push -u origin claude/laughing-noether-t5e5qo`.

---

### Task 9: Sidecar (distributed)

slug `sidecar`, difficulty intermediate. Scenario: a payments service gets logging, TLS and retries from a helper process deployed beside it, in any language. Roles: application, sidecar, network/peer. Related: `containers-and-orchestration`, `proxies`, `structured-logging`. Playground: add 1 to 20 services, compare changes needed per service with a shared library vs a sidecar, and show the added latency per hop.

### Task 10: Ambassador (distributed)

slug `ambassador`, difficulty intermediate. Scenario: a client app calls a flaky partner API through a local helper that adds retries, timeouts and a circuit breaker. Roles: client, ambassador, remote service. Related: `sidecar`, `retries-and-backoff`, `circuit-breaker`, `timeouts-and-deadlines`. Playground: failure rate slider; compare direct calls with ambassador-wrapped calls (failures seen by the client).

### Task 11: Anti-Corruption Layer (distributed)

slug `anti-corruption-layer`, difficulty advanced. Scenario: a new billing service translates a legacy system's odd customer model into its own clean model at one boundary. Roles: new system, ACL (translator and facade), legacy system. Related: `domain-driven-design-and-bounded-contexts`, `strangler-fig-and-incremental-migration`, `adapter`, `facade`. Playground: change a legacy field and count the places that break with and without the layer. Link, do not repeat, the DDD concept.

### Task 12: Backends for Frontends (distributed)

slug `backends-for-frontends`, difficulty intermediate. Scenario: mobile and web need different shapes of the same order data; each has its own small backend over shared services. Roles: client, BFF, downstream service. Related: `api-gateway`, `api-styles`, `graphql-n-plus-one-and-dataloader`, `facade`. Playground: pick a client and see requests and bytes with one general API vs per-client BFFs.

### Task 13: Scatter-Gather (distributed)

slug `scatter-gather`, difficulty intermediate. Scenario: a price comparison fans a request to 5 vendors and returns the best answers within a time limit. Roles: caller, scatterer, workers, gatherer. Related: `distributed-search-scatter-gather`, `hedged-requests-and-tail-latency`, `timeouts-and-deadlines`. Playground: slow-vendor and deadline controls; show results returned, latency, and the partial-result trade-off. Link, do not repeat, the search concept.

### Task 14: Claim Check (distributed)

slug `claim-check`, difficulty beginner. Scenario: a 20 MB video message is stored in blob storage and only a small ticket (id) travels through the queue. Roles: producer, store, message, consumer. Related: `message-queues`, `columnar-formats-and-partitioning`, `backpressure`. Playground: payload size slider; queue memory and throughput with the payload inline vs by claim check; show the pitfall of orphaned blobs.

### Task 15: Batch 2 wrap-up

- [ ] PLAN.md pattern count `35`, Wave 12 line extended, changelog entry, compare rows (Sidecar vs Ambassador vs Proxy; Scatter-Gather vs Claim Check is not needed), README untouched unless a number changed.
- [ ] Verify with the same seven commands as Task 8; commit `Add six distributed patterns`; push.

---

### Task 16: Active Object (concurrency)

slug `active-object`, difficulty advanced. Scenario: callers invoke methods on an object that queues them and runs them one at a time on its own worker, returning futures. Roles: proxy, method request, scheduler (queue), servant, future. Related: `producer-consumer-and-bounded-queues`, `command`, `future-promise`, `threads-async-and-the-event-loop`. Playground: number of callers and servant speed; show queue depth and caller blocking time.

### Task 17: Reactor (concurrency)

slug `reactor`, difficulty advanced. Scenario: one loop waits on many sockets and dispatches each ready event to a handler. Roles: event source, demultiplexer, reactor, handler. Related: `threads-async-and-the-event-loop`, `real-time-communication`, `thread-pools-and-sizing`. Playground: connections slider; compare thread-per-connection with a reactor on threads used and a blocking-handler stall.

### Task 18: Read-Write Lock (concurrency)

slug `read-write-lock`, difficulty intermediate. Scenario: a config cache read by many threads and rarely written; readers share, a writer is exclusive. Roles: lock, reader, writer, shared data. Related: `locks-deadlocks-and-contention`, `race-conditions-and-atomicity`, `immutability-and-pure-functions`. Playground: read:write ratio slider; throughput vs a plain mutex, and writer starvation under constant readers.

### Task 19: Double-Checked Locking (concurrency)

slug `double-checked-locking`, difficulty advanced. Scenario: lazily creating an expensive shared object with a cheap unlocked check first, then a locked check; the page teaches why the naive form is broken without proper memory ordering. Roles: caller, field, lock, instance. Related: `singleton`, `race-conditions-and-atomicity`, `locks-deadlocks-and-contention`. Playground: steps through two threads; toggle "safe publication" and show a thread seeing a half-built object. Be exact about language guarantees: state them per language (C# `Lazy<T>`, Python import-time or lock, JS single-threaded), with no claim you have not checked.

### Task 20: Future/Promise (concurrency)

slug `future-promise`, difficulty beginner. Scenario: start two slow lookups at once, get placeholders, combine results when both resolve, handle one failing. Roles: caller, future, producer (promise), continuation. Related: `threads-async-and-the-event-loop`, `async-apis-and-long-running-operations`, `retries-and-backoff`. Playground: latencies and a failure toggle; total time sequential vs parallel and error propagation.

### Task 21: Batch 3 wrap-up and final review

- [ ] PLAN.md pattern count `40`, "Next candidates" updated to name AI depth; changelog entry; compare rows (Active Object vs Reactor vs Producer-Consumer is a concept, so only Reactor vs Active Object; Double-Checked Locking vs Singleton).
- [ ] Cheat sheets: open `/cheatsheets/patterns/` in a build and confirm six group tags in module order.
- [ ] Verify all seven commands once more; `check:lighthouse` on the home page; commit `Add five concurrency patterns`; push.
- [ ] Run `superpowers:requesting-code-review` over the whole branch; fix findings.

## Self-review notes

- Spec coverage: plumbing (Task 1), three batches (2 to 21), no `factChecked` (constraint), links not copies of concepts (Tasks 11, 13), checks (wrap-ups).
- Counts: 23 + 6 = 29, + 6 = 35, + 5 = 40.
- Names used across tasks (`patternCategories`, `categoryLabel`, slugs) match their definitions.
