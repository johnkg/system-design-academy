// A message queue in JavaScript: publish, receive, ack, retry, and a dead-letter queue.

class MessageQueue {
  #ready = [];
  #inFlight = new Map();
  #nextId = 1;
  deadLetters = [];

  constructor(maxAttempts = 3) { this.maxAttempts = maxAttempts; }

  publish(body) { this.#ready.push({ id: this.#nextId++, body, attempts: 0 }); }

  receive() { // hand a message to a worker; it stays "in flight" until acked or nacked
    const message = this.#ready.shift();
    if (!message) return null;
    message.attempts++;
    this.#inFlight.set(message.id, message);
    return message;
  }

  ack(id) { this.#inFlight.delete(id); } // done: delete it for good

  nack(id) { // failed: try again later, or give up after too many attempts
    const message = this.#inFlight.get(id);
    this.#inFlight.delete(id);
    if (message.attempts >= this.maxAttempts) this.deadLetters.push(message);
    else this.#ready.push(message);
  }
}

function runWorker(queue, handle) {
  let message;
  while ((message = queue.receive())) {
    try {
      handle(message.body);
      queue.ack(message.id);
      console.log(`ok     ${message.body}`);
    } catch (error) {
      console.log(`failed ${message.body} (attempt ${message.attempts}): ${error.message}`);
      queue.nack(message.id);
    }
  }
}

const queue = new MessageQueue(3);
["email:ada", "email:BAD", "email:cy"].forEach((m) => queue.publish(m)); // the producer never waits

runWorker(queue, (body) => { if (body.includes("BAD")) throw new Error("malformed address"); });
console.log(`dead letters: [${queue.deadLetters.map((m) => m.body).join(", ")}]`);
