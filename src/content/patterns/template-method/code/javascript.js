// Template Method in JavaScript. prepare() fixes the order; subclasses fill in steps.

class Beverage { // Abstract Class
  prepare() { // the template method: do not override
    this.boilWater();
    this.brew();
    this.pour();
    if (this.wantsCondiments()) this.addCondiments();
  }

  boilWater() { console.log("Boiling water"); }   // shared step
  pour() { console.log("Pouring into cup"); }      // shared step
  brew() { throw new Error("Subclasses must implement brew()"); }                 // variable step
  addCondiments() { throw new Error("Subclasses must implement addCondiments()"); }
  wantsCondiments() { return true; }               // hook: optional override
}

class Tea extends Beverage { // Concrete Class
  brew() { console.log("Steeping the tea bag"); }
  addCondiments() { console.log("Adding lemon"); }
}

class Coffee extends Beverage { // Concrete Class
  brew() { console.log("Dripping coffee through the filter"); }
  addCondiments() { console.log("Adding sugar and milk"); }
  wantsCondiments() { return false; } // this coffee is served black
}

new Tea().prepare();
console.log("---");
new Coffee().prepare();
