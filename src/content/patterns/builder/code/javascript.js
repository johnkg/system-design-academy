// Builder in JavaScript. A fluent builder with defaults and validation in build().

class Pizza { // Product
  constructor({ size, crust, toppings, extraSauce }) {
    Object.assign(this, { size, crust, toppings, extraSauce });
    Object.freeze(this);
  }
  describe() {
    const extras = this.extraSauce ? ", extra sauce" : "";
    return `${this.size} ${this.crust} pizza with ${this.toppings.join(", ") || "no toppings"}${extras}`;
  }
}

const MAX_TOPPINGS = 4;

class PizzaBuilder { // Builder
  #size = "medium";
  #crust = "thin";
  #toppings = [];
  #extraSauce = false;

  size(value) { this.#size = value; return this; }
  crust(value) { this.#crust = value; return this; }
  addTopping(name) { this.#toppings.push(name); return this; }
  extraSauce() { this.#extraSauce = true; return this; }

  build() {
    if (this.#toppings.length > MAX_TOPPINGS) throw new Error("Too many toppings (max 4)");
    return new Pizza({ size: this.#size, crust: this.#crust, toppings: [...this.#toppings], extraSauce: this.#extraSauce });
  }
}

class PizzaMenu { // Director: stores recipes
  static margherita(builder) { return builder.size("medium").addTopping("mozzarella").addTopping("basil").build(); }
}

const custom = new PizzaBuilder().size("large").crust("thick").addTopping("ham").addTopping("olives").extraSauce().build();
console.log(custom.describe());
console.log(PizzaMenu.margherita(new PizzaBuilder()).describe());
