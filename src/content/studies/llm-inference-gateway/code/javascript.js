// The token budget of an LLM gateway, in JavaScript:
// each team has a token bucket. A request reserves "prompt + max output" before it runs and gets the unused part back when it finishes.

class Budget {
  // Levels are kept in milli-tokens so refills are exact integers. rate is tokens per second, now is in milliseconds.
  constructor(capacity, rate) { this.cap = capacity * 1000; this.rate = rate; this.level = this.cap; this.last = 0; }
  refill(now) { this.level = Math.min(this.cap, this.level + (now - this.last) * this.rate); this.last = now; }
  reserve(tokens, now) {
    this.refill(now);
    if (this.level < tokens * 1000) return false;
    this.level -= tokens * 1000;
    return true;
  }
  settle(reserved, used) { this.level = Math.min(this.cap, this.level + (reserved - used) * 1000); }
}

// Price per token in micro-dollars: [input, output]. Short prompts go to the small model, the rest to the large one.
const PRICE = { small: [1, 4], large: [3, 15] };
const TEAMS = [{ name: 'search', cap: 20000, rate: 3000 }, { name: 'support', cap: 20000, rate: 3000 }, { name: 'research', cap: 40000, rate: 6000 }];

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

function simulate(refund) {
  seed = 7;
  const budgets = TEAMS.map((t) => new Budget(t.cap, t.rate));
  const stats = TEAMS.map(() => ({ ok: 0, rejected: 0, tokens: 0, cost: 0 }));
  let now = 0;
  for (let i = 0; i < 300; i++) {
    now += 40 + random(200);
    const team = random(3), prompt = 200 + random(1800), maxOut = 1024, out = 50 + random(500);
    const reserved = prompt + maxOut;
    if (!budgets[team].reserve(reserved, now)) { stats[team].rejected++; continue; }
    const model = prompt < 800 ? 'small' : 'large';
    const used = prompt + out;
    if (refund) budgets[team].settle(reserved, used); // without it the whole reservation stays spent
    stats[team].ok++; stats[team].tokens += used;
    stats[team].cost += prompt * PRICE[model][0] + out * PRICE[model][1];
  }
  return { stats, seconds: now / 1000 };
}

for (const refund of [true, false]) {
  const { stats, seconds } = simulate(refund);
  console.log(refund ? 'reserve, then refund the unused part:' : 'reserve and never refund:');
  stats.forEach((s, i) => {
    console.log(`  ${TEAMS[i].name}: ${s.ok} served, ${s.rejected} rejected, ${s.tokens} tokens, cost ${s.cost} micro-dollars`);
    const allowed = TEAMS[i].cap + (TEAMS[i].rate * seconds); // a bucket can never hand out more than this
    if (s.tokens > allowed) { console.log('budget exceeded'); process.exit(1); }
  });
}
const served = (r) => r.stats.reduce((a, s) => a + s.ok, 0);
const withRefund = served(simulate(true)), without = served(simulate(false));
console.log(`served with refund: ${withRefund}, without: ${without}`);
if (withRefund <= without) process.exit(1);
