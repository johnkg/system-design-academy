// Factory Method in JavaScript. Subclasses override createTransport().

class Logistics { // Creator
  createTransport() { // the factory method
    throw new Error("Subclasses must implement createTransport()");
  }

  planDelivery(cargo) { // shared logic, works with any Transport
    const transport = this.createTransport();
    return transport.deliver(cargo);
  }
}

class RoadLogistics extends Logistics { // Concrete Creator
  createTransport() { return new Truck(); }
}

class SeaLogistics extends Logistics { // Concrete Creator
  createTransport() { return new Ship(); }
}

class Truck { // Concrete Product
  deliver(cargo) { return `Truck delivers ${cargo} by road`; }
}

class Ship { // Concrete Product
  deliver(cargo) { return `Ship delivers ${cargo} by sea`; }
}

for (const logistics of [new RoadLogistics(), new SeaLogistics()]) {
  console.log(logistics.planDelivery("40 crates")); // same call, different product
}
