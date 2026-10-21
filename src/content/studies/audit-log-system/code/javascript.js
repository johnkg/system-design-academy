// A tamper-evident audit log in JavaScript: every entry is chained to the one before it,
// and signed checkpoints hold a Merkle root over each block, so even a clean rewrite is caught.
// FNV-1a stands in for a cryptographic hash here; a real log uses SHA-256 and signs the checkpoints.

const fnv = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
};

let seed = 7;
const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
const actors = ['alice', 'bob', 'carol', 'dan'];
const actions = ['login', 'read', 'update', 'delete', 'export'];

const dataOf = (e) => `${e.seq}|${e.actor}|${e.action}|${e.target}|${e.time}`;
const link = (prev, e) => fnv(`${prev}|${dataOf(e)}`);

// Append-only: each entry stores the hash of the entry before it.
const BLOCK = 250;
const DOCS = 50; // documents the demo actions target
const START_TIME = 1700000000; // Unix seconds of the first entry
const ENTRY_GAP_S = 3; // entries are about 3 s apart, with up to 2 s of jitter
const ENTRIES = 1000;
const EDIT_AT = 300; // the entry an attacker edits
const TRUNCATE_TO = 900;
const PROVE_SEQ = 777; // the entry the inclusion proof is for
function build(count) {
  const log = [];
  let prev = '00000000';
  for (let seq = 0; seq < count; seq++) {
    const e = { seq, actor: actors[random(actors.length)], action: actions[random(actions.length)], target: `doc-${random(DOCS)}`, time: START_TIME + seq * ENTRY_GAP_S + random(ENTRY_GAP_S) };
    e.hash = link(prev, e);
    prev = e.hash;
    log.push(e);
  }
  return log;
}

// Merkle root over a list of hashes; an odd node is paired with itself.
function merkle(level, index, proof) {
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(fnv(level[i] + right));
      if (proof && (index === i || index === i + 1)) proof.push(index === i ? ['R', right] : ['L', level[i]]);
    }
    if (proof) index >>= 1;
    level = next;
  }
  return level[0];
}

function checkpoints(log) { // kept outside the log, signed in real life
  const list = [];
  for (let end = BLOCK; end <= log.length; end += BLOCK) {
    list.push({ end, head: log[end - 1].hash, root: merkle(log.slice(end - BLOCK, end).map((e) => e.hash)) });
  }
  return list;
}

function verifyChain(log) { // index of the first entry whose hash does not match, or -1
  let prev = '00000000';
  for (const e of log) { if (e.hash !== link(prev, e)) return e.seq; prev = e.hash; }
  return -1;
}

function verifyCheckpoints(log, cps) { // end of the first checkpoint that disagrees, or -1
  for (const c of cps) {
    if (log.length < c.end || log[c.end - 1].hash !== c.head) return c.end;
    if (merkle(log.slice(c.end - BLOCK, c.end).map((e) => e.hash)) !== c.root) return c.end;
  }
  return -1;
}

function proveEntry(log, seq) {
  const start = seq - (seq % BLOCK);
  const proof = [];
  merkle(log.slice(start, start + BLOCK).map((e) => e.hash), seq - start, proof);
  return proof;
}
function checkProof(hash, proof, root) {
  for (const [side, sibling] of proof) hash = side === 'R' ? fnv(hash + sibling) : fnv(sibling + hash);
  return hash === root;
}

const log = build(ENTRIES);
const cps = checkpoints(log);
console.log(`entries: ${log.length}, checkpoints at: ${cps.map((c) => c.end).join(', ')}`);
console.log(`head ${log[999].hash}, last root ${cps[3].root}`);
console.log(`intact: chain ${verifyChain(log)}, checkpoints ${verifyCheckpoints(log, cps)}`);

const edited = log.map((e) => ({ ...e }));
edited[EDIT_AT].actor = 'mallory';
const editChain = verifyChain(edited);
console.log(`edit entry 300: chain breaks at ${editChain}`);

let prev = edited[EDIT_AT - 1].hash; // a clean rewrite: recompute every later hash
for (let i = EDIT_AT; i < edited.length; i++) { edited[i].hash = link(prev, edited[i]); prev = edited[i].hash; }
const rewriteChain = verifyChain(edited);
const rewriteCp = verifyCheckpoints(edited, cps);
console.log(`rewrite from 300: chain ${rewriteChain}, checkpoints disagree at ${rewriteCp}`);

const dropped = log.slice(0, TRUNCATE_TO);
console.log(`truncate to 900: chain ${verifyChain(dropped)}, checkpoints disagree at ${verifyCheckpoints(dropped, cps)}`);

const proof = proveEntry(log, PROVE_SEQ);
const okProof = checkProof(log[PROVE_SEQ].hash, proof, cps[3].root);
const badProof = checkProof(fnv('forged'), proof, cps[3].root);
console.log(`proof for entry 777: ${proof.length} hashes, genuine ${okProof}, forged ${badProof}`);

if (editChain !== EDIT_AT || rewriteChain !== -1 || rewriteCp !== 500 || verifyCheckpoints(dropped, cps) !== ENTRIES || !okProof || badProof) process.exit(1);
