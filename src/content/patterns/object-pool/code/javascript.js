// Object Pool in JavaScript. Connections are created on demand up to a limit, then reused.

class Connection { // Pooled object
  constructor(id) { this.id = id; }
  reset() { /* clear session state so the next borrower starts clean */ }
}

class Pool {
  #free = [];
  constructor(size) { this.size = size; this.created = 0; }

  acquire() { // returns null when every connection is busy
    const free = this.#free.pop();
    if (free) return { conn: free, how: "reused" };
    if (this.created >= this.size) return null;
    this.created += 1;
    return { conn: new Connection(this.created), how: "created" };
  }

  release(conn) {
    conn.reset();
    this.#free.push(conn);
  }
}

const pool = new Pool(3);
const held = {};

for (const request of [1, 2, 3, 4]) {
  const got = pool.acquire();
  if (!got) {
    console.log(`request ${request} must wait: all ${pool.size} connections busy`);
    continue;
  }
  held[request] = got.conn;
  console.log(`request ${request} uses connection ${got.conn.id} (${got.how})`);
}

pool.release(held[1]);
console.log(`request 1 done, connection ${held[1].id} returned (reset)`);

const got = pool.acquire();
console.log(`request 4 uses connection ${got.conn.id} (${got.how})`);
console.log(`Connections created: ${pool.created}`);
