// Without the pattern: a long positional constructor.

class Pizza {
  constructor(size, crust, hasCheese, toppings, extraSauce, glutenFree) {
    Object.assign(this, { size, crust, hasCheese, toppings, extraSauce, glutenFree });
  }
}

// What do these mean? Which boolean is which? Callers must pass everything.
const a = new Pizza("large", "thick", true, ["ham", "olives"], true, false);
const b = new Pizza("medium", "thin", true, ["mozzarella", "basil"], false, false);
console.log(a, b);
// Adding "stuffedCrust" later means a seventh argument at every call site.
