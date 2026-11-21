// Amortized analysis: a dynamic array that grows when it is full. The cost counted is element copies made by resizing.
// Look for: with doubling the average stays near 1 copy per append although one append copies tens of thousands of
// elements; growing by a constant makes the average climb with n; a shrink threshold at 1/2 thrashes at the boundary.
// Real runtimes pick their own growth factors (commonly somewhere between about 1.125x and 2x), so this is a model.
const POLICIES = {
  'double': (cap) => cap * 2,
  'x1.5': (cap) => Math.max(cap + 1, cap + Math.floor(cap / 2)),
  'add 10': (cap) => cap + 10,
};

function fmt2(total, n) { // total / n with two decimals, using integers only
  const hundredths = Math.floor((total * 100) / n);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

function appendMany(policy, n) {
  let cap = 1, size = 0, total = 0, worst = 0, resizes = 0;
  for (let i = 0; i < n; i++) {
    let copies = 0;
    if (size === cap) { copies = size; cap = POLICIES[policy](cap); resizes++; } // allocate a bigger array, copy every element
    size++; // the append itself
    total += copies;
    if (copies > worst) worst = copies;
  }
  return { total, worst, resizes };
}

// Remove one item and append one item, repeatedly, starting just past a power of two. The shrink rule says when to halve the array.
function thrash(rule, items, cycles) {
  const div = { never: 0, half: 2, quarter: 4 }[rule];
  let cap = 1;
  while (cap < items) cap *= 2;
  let size = items, copies = 0;
  for (let c = 0; c < cycles; c++) {
    size--;
    if (div > 0 && size * div <= cap) { copies += size; cap = cap / 2; } // shrink: copy into an array half as big
    if (size === cap) { copies += size; cap *= 2; } // full again: grow
    size++;
  }
  return copies;
}

for (const n of [10, 1000, 100000]) {
  console.log(`n=${n}`);
  for (const policy of Object.keys(POLICIES)) {
    const r = appendMany(policy, n);
    console.log(`  ${policy}: ${r.total} copies in total, ${fmt2(r.total, n)} per append, worst single append ${r.worst} copies, ${r.resizes} resizes`);
  }
}
for (const rule of ['never', 'half', 'quarter']) console.log(`shrink rule ${rule}: ${thrash(rule, 1025, 100)} copies in 100 remove-and-append cycles`);
