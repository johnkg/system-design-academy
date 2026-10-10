// Without the pattern: the planner decides and builds the transport itself.

class Truck {
  deliver(cargo) { return `Truck delivers ${cargo} by road`; }
}
class Ship {
  deliver(cargo) { return `Ship delivers ${cargo} by sea`; }
}

function planDelivery(kind, cargo) {
  let transport;
  if (kind === "road") transport = new Truck();      // knows every concrete class
  else if (kind === "sea") transport = new Ship();
  else throw new Error(`Unknown delivery kind: ${kind}`);
  // Want air delivery? Edit this function, and every other place with this if/else.
  return transport.deliver(cargo);
}

console.log(planDelivery("road", "40 crates"));
console.log(planDelivery("sea", "40 crates"));
