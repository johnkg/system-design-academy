// Without the pattern: each drink copies the whole recipe.

class Tea {
  prepare() {
    console.log("Boiling water");
    console.log("Steeping the tea bag");
    console.log("Pouring into cup");
    console.log("Adding lemon");
  }
}

class Coffee {
  prepare() {
    console.log("Boiling water");                       // copied
    console.log("Dripping coffee through the filter");
    console.log("Pouring into cup");                     // copied
    // someone forgot the condiments step here, and nothing complains
  }
}

new Tea().prepare();
console.log("---");
new Coffee().prepare();
// Change the shared "boil water" step? Edit every class. The order can drift silently.
