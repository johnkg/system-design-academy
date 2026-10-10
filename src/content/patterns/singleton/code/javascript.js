// Singleton in JavaScript. JS has no private constructors, so a flag guards `new`.

class AppConfig { // Singleton
  static #instance = null;
  static #creating = false;
  #settings = new Map();

  constructor() {
    if (!AppConfig.#creating) throw new Error("Use AppConfig.getInstance()");
  }

  static getInstance() {
    if (!AppConfig.#instance) { // created once, on first use
      AppConfig.#creating = true;
      AppConfig.#instance = new AppConfig();
      AppConfig.#creating = false;
    }
    return AppConfig.#instance;
  }

  set(key, value) { this.#settings.set(key, value); }
  get(key) { return this.#settings.get(key); }
}

const header = AppConfig.getInstance(); // Client
header.set("theme", "dark");

const footer = AppConfig.getInstance(); // Client
console.log(footer.get("theme"));       // "dark": same object
console.log(header === footer);         // true

try {
  new AppConfig();                      // duplicates are refused
} catch (error) {
  console.log(error.message);
}
