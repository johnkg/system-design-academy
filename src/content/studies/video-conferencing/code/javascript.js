// An SFU choosing simulcast layers, in JavaScript:
// every sender uploads a few layers of its video once, and the server forwards to each viewer the best layer that fits that viewer's downlink.
// Compared with a mesh, where every sender uploads a full copy to every other participant.

const LAYERS = [150, 500, 1500]; // kbit/s of the low, medium and high layer
const N = 6;

const SEED = 7;
const LINK_STEP = 1000, UP_STEPS = 6, DOWN_STEPS = 9; // links are whole Mbit/s: upload 1..6, download 1..9
let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const people = Array.from({ length: N }, (_, id) => {
  const up = LINK_STEP + random(UP_STEPS) * LINK_STEP, down = LINK_STEP + random(DOWN_STEPS) * LINK_STEP; // kbit/s, drawn in this order
  return { id, up, down };
});

// A sender uploads layers from the lowest upwards for as long as they fit in its uplink.
function published(p) {
  const sent = [];
  let used = 0;
  for (const l of LAYERS) if (used + l <= p.up) { sent.push(l); used += l; }
  return sent;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const sent = people.map(published);

// A viewer splits its downlink evenly over the other participants and takes the best layer that fits its share.
function choose(viewer) {
  const share = Math.floor(viewer.down / (N - 1));
  return people.filter((p) => p.id !== viewer.id).map((p) => {
    let pick = sent[p.id][0];
    for (const l of sent[p.id]) if (l <= share) pick = l;
    return pick;
  });
}

let egress = 0, ingress = 0;
for (const p of people) {
  const got = choose(p);
  const total = sum(got);
  egress += total; ingress += sum(sent[p.id]);
  console.log(`client ${p.id}: up ${p.up} down ${p.down} | sends ${sent[p.id].join('+')} = ${sum(sent[p.id])} | gets ${got.join(',')} = ${total}`);
  if (sum(sent[p.id]) > p.up || total > p.down) process.exit(1); // nobody may be asked for more than its link can carry
}

const meshUp = (N - 1) * LAYERS[2];
const meshOver = people.filter((p) => p.up < meshUp).length;
console.log(`server: in ${ingress}, out ${egress} kbit/s`);
console.log(`mesh would need ${meshUp} up from each client: ${meshOver} of ${N} clients cannot send it`);
if (meshOver === 0 || egress <= ingress) process.exit(1);
