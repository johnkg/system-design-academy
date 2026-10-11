// Optimistic concurrency with ETags: a versioned in-memory store with a conditional update (If-Match),
// and a seeded interleaving of support agents doing read-modify-write on shared customer records.

class Store {
  constructor(records, requireIfMatch) {
    this.rows = Array.from({ length: records }, () => ({ notes: 0, version: 0 }));
    this.requireIfMatch = requireIfMatch;
  }
  etag(id) { return `"v${this.rows[id].version}"`; } // strong ETag derived from the row version
  get(id) { return { status: 200, etag: this.etag(id), notes: this.rows[id].notes }; }
  // PUT with an optional If-Match header. Same effect as: UPDATE ... SET notes=?, version=version+1 WHERE id=? AND version=?
  put(id, notes, ifMatch) {
    if (ifMatch === undefined && this.requireIfMatch) return { status: 428 }; // Precondition Required
    if (ifMatch !== undefined && ifMatch !== this.etag(id)) return { status: 412 }; // Precondition Failed
    this.rows[id].notes = notes;
    this.rows[id].version++;
    return { status: 200, etag: this.etag(id) };
  }
}

let seed = 7;
const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Each step, a random agent that still has work does one action: read a record, or write back its edit.
function run(useIfMatch, agents, records, editsEach) {
  seed = 7;
  const store = new Store(records, false);
  const a = Array.from({ length: agents }, () => ({ left: editsEach, id: -1, notes: 0, etag: "" }));
  let saved = 0, conflicts = 0;
  while (a.some((x) => x.left > 0)) {
    const busy = a.filter((y) => y.left > 0);
    const x = busy[rand(busy.length)];
    if (x.id < 0) { // read phase
      x.id = rand(records);
      const r = store.get(x.id);
      x.notes = r.notes; x.etag = r.etag;
    } else { // write phase: add one note to what this agent saw
      const res = store.put(x.id, x.notes + 1, useIfMatch ? x.etag : undefined);
      if (res.status === 200) { saved++; x.left--; } else conflicts++; // on 412 keep the edit and re-read
      x.id = -1;
    }
  }
  const final = store.rows.reduce((s, r) => s + r.notes, 0);
  return { saved, final, lost: saved - final, conflicts };
}

const none = run(false, 4, 2, 10);
const occ = run(true, 4, 2, 10);
console.log(`no check:   saved=${none.saved} final=${none.final} lost=${none.lost} conflicts=${none.conflicts}`);
console.log(`if-match:   saved=${occ.saved} final=${occ.final} lost=${occ.lost} conflicts=${occ.conflicts}`);

const strict = new Store(1, true);
const first = strict.get(0);
console.log(`PUT without If-Match: ${strict.put(0, 1, undefined).status}`);
console.log(`PUT with ${first.etag}: ${strict.put(0, 1, first.etag).status}`);
console.log(`PUT with stale ${first.etag}: ${strict.put(0, 2, first.etag).status}`);

if (occ.lost !== 0 || occ.final !== 40) throw new Error("version check must not lose updates");
if (none.lost <= 0) throw new Error("the unchecked run should lose updates");
