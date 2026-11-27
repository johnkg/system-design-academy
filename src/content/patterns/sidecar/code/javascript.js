// Sidecar in JavaScript. The app has no networking code: a helper beside it adds logging and retries.

const replies = { inventory: "reserved", payments: "charged" };
function network(target, attempt) { // stand-in for the real network: the first attempt always times out
  if (attempt === 1) throw new Error("timeout");
  return replies[target];
}

class Sidecar { // Runs beside the app; the app talks to it as if it were the network
  #count = 0;
  send(target, attempts = 3) {
    const id = `r-${++this.#count}`;
    console.log(`[sidecar] request ${id} to ${target}`);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const reply = network(target, attempt);
        console.log(`[sidecar] attempt ${attempt} ok`);
        return reply;
      } catch (error) {
        console.log(`[sidecar] attempt ${attempt} failed: ${error.message}`);
      }
    }
    throw new Error(`${target} unavailable`);
  }
}

class PaymentsService { // Application: business logic only
  constructor(sidecar) { this.sidecar = sidecar; }
  run() { console.log(`payments: inventory answered "${this.sidecar.send("inventory")}"`); }
}

class OrdersService {
  constructor(sidecar) { this.sidecar = sidecar; }
  run() { console.log(`orders: payments answered "${this.sidecar.send("payments")}"`); }
}

new PaymentsService(new Sidecar()).run(); // each instance gets its own sidecar
new OrdersService(new Sidecar()).run();
