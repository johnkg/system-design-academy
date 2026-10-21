// A presence service in JavaScript:
// each device session is a key that expires unless it is renewed by a heartbeat, a user is online while any session lives,
// and friends are told only when the user's status changes, not on every heartbeat.

const TTL = 30; // seconds a session survives without a heartbeat (three heartbeat intervals)
const DEVICE_SLOTS = 8; // session key = user * DEVICE_SLOTS + device
const HEARTBEAT_S = 10; // each device beats every 10 s, at its own phase
const FRIENDS = 6;
const MAX_DEVICES = 3;
const DIE_ONE_IN = 3; // one device in 3 dies at 30..249 s
const DIE_FROM = 30;
const DIE_SPREAD = 220;
const TICKS = 300;
const LOSS_ONE_IN = 5;

class Presence {
  constructor(friendsOf) {
    this.friendsOf = friendsOf;  // user -> the users who must hear about this user
    this.expiry = new Map();     // session key -> time at which it expires
    this.live = new Map();       // user -> number of live sessions
    this.events = [];            // status changes: [user, online]
    this.fanout = 0;             // messages sent to friends
  }

  change(user, online) {
    this.events.push([user, online]);
    this.fanout += this.friendsOf[user].length;
  }

  heartbeat(user, device, now) {
    const key = user * DEVICE_SLOTS + device;
    const isNew = !this.expiry.has(key);
    this.expiry.set(key, now + TTL); // renewing is one cheap write
    if (!isNew) return;
    const n = (this.live.get(user) ?? 0) + 1;
    this.live.set(user, n);
    if (n === 1) this.change(user, true); // the first session brings the user online
  }

  disconnect(user, device) { // a clean goodbye, or an expiry
    if (!this.expiry.delete(user * DEVICE_SLOTS + device)) return;
    const n = this.live.get(user) - 1;
    this.live.set(user, n);
    if (n === 0) this.change(user, false); // the last session takes the user offline
  }

  sweep(now) { // in a real store the TTL does this for us
    for (const [key, at] of [...this.expiry]) if (at <= now) this.disconnect(Math.floor(key / DEVICE_SLOTS), key % DEVICE_SLOTS);
  }

  isOnline(user) { return (this.live.get(user) ?? 0) > 0; }
}

let seed = 77;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const USERS = 100;
const friendsOf = [], devices = [];
for (let u = 0; u < USERS; u++) {
  const list = [];
  while (list.length < FRIENDS) { const f = random(USERS); if (f !== u && !list.includes(f)) list.push(f); }
  friendsOf.push(list);
  const count = 1 + random(MAX_DEVICES);
  for (let d = 0; d < count; d++) {
    const phase = random(HEARTBEAT_S), dies = random(DIE_ONE_IN) === 0;
    devices.push({ u, d, phase, dead: dies ? DIE_FROM + random(DIE_SPREAD) : -1, graceful: random(2) === 1 });
  }
}

const presence = new Presence(friendsOf);
let heartbeats = 0;
for (let t = 0; t < TICKS; t++) {
  for (const x of devices) {
    if (x.dead >= 0 && t === x.dead && x.graceful) presence.disconnect(x.u, x.d); // others just go silent
    const alive = x.dead < 0 || t < x.dead;
    if (alive && (t + x.phase) % HEARTBEAT_S === 0 && random(LOSS_ONE_IN) !== 0) { // one heartbeat in five is lost
      presence.heartbeat(x.u, x.d, t); heartbeats++;
    }
  }
  presence.sweep(t);
}

const online = presence.events.filter((e) => e[1]).length;
console.log(`heartbeats: ${heartbeats}, fan-out if each one were broadcast: ${heartbeats * 6}`);
console.log(`status changes: ${presence.events.length} (online ${online}, offline ${presence.events.length - online}), fan-out: ${presence.fanout}`);
console.log(`messages saved: ${Math.floor((heartbeats * 6) / presence.fanout)}x`);

const stillThere = new Set(devices.filter((x) => x.dead < 0).map((x) => x.u));
let right = true, count = 0;
for (let u = 0; u < USERS; u++) { if (presence.isOnline(u)) count++; if (presence.isOnline(u) !== stillThere.has(u)) right = false; }
const last = new Map(); let alternate = true;
for (const [u, on] of presence.events) { if ((last.get(u) ?? false) === on) alternate = false; last.set(u, on); }
console.log(`online at the end: ${count} of ${USERS}; matches the devices still running: ${right}`);
console.log(`each user's changes alternate online and offline: ${alternate}`);
if (!right || !alternate) process.exit(1);
