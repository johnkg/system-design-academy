// Without the pattern: one plain lock, so readers take turns even though reading changes nothing.

class Mutex {
  #held = false;
  tryLock() { if (this.#held) return false; this.#held = true; return true; }
  unlock() { this.#held = false; }
}

const mutex = new Mutex();

function read(name) {
  if (!mutex.tryLock()) return console.log(`${name} must wait (lock is held)`);
  console.log(`${name} acquired`);
}
function release(name) {
  mutex.unlock();
  console.log(`${name} released`);
}

read("reader 1");
read("reader 2"); // blocked, although reader 1 only reads
release("reader 1");
read("reader 2");
release("reader 2");
