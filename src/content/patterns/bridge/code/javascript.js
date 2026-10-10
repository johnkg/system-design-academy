// Bridge in JavaScript. Remote (abstraction) delegates to a Device (implementation).

class Tv { // Concrete Implementor
  #on = false; #volume = 30;
  isEnabled() { return this.#on; }
  enable() { this.#on = true; }
  disable() { this.#on = false; }
  getVolume() { return this.#volume; }
  setVolume(v) { this.#volume = Math.max(0, Math.min(100, v)); }
  name() { return "TV"; }
}

class Radio { // Concrete Implementor
  #on = false; #volume = 10;
  isEnabled() { return this.#on; }
  enable() { this.#on = true; }
  disable() { this.#on = false; }
  getVolume() { return this.#volume; }
  setVolume(v) { this.#volume = Math.max(0, Math.min(100, v)); }
  name() { return "Radio"; }
}

class Remote { // Abstraction: holds the bridge
  constructor(device) { this.device = device; }
  togglePower() { this.device.isEnabled() ? this.device.disable() : this.device.enable(); }
  volumeUp() { this.device.setVolume(this.device.getVolume() + 10); }
}

class AdvancedRemote extends Remote { // Refined Abstraction
  mute() { this.device.setVolume(0); }
}

for (const device of [new Tv(), new Radio()]) {
  const remote = new AdvancedRemote(device); // any remote works with any device
  remote.togglePower();
  remote.volumeUp();
  console.log(`${device.name()}: on=${device.isEnabled()} volume=${device.getVolume()}`);
  remote.mute();
  console.log(`${device.name()}: volume=${device.getVolume()}`);
}
