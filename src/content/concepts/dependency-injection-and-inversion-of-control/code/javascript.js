// Dependency injection: an order service that charges a card, sends an email and reads the clock, built four ways.
// A shared "world" counts how many REAL side effects were reached; a good test reaches none.
// Look for: what a test can replace, what happens when a test forgets one fake, and what adding a fourth dependency
// costs. A missing dependency is reported when the object is built; in a compiled language this would be a compile
// error for constructor injection, here it is an explicit check at construction time.
const world = { charges: 0, mails: 0, clock: 0 };
const reset = () => { world.charges = 0; world.mails = 0; world.clock = 0; };
const real = () => ({ gateway: { charge() { world.charges++; } }, mailer: { send() { world.mails++; } }, clock: { now() { world.clock++; return 1; } } });
const fake = () => ({ gateway: { charge() {} }, mailer: { send() {} }, clock: { now() { return 1; } } });
const run = (g, m, c) => { g.charge(50); m.send('a@example.com'); c.now(); };
const need = (deps, names) => { for (const n of names) if (!deps[n]) throw new Error(`missing ${n}`); };

class Hardcoded { // builds its own collaborators: nothing can be replaced
  checkout() { const r = real(); run(r.gateway, r.mailer, r.clock); }
}
class Injected { // constructor injection: the three needs are the constructor parameters
  constructor(deps) { need(deps, ['gateway', 'mailer', 'clock']); this.d = deps; }
  checkout() { run(this.d.gateway, this.d.mailer, this.d.clock); }
}
const locator = { registry: {} }; // global registry, filled with the production objects
const resetLocator = () => { locator.registry = real(); };
class Located { // asks the global registry for what it needs: the constructor says nothing
  checkout() { const r = locator.registry; run(r.gateway, r.mailer, r.clock); }
}
const NINE = ['gateway', 'mailer', 'clock', 'logger', 'ids', 'formatter', 'rounding', 'retry', 'metrics'];
class OverInjected { // a container wires nine collaborators, six of them trivial helpers a test never replaces
  constructor(deps) { need(deps, NINE); this.d = deps; }
  checkout() { run(this.d.gateway, this.d.mailer, this.d.clock); }
}
const nineFakes = (skip) => { const f = fake(); for (const n of NINE.slice(3)) f[n] = {}; if (skip) delete f[skip]; return f; };

const DESIGNS = [
  { name: 'Built inside (new, or a global)', params: 0, make: (skip) => ({ fakes: 0, build: () => new Hardcoded() }) },
  { name: 'Constructor injection', params: 3, make: (skip) => { const f = fake(); if (skip) delete f[skip]; return { fakes: skip ? 2 : 3, build: () => new Injected(f) }; } },
  { name: 'Service locator', params: 0, make: (skip) => { const f = fake(); if (skip) delete f[skip]; return { fakes: skip ? 2 : 3, build: () => { resetLocator(); Object.assign(locator.registry, f); if (skip) locator.registry[skip] = real()[skip]; return new Located(); } }; } },
  { name: 'Container, everything injected', params: 9, make: (skip) => ({ fakes: skip ? 8 : 9, build: () => new OverInjected(nineFakes(skip)) }) },
];

// Adding a fourth dependency (a tax calculator) with 1 production construction site and 4 existing tests.
const TESTS = 4;
const ADD = [
  { files: 1, loud: 0, quiet: TESTS },                // nothing to edit but the service; every test now reaches the real calculator
  { files: 1 + 1 + TESTS, loud: TESTS, quiet: 0 },    // service, composition root, each test passes one more fake; tests fail to build until then
  { files: 1 + 1, loud: 0, quiet: TESTS },            // service and one registration; tests keep running against the real calculator
  { files: 4 + TESTS, loud: TESTS, quiet: 0 },        // interface, implementation, registration, service, and a fake in each test
];

for (let i = 0; i < DESIGNS.length; i++) {
  const d = DESIGNS[i];
  console.log(`== ${d.name}`);
  reset();
  const t1 = d.make(null); t1.build().checkout();
  console.log(`  test a checkout: fakes the test supplies ${t1.fakes}; real effects reached ${world.charges + world.mails + world.clock} (charges ${world.charges}, emails ${world.mails}, clock reads ${world.clock}); dependencies visible in the signature: ${d.params}`);
  reset();
  let outcome = 'test ran';
  try { d.make('mailer').build().checkout(); } catch (e) { outcome = `failed before running: ${e.message}`; }
  console.log(`  test forgets the mailer fake: ${outcome}; real effects reached ${world.charges + world.mails + world.clock} (emails ${world.mails})`);
  console.log(`  add a fourth dependency: files edited ${ADD[i].files}; tests that fail loudly ${ADD[i].loud}; tests that quietly use the real thing ${ADD[i].quiet}`);
}
