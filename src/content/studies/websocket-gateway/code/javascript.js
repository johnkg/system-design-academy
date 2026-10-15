// A gateway session in JavaScript: every message gets a per-user sequence number, a bounded queue protects the server
// from a slow client, and a short buffer lets a client that reconnects resume from the last number it saw.

const BUFFER = 5; // messages kept for resume
const QUEUE = 4;  // messages waiting for one connection before it is cut off

class Session {
  constructor() { this.seq = 0; this.buffer = []; this.queue = []; this.connected = true; this.cutOffs = 0; }

  send(text) {
    const msg = { seq: ++this.seq, text };
    this.buffer.push(msg);
    if (this.buffer.length > BUFFER) this.buffer.shift();   // the oldest message falls out of the resume window
    if (!this.connected) return;                            // nobody to write to: the buffer is all we keep
    if (this.queue.length >= QUEUE) { this.connected = false; this.queue = []; this.cutOffs++; return; } // slow consumer: close it
    this.queue.push(msg);
  }

  // The client says "my last sequence number was n". Replay what follows, or ask for a full refresh.
  resume(last) {
    this.connected = true; this.queue = [];
    if (last >= this.seq) return { kind: 'replay', messages: [] };
    if (this.buffer[0].seq > last + 1) return { kind: 'refresh', seq: this.seq }; // the gap is older than the buffer
    return { kind: 'replay', messages: this.buffer.filter((m) => m.seq > last) };
  }
}

class Client {
  constructor() { this.last = 0; this.applied = []; }
  apply(msg) { if (msg.seq <= this.last) return; this.last = msg.seq; this.applied.push(msg.seq); } // a repeat is ignored
  read(session, n) { for (let i = 0; i < n && session.queue.length; i++) this.apply(session.queue.shift()); }
  reconnect(session) {
    const r = session.resume(this.last);
    if (r.kind === 'refresh') this.last = r.seq; else r.messages.forEach((m) => this.apply(m));
    return r.kind === 'refresh' ? `refresh to ${r.seq}` : `replay [${r.messages.map((m) => m.seq).join(',')}]`;
  }
}

const s = new Session(), c = new Client();
for (let i = 1; i <= 6; i++) { s.send(`m${i}`); c.read(s, 1); }
console.log(`connected: client has seen up to ${c.last}`);

s.connected = false;                                   // the phone enters a tunnel
for (let i = 7; i <= 9; i++) s.send(`m${i}`);
console.log(`resume from ${c.last}: ${c.reconnect(s)}`);

s.connected = false;                                   // a long outage: more messages than the buffer holds
for (let i = 10; i <= 17; i++) s.send(`m${i}`);
console.log(`resume from ${c.last}: ${c.reconnect(s)}`);

for (let i = 18; i <= 23; i++) { s.send(`m${i}`); if (i === 18) c.read(s, 1); } // the client reads one, then stops reading
console.log(`slow client cut off ${s.cutOffs} time; queue limit ${QUEUE}`);
console.log(`resume from ${c.last}: ${c.reconnect(s)}`);
c.apply({ seq: 23, text: 'm23' });                     // the same message arrives a second time
console.log(`applied ${c.applied.length} messages, last ${c.last}, in order: ${c.applied.every((x, i) => i === 0 || x > c.applied[i - 1])}`);
if (c.last !== s.seq || s.cutOffs !== 1 || new Set(c.applied).size !== c.applied.length) process.exit(1);
