// Without the pattern: the form picks every widget's class itself.

class LightButton { render(label) { return `Light[ ${label} ]`; } }
class LightCheckbox { render(label) { return `Light[x] ${label}`; } }
class DarkButton { render(label) { return `Dark< ${label} >`; } }
class DarkCheckbox { render(label) { return `Dark<x> ${label}`; } }

function renderForm(theme) {
  const button = theme === "dark" ? new DarkButton() : new LightButton();
  const checkbox = theme === "dark" ? new DarkCheckbox() : new LightCheckbox();
  // Every widget repeats the theme check. A third theme means editing this
  // function and every other place that builds widgets. Easy to mix families by mistake:
  // const checkbox = new LightCheckbox();   // oops, light checkbox in a dark form
  return [checkbox.render("Remember me"), button.render("Sign in")].join("\n");
}

console.log(renderForm("light"));
console.log(renderForm("dark"));
