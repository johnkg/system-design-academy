// Without the pattern: every service carries its own copy of the retry and logging code.

const replies = { inventory: "reserved", payments: "charged" };
function network(target, attempt) {
  if (attempt === 1) throw new Error("timeout");
  return replies[target];
}

class PaymentsService {
  call(target) { // copy 1 of the retry loop
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return network(target, attempt); }
      catch (error) { console.log(`[payments] attempt ${attempt} failed: ${error.message}`); }
    }
  }
  run() { console.log(`payments: inventory answered "${this.call("inventory")}"`); }
}

class OrdersService {
  call(target) { // copy 2: written separately, and already different (two attempts, no log line)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return network(target, attempt); } catch { /* retry */ }
    }
  }
  run() { console.log(`orders: payments answered "${this.call("payments")}"`); }
}

new PaymentsService().run();
new OrdersService().run();
