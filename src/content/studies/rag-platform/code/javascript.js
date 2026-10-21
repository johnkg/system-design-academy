// The retrieval core of a RAG platform, in JavaScript:
// documents are split into chunks, indexed by keyword and by a toy embedding, searched with the asker's groups,
// merged with reciprocal rank fusion, and re-synced so that changes and deletes reach the index.

const DIM = 16;
const RRF_K = 60, RRF_SCALE = 1000000; // the usual fusion constant; scores kept as whole numbers
const TOP_K = 3, WIDE_K = 5;
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const tokens = (text) => text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);

let embedCalls = 0; // a real embedding call costs money, so we count them
function embed(words) { // toy embedding: each word adds +1 or -1 to one of 16 dimensions
  embedCalls++;
  const v = new Array(DIM).fill(0);
  for (const w of words) { const h = hash(w); v[h % DIM] += (h >>> 8) & 1 ? 1 : -1; }
  return v;
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

class Index {
  constructor() { this.chunks = new Map(); this.docs = new Map(); } // chunk id -> chunk, doc id -> { hash, ids }

  // Bring one document up to date. Unchanged text costs nothing; a changed ACL only rewrites metadata.
  sync(doc) {
    const textHash = hash(doc.text), old = this.docs.get(doc.id);
    if (old && old.hash === textHash) { for (const id of old.ids) this.chunks.get(id).acl = doc.acl; return; }
    if (old) this.remove(doc.id); // replace old chunks, never leave them behind
    const ids = doc.text.split('. ').map((t, i) => {
      const id = `${doc.id}#${i}`, words = tokens(t);
      this.chunks.set(id, { id, title: doc.title, acl: doc.acl, words, vec: embed(words) });
      return id;
    });
    this.docs.set(doc.id, { hash: textHash, ids });
  }
  remove(docId) { for (const id of this.docs.get(docId).ids) this.chunks.delete(id); this.docs.delete(docId); }
  // Delete propagation: anything the source no longer lists is removed from the index.
  syncAll(source) {
    source.forEach((d) => this.sync(d));
    const live = new Set(source.map((d) => d.id));
    for (const id of [...this.docs.keys()]) if (!live.has(id)) this.remove(id);
  }

  // The asker's groups are applied before ranking, so the top k is full of chunks they may read.
  search(groups, query, k, enforce = true) {
    const q = tokens(query), qv = embed(q);
    const allowed = [...this.chunks.values()].filter((c) => !enforce || c.acl.some((g) => groups.includes(g)));
    const keyword = allowed.map((c) => ({ c, s: q.reduce((n, w) => n + c.words.filter((x) => x === w).length, 0) }));
    const vector = allowed.map((c) => ({ c, s: dot(qv, c.vec) }));
    const byScore = (list) => list.filter((e) => e.s > 0).sort((a, b) => b.s - a.s || (a.c.id < b.c.id ? -1 : 1)).map((e) => e.c.id);
    const fused = new Map(); // reciprocal rank fusion: a chunk near the top of either list scores well
    for (const ranked of [byScore(keyword), byScore(vector)]) ranked.forEach((id, r) => fused.set(id, (fused.get(id) ?? 0) + Math.floor(RRF_SCALE / (RRF_K + r + 1))));
    return [...fused].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k).map(([id]) => id);
  }
}

const source = [
  { id: 'hr1', title: 'Leave policy', acl: ['all'], text: 'Employees get sixteen weeks of paid parental leave. Request leave in the people portal. Managers approve leave within two days' },
  { id: 'hr2', title: 'Salary bands', acl: ['hr'], text: 'Salary bands are reviewed each year. Senior engineer salary starts at band five. Bonus targets follow the salary band' },
  { id: 'en1', title: 'Failover runbook', acl: ['eng'], text: 'When the primary database fails, page the on call engineer. Check replication lag before moving traffic. Approve the failover in the portal' },
  { id: 'tr1', title: 'Travel policy', acl: ['all'], text: 'Book travel in the portal. Flights above five hundred dollars need manager approval' },
];
const index = new Index();
index.syncAll(source);
const show = (ids) => ids.map((id) => `${id} (${index.chunks.get(id).title})`).join(', ');

const query = 'salary band approval in the portal';
const asEngineer = index.search(['all', 'eng'], query, TOP_K), asHr = index.search(['all', 'hr'], query, TOP_K);
console.log(`engineer asks: ${show(asEngineer)}`);
console.log(`hr asks: ${show(asHr)}`);

const unfiltered = index.search(['all', 'eng'], query, TOP_K, false).filter((id) => !index.chunks.get(id).acl.some((g) => ['all', 'eng'].includes(g)));
console.log(`without the filter, the engineer's top 3 would hold ${unfiltered.length} unreadable chunk(s): ${show(unfiltered)}`);

const callsBefore = embedCalls;
index.syncAll(source);
console.log(`re-sync with no changes: ${embedCalls - callsBefore} embedding calls`);
source[2] = { ...source[2], text: 'When the primary database fails, page the on call engineer. Promote the replica with the lowest lag' };
source[1] = { ...source[1], acl: ['hr', 'eng'] };
source.pop(); // the travel policy is deleted at the source
index.syncAll(source);
const syncCalls = embedCalls - callsBefore;
console.log(`after edit, ACL change and delete: ${syncCalls} embedding calls, ${index.chunks.size} chunks`);
console.log(`engineer asks again: ${show(index.search(['all', 'eng'], query, TOP_K))}`);

const leaked = [...index.chunks.keys()].some((id) => id.startsWith('tr1'));
const hrSeen = index.search(['all', 'eng'], 'salary band', WIDE_K).some((id) => id.startsWith('hr2'));
const secret = asEngineer.some((id) => id.startsWith('hr2'));
console.log(`deleted doc still indexed: ${leaked}; hr doc hidden before the ACL change: ${!secret}; visible after: ${hrSeen}`);
if (leaked || secret || !hrSeen || syncCalls !== 2 || unfiltered.length === 0) process.exit(1);
