// A lease manager that issues increasing fencing tokens, and a storage that can reject stale tokens.
// The clock is a plain variable so the pause scenario is deterministic.

let now = 0; // seconds, moved by hand

class LeaseManager {
  #holder = null;
  #expiresAt = 0;
  latestToken = 0;

  constructor(duration) {
    this.duration = duration;
  }

  // Grant or renew. Another node's live lease blocks the request. A new owner gets a higher token.
  acquire(who) {
    const live = this.#holder !== null && now < this.#expiresAt;
    if (live && this.#holder !== who) return null;
    if (!live || this.#holder !== who) this.latestToken++;
    this.#holder = who;
    this.#expiresAt = now + this.duration;
    return { token: this.latestToken, expiresAt: this.#expiresAt };
  }
}

class Storage {
  maxToken = 0;
  content = "(empty)";
  accepted = [];
  corrupted = false;

  constructor(checksTokens, manager) {
    this.checksTokens = checksTokens;
    this.manager = manager;
  }

  write(who, token, data) {
    if (this.checksTokens && token < this.maxToken) {
      console.log(`t=${now} storage REJECTS ${data} from ${who}: token ${token} < ${this.maxToken}`);
      return false;
    }
    this.maxToken = Math.max(this.maxToken, token);
    this.content = data;
    this.accepted.push(data);
    // Omniscient check for the demo: was the writer still the newest owner?
    if (token !== this.manager.latestToken) this.corrupted = true;
    console.log(`t=${now} storage accepts ${data} from ${who} (token ${token})`);
    return true;
  }
}

function scenario(checksTokens) {
  now = 0;
  const manager = new LeaseManager(10);
  const storage = new Storage(checksTokens, manager);

  const a = manager.acquire("A");
  console.log(`t=${now} A gets lease: token ${a.token}, expires at t=${a.expiresAt}`);
  now = 1;
  storage.write("A", a.token, "A1");
  now = 3;
  console.log(`t=${now} A passes its lease check, then a GC pause freezes it until t=18`);
  now = 5;
  console.log(`t=${now} B asks for the lease: ${manager.acquire("B") === null ? "denied, A holds it" : "granted"}`);
  now = 10;
  const b = manager.acquire("B");
  console.log(`t=${now} B gets lease: token ${b.token}, expires at t=${b.expiresAt}`);
  storage.write("B", b.token, "B1");
  now = 18;
  console.log(`t=${now} A wakes and still believes it holds the lease`);
  storage.write("A", a.token, "A2"); // A's token is still 1
  return storage;
}

console.log("--- without fencing check ---");
const plain = scenario(false);
console.log(`file: ${plain.content}, accepted: ${plain.accepted.join(",")}, corrupted: ${plain.corrupted}`);
console.log("--- with fencing check ---");
const fenced = scenario(true);
console.log(`file: ${fenced.content}, accepted: ${fenced.accepted.join(",")}, corrupted: ${fenced.corrupted}`);

if (!plain.corrupted || plain.content !== "A2") throw new Error("expected a stale write to corrupt the unfenced file");
if (fenced.corrupted || fenced.content !== "B1") throw new Error("fencing must protect the file");
console.log("invariants hold");
