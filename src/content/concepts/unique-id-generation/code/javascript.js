// A Snowflake-style ID generator in JavaScript, with a clock we control so every run prints the same lines.
// Layout (teaching size): time in milliseconds | 3 machine bits | 2 sequence bits.
// Real layouts use more bits, for example 41 for time, 10 for the machine and 12 for the sequence.

const MACHINE_BITS = 3, SEQUENCE_BITS = 2;
const MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1; // 3, so 4 ids fit in one millisecond
const START_MS = 1000;                          // where the fake clock starts
const OVERFLOW_REQUEST = 6;                     // more ids than fit in one millisecond
const CLOCK_BACK_MS = 3;                        // how far the clock is set back
const YESTERDAY_FIRST = 41823, YESTERDAY_LAST = 43201; // auto-increment order numbers seen a day apart

class IdGenerator {
  constructor(machine, clock, waitOneMs) {
    this.machine = machine; this.clock = clock; this.waitOneMs = waitOneMs;
    this.last = -1; this.sequence = 0;
  }

  next() {
    let now = this.clock();
    if (now < this.last) throw new Error(`clock moved back by ${this.last - now} ms, refusing to issue ids`);
    if (now === this.last) {
      this.sequence = (this.sequence + 1) & MAX_SEQUENCE;
      if (this.sequence === 0) { // the sequence is used up: wait for the next millisecond
        do { this.waitOneMs(); now = this.clock(); } while (now <= this.last);
      }
    } else {
      this.sequence = 0;
    }
    this.last = now;
    return (now << (MACHINE_BITS + SEQUENCE_BITS)) | (this.machine << SEQUENCE_BITS) | this.sequence;
  }
}

const decode = (id) => `time ${id >> (MACHINE_BITS + SEQUENCE_BITS)}, machine ${(id >> SEQUENCE_BITS) & ((1 << MACHINE_BITS) - 1)}, sequence ${id & MAX_SEQUENCE}`;

let time = START_MS;
const clock = () => time;
const waitOneMs = () => { time += 1; };

// 1. Two databases that each count from 1 hand out the same numbers.
const nodeA = [1, 2, 3], nodeB = [1, 2, 3];
console.log(`auto-increment on 2 nodes: ${nodeA.length + nodeB.length} ids, ${new Set([...nodeA, ...nodeB]).size} distinct`);

// 2. Different machine numbers keep two nodes apart, even in the same millisecond.
const a = new IdGenerator(1, clock, waitOneMs), b = new IdGenerator(2, clock, waitOneMs);
const ids = [a.next(), a.next(), b.next(), b.next()];
for (const id of ids) console.log(`id ${id} = ${decode(id)}`);
console.log(`machines 1 and 2: ${ids.length} ids, ${new Set(ids).size} distinct`);

// 3. Two processes started with the same machine number repeat each other.
const c = new IdGenerator(3, clock, waitOneMs), d = new IdGenerator(3, clock, waitOneMs);
const clash = [c.next(), c.next(), d.next(), d.next()];
console.log(`both machine 3: ${clash.length} ids, ${new Set(clash).size} distinct`);

// 4. More ids than the sequence holds: the generator waits for the next millisecond.
time += 1;
const busy = new IdGenerator(4, clock, waitOneMs);
const burst = Array.from({ length: OVERFLOW_REQUEST }, () => busy.next());
const burstTimes = new Set(burst.map((id) => id >> (MACHINE_BITS + SEQUENCE_BITS)));
console.log(`${OVERFLOW_REQUEST} ids asked in one millisecond: last one is ${decode(burst[OVERFLOW_REQUEST - 1])}, spread over ${burstTimes.size} ms`);

// 5. A clock set back is refused, not trusted.
time -= CLOCK_BACK_MS;
let refused = false;
try { busy.next(); } catch (e) { refused = true; console.log(`clock set back: ${e.message}`); }

// 6. Ids made later are larger, so sorting by value sorts by time.
const sorted = [...burst].sort((x, y) => x - y).every((id, i) => id === burst[i]);
console.log(`sorted by value is sorted by time: ${sorted}`);

// 7. A plain counter tells a competitor your volume.
console.log(`two auto-increment ids a day apart: ${YESTERDAY_LAST - YESTERDAY_FIRST} orders that day`);

if (new Set(ids).size !== 4 || new Set(clash).size !== 2 || burstTimes.size !== 2 || !refused || !sorted) process.exit(1);
