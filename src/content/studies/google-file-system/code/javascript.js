// A miniature of the Google File System (SOSP 2003), in JavaScript (a teaching model, not Google's code):
// one master keeps the namespace and the chunk map in memory, files are cut into fixed-size chunks, every chunk lives on
// three chunkservers, record append pads a chunk that cannot hold the record, a dead chunkserver's chunks are copied again,
// and a restarted master learns where chunks are by asking the chunkservers. Everything is deterministic.

const CHUNK = 10, COPIES = 3; // bytes per chunk (GFS uses 64 MB) and replicas per chunk
const SERVERS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const disks = Object.fromEntries(SERVERS.map((s) => [s, new Map()])); // chunk id -> bytes held
const alive = new Set(SERVERS);
const master = { files: new Map(), where: new Map(), next: 1, opLog: [] };

const load = (s) => disks[s].size;
function pick(count, exclude = []) { // least-loaded live chunkservers, ties by name
  return SERVERS.filter((s) => alive.has(s) && !exclude.includes(s)).sort((a, b) => load(a) - load(b) || a.localeCompare(b)).slice(0, count);
}
function newChunk(file) {
  const id = `c${master.next++}`;
  master.files.get(file).push(id);
  master.opLog.push(`add ${file} ${id}`); // the namespace and file-to-chunk map are logged; locations are not
  const servers = pick(COPIES);
  master.where.set(id, servers);
  for (const s of servers) disks[s].set(id, '');
  return id;
}
function recordAppend(file, record) { // the primary picks the offset; a record that does not fit pads the chunk and the client retries on the next one
  let id = master.files.get(file).at(-1) ?? newChunk(file);
  const used = disks[master.where.get(id)[0]].get(id).length;
  if (used + record.length > CHUNK) {
    for (const s of master.where.get(id)) disks[s].set(id, disks[s].get(id) + '.'.repeat(CHUNK - used));
    console.log(`append ${record}: does not fit in ${id} (${CHUNK - used} bytes left), chunk padded, retry on a new chunk`);
    id = newChunk(file);
  }
  for (const s of master.where.get(id)) disks[s].set(id, disks[s].get(id) + record);
  console.log(`append ${record}: stored in ${id} on ${master.where.get(id).join(',')}`);
}

master.files.set('/logs/web', []);
for (const record of ['AAAA', 'BBBBBB', 'CCCCCCC', 'DDDDD']) recordAppend('/logs/web', record);
console.log(`chunks: ${master.files.get('/logs/web').map((id) => `${id}=${disks[master.where.get(id)[0]].get(id)}`).join(' ')}`);

alive.delete('S2');
disks.S2.clear();
console.log('S2 stops sending heartbeats and is treated as dead');
const need = [...master.where].map(([id, servers]) => [id, servers.filter((s) => alive.has(s))]).filter(([, live]) => live.length < COPIES).sort((a, b) => a[1].length - b[1].length);
console.log(`chunks with fewer than ${COPIES} replicas: ${need.map(([id, live]) => `${id} (${live.length})`).join(', ')}`);
for (const [id, live] of need) {
  const [target] = pick(1, live);
  disks[target].set(id, disks[live[0]].get(id)); // clone from a surviving replica
  master.where.set(id, [...live, target]);
  console.log(`re-replicate ${id}: ${live[0]} -> ${target}`);
}

console.log('the master restarts and forgets where chunks are');
master.where = new Map();
for (const s of SERVERS.filter((x) => alive.has(x))) for (const id of disks[s].keys()) master.where.set(id, [...(master.where.get(id) ?? []), s]); // each chunkserver reports its chunks
console.log(`rebuilt from reports: ${master.where.size} chunks, ${[...master.where.values()].reduce((n, l) => n + l.length, 0)} replicas, namespace from the operation log: ${master.opLog.length} entries`);

const content = master.files.get('/logs/web').map((id) => disks[master.where.get(id)[0]].get(id)).join('');
console.log(`reader sees: ${content} -> without padding: ${content.replaceAll('.', '')}`);
