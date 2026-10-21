// A Snowflake-style ID generator in JavaScript:
// 41 bits of time, 10 bits of machine number and 12 bits of sequence make a 64-bit number that is unique and roughly sorted by time.

const EPOCH = 1735689600000n; // 1 January 2025, so the 41 time bits last about 69 years from there
const MACHINE_BITS = 10n, SEQUENCE_BITS = 12n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095
const MAX_MACHINE = (1n << MACHINE_BITS) - 1n;   // 1023
const START_OFFSET = 1000, CLOCK_BACK_MS = 5;    // the demo clock starts 1 s after the epoch
const BURST = 4097;                              // one more ID than fits in a millisecond

class IdGenerator {
  constructor(machineId, clock, sleep) {
    this.machine = BigInt(machineId);
    this.clock = clock; this.sleep = sleep;
    this.last = -1n; this.sequence = 0n;
  }

  next() {
    let now = BigInt(this.clock());
    if (now < this.last) throw new Error(`clock moved back by ${this.last - now} ms: refusing to issue IDs`); // issuing now could repeat an old ID
    if (now === this.last) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) { // 4096 IDs in this millisecond: wait for the next one
        do { this.sleep(); now = BigInt(this.clock()); } while (now <= this.last);
      }
    } else {
      this.sequence = 0n;
    }
    this.last = now;
    return ((now - EPOCH) << (MACHINE_BITS + SEQUENCE_BITS)) | (this.machine << SEQUENCE_BITS) | this.sequence;
  }
}

const decode = (id) => ({ ms: id >> (MACHINE_BITS + SEQUENCE_BITS), machine: (id >> SEQUENCE_BITS) & MAX_MACHINE, sequence: id & MAX_SEQUENCE });

// A clock we control, so the run is the same every time.
let time = Number(EPOCH) + START_OFFSET;
const clock = () => time;
const sleep = () => { time += 1; };

const a = new IdGenerator(1, clock, sleep);
const b = new IdGenerator(2, clock, sleep);
const ids = [a.next(), a.next(), b.next(), b.next()];
for (const id of ids) { const d = decode(id); console.log(`id ${id}  = time +${d.ms} ms, machine ${d.machine}, sequence ${d.sequence}`); }

const seen = new Set(ids.map(String));
time += 1;
for (let i = 0; i < BURST; i++) seen.add(String(a.next())); // more than 4096 in one millisecond
const spill = decode(a.next()).ms - BigInt(START_OFFSET + 1); // how many milliseconds after the busy one the generator is now
console.log(`${seen.size} distinct IDs from two machines; the 4,097th ID of one millisecond was issued ${spill} ms later, after waiting`);

let refused = false;
time -= CLOCK_BACK_MS; // the clock is set back by 5 ms
try { a.next(); } catch (e) { refused = true; console.log(`clock set back: ${e.message}`); }

const increasing = ids[0] < ids[1] && ids[2] < ids[3];
if (!increasing || seen.size !== ids.length + BURST || spill !== 1n || !refused) process.exit(1);
