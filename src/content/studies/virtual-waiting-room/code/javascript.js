// A virtual waiting room, in JavaScript:
// signed queue tokens carry a place in line, a pointer admits a fixed number per tick, and the pointer is all the state that must survive a crash.
import crypto from 'node:crypto';

const SECRET = 'room-secret';
const TAG_HEX = 12, PASS_TICKS = 5; // tag length in hex digits; how long an entry pass stays valid
const RATE = 40, EARLY = 300, LOTTERY_SEED = 7, TICKS = 20, ARRIVALS_PER_TICK = 25;
const CLIENT = 250, RESTART_AT = 5; // the client we follow, and the tick when the process restarts
const mac = (text) => crypto.createHmac('sha256', SECRET).update(text).digest('hex').slice(0, TAG_HEX);

class WaitingRoom {
  constructor(rate, saved) {
    this.rate = rate;                                   // people admitted per tick, set from what the backend can serve
    this.next = saved ? saved.next : 0;                 // next place in line to hand out
    this.served = saved ? saved.served : 0;             // every place below this may enter
    this.tick = saved ? saved.tick : 0;
    this.early = [];
  }
  save() { return { next: this.next, served: this.served, tick: this.tick }; }
  token(seq) { return `${seq}.${mac('q' + seq)}`; }
  joinEarly(id) { this.early.push(id); }

  // Before the sale opens, arrival time means nothing, so the pool is shuffled once (a lottery) and then numbered.
  open(seed) {
    let s = seed;
    // Fisher-Yates shuffle driven by a linear congruential generator (Numerical Recipes constants).
    const lcg = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s >>> 16; };
    for (let i = this.early.length - 1; i > 0; i--) { const j = lcg() % (i + 1); [this.early[i], this.early[j]] = [this.early[j], this.early[i]]; }
    return this.early.map((id) => ({ id, token: this.join() }));
  }
  join() { return this.token(this.next++); }

  seqOf(token) {
    const [seq, tag] = token.split('.');
    return /^\d+$/.test(seq) && tag === mac('q' + seq) ? Number(seq) : -1;
  }
  status(token) {
    const seq = this.seqOf(token);
    if (seq < 0) return 'invalid';
    if (seq < this.served) return 'admitted';
    const position = seq - this.served + 1;
    return `waiting, position ${position}, about ${Math.ceil(position / this.rate)} ticks`;
  }
  advance() { const before = this.served; this.tick++; this.served = Math.min(this.next, this.served + this.rate); return this.served - before; }

  pass(seq) { const exp = this.tick + PASS_TICKS; return `${seq}.${exp}.${mac(`p${seq}.${exp}`)}`; }
  passOk(pass) {
    const [seq, exp, tag] = pass.split('.');
    return tag === mac(`p${seq}.${exp}`) && Number(seq) < this.served && this.tick <= Number(exp);
  }
}

let room = new WaitingRoom(RATE);
for (let id = 0; id < EARLY; id++) room.joinEarly(id);
const tokens = new Map();
const lottery = room.open(LOTTERY_SEED);
lottery.forEach(({ id, token }) => tokens.set(id, token));
console.log(`opened with ${room.next} waiting; first five in the lottery: ${lottery.slice(0, 5).map((e) => e.id).join(', ')}`);
console.log(`client 250: ${room.status(tokens.get(CLIENT))}`);

let peak = 0, pass = null, crashChecked = false;
for (let t = 1; t <= TICKS; t++) {
  for (let k = 0; k < ARRIVALS_PER_TICK; k++) tokens.set(EARLY + (t - 1) * ARRIVALS_PER_TICK + k, room.join());
  peak = Math.max(peak, room.advance());
  if (t === 1) pass = room.pass(0);
  if (t === RESTART_AT) {
    const before = room.status(tokens.get(CLIENT));
    room = new WaitingRoom(RATE, room.save());           // the whole process restarts, tokens in people's browsers stay valid
    crashChecked = before === room.status(tokens.get(CLIENT));
    console.log(`after a restart at tick 5, client 250: ${room.status(tokens.get(CLIENT))}`);
  }
}
const [seq, tag] = tokens.get(CLIENT).split('.');
const forgedPosition = room.status(`0.${tag}`);
const flippedTag = room.status(`${seq}.${tag.replace(/.$/, tag.endsWith('0') ? '1' : '0')}`);
console.log(`peak admitted in one tick: ${peak} (limit 40)`);
console.log(`forged place 0 accepted: ${forgedPosition !== 'invalid'}; altered tag accepted: ${flippedTag !== 'invalid'}`);
console.log(`old pass accepted at tick ${room.tick}: ${room.passOk(pass)}; fresh pass accepted: ${room.passOk(room.pass(100))}`);
const everyone = [...tokens.values()].every((tk) => room.status(tk) === 'admitted');
console.log(`all ${tokens.size} admitted in order by tick ${room.tick}: ${everyone}`);
if (peak > RATE || !crashChecked || forgedPosition !== 'invalid' || flippedTag !== 'invalid' || !everyone || room.passOk(pass)) process.exit(1);
