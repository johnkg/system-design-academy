// A miniature GraphQL-style executor over in-memory tables, with a DataLoader that collects keys until the end of a tick.
// The "tick" is simulated: the executor calls dispatch() after every resolver of one tree level has run, so it is deterministic.
const N = 5, M = 4, USERS = 6; // 5 posts, 4 comments each, 6 users
const users = Array.from({ length: USERS }, (_, i) => ({ tag: `U${i + 1}`, id: i + 1 }));
const posts = Array.from({ length: N }, (_, i) => ({ tag: `P${i + 1}`, id: i + 1, authorId: (((i + 1) * 2) % USERS) + 1 }));
const comments = Array.from({ length: N * M }, (_, i) => ({ tag: `C${i + 1}`, id: i + 1, postId: Math.floor(i / M) + 1, authorId: (((i + 1) * 5 + 3) % USERS) + 1 }));

class Db { // counts every query it receives
  constructor() { this.queries = 0; this.keys = 0; this.rows = 0; this.log = []; }
  run(sql, keys, rows) { this.queries++; this.keys += keys; this.rows += rows.length; this.log.push(sql); return rows; }
  allPosts() { return this.run("SELECT * FROM posts", 0, posts); }
  usersIn(ids) { const s = new Set(ids); return this.run(`SELECT * FROM users WHERE id IN (${[...s].join(",")})`, ids.length, users.filter((u) => s.has(u.id))); }
  commentsIn(ids) { const s = new Set(ids); return this.run(`SELECT * FROM comments WHERE post_id IN (${[...s].join(",")})`, ids.length, comments.filter((c) => s.has(c.postId))); }
}

class Future { value = undefined; }
class Loader {
  constructor(batchFn, { batch, cache }) { this.batchFn = batchFn; this.batch = batch; this.cache = cache; this.queue = []; this.memo = new Map(); this.hits = 0; }
  load(key) {
    if (this.cache && this.memo.has(key)) { this.hits++; return this.memo.get(key); } // per-request cache
    const f = new Future();
    if (this.cache) this.memo.set(key, f);
    this.queue.push([key, f]);
    if (!this.batch) this.dispatch(); // not batching: one query per load
    return f;
  }
  dispatch() { // end of tick: one batch function call for every queued key
    if (!this.queue.length) return;
    const q = this.queue; this.queue = [];
    const found = this.batchFn(q.map(([k]) => k)); // Map key -> value
    for (const [k, f] of q) f.value = found.get(k);
  }
}

const resolvers = { // field name -> (parent row, ctx) => value or Future
  posts: (_, ctx) => ctx.db.allPosts(),
  comments: (post, ctx) => ctx.comments.load(post.id),
  author: (row, ctx) => ctx.users.load(row.authorId),
};

function execute(selection, parents, ctx) { // resolves one tree level at a time
  const pending = selection.map((s) => parents.map((p) => resolvers[s.name](p.row, ctx))); // every resolver of this level runs first
  ctx.users.dispatch(); ctx.comments.dispatch(); // ...then the tick ends and the loaders fire
  selection.forEach((s, si) => {
    const kids = [];
    parents.forEach((p, i) => {
      const v = pending[si][i] instanceof Future ? pending[si][i].value : pending[si][i];
      const list = Array.isArray(v) ? v : [v];
      const nodes = list.map((row) => ({ row, out: [] }));
      p.out.push([s.name, nodes, Array.isArray(v)]);
      kids.push(...nodes);
    });
    execute(s.kids, kids, ctx);
  });
}

const ser = (n) => `${n.row ? n.row.tag : ""}{${n.out.map(([name, kids, isList]) => `${name}:${isList ? "[" : ""}${kids.map(ser).join(",")}${isList ? "]" : ""}`).join(";")}}`;
const fnv = (s) => { let h = 0x811c9dc5; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };

function run(selection, mode) {
  const opts = { naive: { batch: false, cache: false }, batch: { batch: true, cache: false }, cache: { batch: true, cache: true } }[mode];
  const db = new Db();
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const ctx = {
    db,
    users: new Loader((ids) => byId(db.usersIn(ids)), opts),
    comments: new Loader((ids) => { const rows = db.commentsIn(ids); return new Map(ids.map((id) => [id, rows.filter((c) => c.postId === id)])); }, opts),
  };
  const root = { row: null, out: [] };
  execute(selection, [root], ctx);
  const hits = ctx.users.hits + ctx.comments.hits;
  console.log(`  ${mode.padEnd(5)} queries=${String(db.queries).padStart(2)} keys=${String(db.keys).padStart(2)} rows=${String(db.rows).padStart(2)} cache_hits=${String(hits).padStart(2)} checksum=${fnv(ser(root))}`);
  return { db, sum: fnv(ser(root)) };
}

const check = (ok, msg) => { if (!ok) { console.log("FAILED: " + msg); process.exit(1); } };
const sel = (name, ...kids) => ({ name, kids });
const queries = [
  ["posts { comments { author } }", [sel("posts", sel("comments", sel("author")))], 1 + N + N * M, 3],
  ["posts { author comments { author } }", [sel("posts", sel("author"), sel("comments", sel("author")))], 1 + N + N + N * M, 4],
];
for (const [text, selection, naiveQ, batchQ] of queries) {
  console.log(text);
  const a = run(selection, "naive"), b = run(selection, "batch"), c = run(selection, "cache");
  check(a.sum === b.sum && b.sum === c.sum, "all strategies must return identical results");
  check(a.db.queries === naiveQ, `naive must make ${naiveQ} queries`);
  check(b.db.queries === batchQ && c.db.queries === batchQ, `batched must make ${batchQ} queries`);
  check(c.db.keys < b.db.keys, "the cache must send fewer keys");
  if (selection.length === 1 && text.startsWith("posts { comments")) c.db.log.forEach((sql) => console.log("    " + sql));
}
console.log("identical results, exact query counts");
