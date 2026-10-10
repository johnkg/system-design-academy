// Abstract Factory in JavaScript. One factory per theme, each builds a matching family.

class LightButton { render(label) { return `Light[ ${label} ]`; } }       // Concrete Product
class LightCheckbox { render(label) { return `Light[x] ${label}`; } }    // Concrete Product
class DarkButton { render(label) { return `Dark< ${label} >`; } }        // Concrete Product
class DarkCheckbox { render(label) { return `Dark<x> ${label}`; } }      // Concrete Product

class LightFactory { // Concrete Factory
  createButton() { return new LightButton(); }
  createCheckbox() { return new LightCheckbox(); }
}

class DarkFactory { // Concrete Factory
  createButton() { return new DarkButton(); }
  createCheckbox() { return new DarkCheckbox(); }
}

function renderForm(factory) { // Client: only knows the factory and product interfaces
  const button = factory.createButton();
  const checkbox = factory.createCheckbox();
  return [checkbox.render("Remember me"), button.render("Sign in")].join("\n");
}

console.log(renderForm(new LightFactory()));
console.log(renderForm(new DarkFactory())); // same code, a whole different family
