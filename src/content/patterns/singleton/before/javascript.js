// Without the pattern: every component makes its own AppConfig.

class AppConfig {
  #settings = new Map();
  set(key, value) { this.#settings.set(key, value); }
  get(key) { return this.#settings.get(key); }
}

const header = new AppConfig();
header.set("theme", "dark");

const footer = new AppConfig(); // a second, separate object
console.log(footer.get("theme")); // undefined: the footer never saw the change
console.log(header === footer);   // false
