// Holding a seat without selling it twice in JavaScript:
// a seat is claimed with one atomic step that checks and changes it together, and an unpaid hold expires by itself.

const HOLD_SECONDS = 600;
const WAIT_SECONDS = 700; // longer than a hold, so unpaid holds expire

// The seat table. In a real database, claim() is one statement:
//   UPDATE seats SET holder = ?, expires = ? WHERE id = ? AND (holder IS NULL OR expires <= now)
class Seats {
  constructor(ids) { this.rows = new Map(ids.map((id) => [id, { holder: null, expires: 0, paid: false }])); }

  claim(id, user, now) {
    const seat = this.rows.get(id);
    if (seat.paid) return false;
    if (seat.holder !== null && seat.expires > now) return false; // someone else holds it, and the hold is still running
    seat.holder = user; seat.expires = now + HOLD_SECONDS; // check and change in one step
    return true;
  }

  // Payment arrived. Only the current holder, before the hold ran out, may turn the hold into a sale.
  confirm(id, user, now) {
    const seat = this.rows.get(id);
    if (seat.paid || seat.holder !== user || seat.expires <= now) return false;
    seat.paid = true;
    return true;
  }
}

// What goes wrong without it: check and change are two steps, and two buyers can both finish the first one.
function racySale(seats, id, buyers) {
  const seen = buyers.map(() => seats.get(id).owner === null); // every buyer reads the seat: it looks free
  buyers.forEach((user, i) => { if (seen[i]) { seats.get(id).owner = user; seats.get(id).sales++; } }); // then every buyer writes
}

const racy = new Map([['A1', { owner: null, sales: 0 }]]);
racySale(racy, 'A1', ['ann', 'ben']);
console.log(`without an atomic claim: A1 was sold ${racy.get('A1').sales} times`);

const seats = new Seats(['A1', 'A2']);
let t = 0;
const results = [
  ['ann claims A1', seats.claim('A1', 'ann', t)],
  ['ben claims A1 at the same moment', seats.claim('A1', 'ben', t)],
  ['ben claims A2', seats.claim('A2', 'ben', t)],
];
t += WAIT_SECONDS; // ben never pays, and more than ten minutes pass
results.push(['ben tries to pay for A2 after his hold ran out', seats.confirm('A2', 'ben', t)]);
results.push(['cat claims A2, now free again', seats.claim('A2', 'cat', t)]);
results.push(['ann pays for A1 after 700 seconds', seats.confirm('A1', 'ann', t)]);
results.push(['cat pays for A2', seats.confirm('A2', 'cat', t)]);
for (const [what, ok] of results) console.log(`${ok ? 'yes' : 'no '}  ${what}`);

const expected = [true, false, true, false, true, false, true];
if (racy.get('A1').sales !== 2 || results.some(([, ok], i) => ok !== expected[i])) process.exit(1);
