// Open-Closed Principle: a discount calculator with 2 rule types today (regular, member), built three ways.
// Then 1, 3 and 6 new rule types arrive, one at a time. Look for: edits inside existing code, existing branches exposed to
// accidental change, files created, and the cost of the abstraction itself when only 2 variants ever exist.
// A "touch point" is one edit to an existing file, one new file, or one existing branch that sits inside the edited code.
const EXISTING = 2;
const DESIGNS = [
  { name: 'Switch on customer type', setupFiles: 1, newFilesPerRule: 0, exposesBranches: true, inputChangeBase: 0,
    note: 'PriceCalculator holds one branch per rule' },
  { name: 'Strategy-style rules', setupFiles: 5, newFilesPerRule: 1, exposesBranches: false, inputChangeBase: 2,
    note: 'DiscountRule, PricingEngine, RuleRegistry, 2 rule classes' },
  { name: 'Plug-in framework', setupFiles: 11, newFilesPerRule: 3, exposesBranches: false, inputChangeBase: 4,
    note: 'rule, factory and descriptor per rule, plus loader, context, registry, engine, interface' },
];

// Adding k rules one after another. Each addition edits one existing file (the switch, the registry or the config).
function addRules(d, k) {
  let exposed = 0;
  if (d.exposesBranches) for (let i = 0; i < k; i++) exposed += EXISTING + i; // every existing branch is in the edited function
  const edits = k, created = d.newFilesPerRule * k;
  return { edits, created, exposed, touch: edits + created + exposed, filesAfter: d.setupFiles + created };
}

// A change the abstraction did not expect: every rule now needs the customer's country.
function inputChange(d, k) {
  if (d.inputChangeBase === 0) return 1; // one function signature
  return d.inputChangeBase + EXISTING + k; // interface, engine and so on, plus every rule class
}

// Total cost from nothing: build the design for the 2 existing rules, then add k.
const total = (d, k) => d.setupFiles + addRules(d, k).touch;

function crossover(a, b) { // smallest number of added rules where design a costs more than design b
  for (let k = 0; k <= 50; k++) if (total(a, k) > total(b, k)) return k;
  return -1;
}

for (const d of DESIGNS) {
  console.log(`== ${d.name} (${d.note})`);
  console.log(`  files for the ${EXISTING} rules that exist: ${d.setupFiles}`);
  for (const k of [1, 3, 6]) {
    const r = addRules(d, k);
    console.log(`  add ${k}: ${r.edits} edits to existing files, ${r.created} new files, ${r.exposed} existing branches exposed, ${r.touch} touch points, ${r.filesAfter} files in all; a new input for every rule means editing ${inputChange(d, k)} files`);
  }
  console.log(`  total touch points from scratch with 2 rules: ${total(d, 0)}`);
}
console.log(`strategy-style costs less than the switch from ${crossover(DESIGNS[0], DESIGNS[1])} added rules`);
console.log(`plug-in framework costs less than the switch from ${crossover(DESIGNS[0], DESIGNS[2])} added rules`);
