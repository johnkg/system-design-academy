// Read-Write Lock in JavaScript. Plain JavaScript has no shared-memory threads, so this models the lock's rules
// with try-style calls; real code would block instead of returning false.

class ReadWriteLock {
  #readers = 0;
  #writer = false;

  tryRead() { // many readers may enter together, unless a writer is inside
    if (this.#writer) return false;
    this.#readers += 1;
    return true;
  }
  releaseRead() { this.#readers -= 1; }

  tryWrite() { // a writer needs the lock to itself
    if (this.#writer || this.#readers > 0) return false;
    this.#writer = true;
    return true;
  }
  releaseWrite() { this.#writer = false; }

  get readers() { return this.#readers; }
}

const lock = new ReadWriteLock();
const config = { version: 1 }; // Shared data

function read(name) {
  if (!lock.tryRead()) return console.log(`${name} must wait (writer active)`);
  console.log(`${name} acquired (readers: ${lock.readers}), sees version ${config.version}`);
}
function release(name) {
  lock.releaseRead();
  console.log(`${name} released (readers: ${lock.readers})`);
}

read("reader 1");
read("reader 2");
if (!lock.tryWrite()) console.log(`writer must wait (readers: ${lock.readers})`);
release("reader 1");
release("reader 2");
if (lock.tryWrite()) { config.version = 2; console.log("writer acquired (exclusive), set version 2"); }
read("reader 3");
lock.releaseWrite();
console.log("writer released");
read("reader 3");
