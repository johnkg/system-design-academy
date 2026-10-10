// Memento in JavaScript. The player makes and restores snapshots; the manager only stores them.

class Snapshot { // Memento: immutable and opaque to everyone but Player
  #state;
  constructor(state) { this.#state = Object.freeze({ ...state }); }
  static read(snapshot) { return snapshot.#state; } // only Player's code path uses this
}

class Player { // Originator
  #hp = 100;
  #level = 1;

  takeDamage(amount) { this.#hp = Math.max(0, this.#hp - amount); }
  levelUp() { this.#level++; }
  describe() { return `HP ${this.#hp}, level ${this.#level}`; }

  save() { return new Snapshot({ hp: this.#hp, level: this.#level }); }
  restore(snapshot) {
    const { hp, level } = Snapshot.read(snapshot);
    this.#hp = hp;
    this.#level = level;
  }
}

class CheckpointManager { // Caretaker: stores, never inspects
  #stack = [];
  save(player) { this.#stack.push(player.save()); }
  loadLast(player) { const s = this.#stack.pop(); if (s) player.restore(s); }
}

const player = new Player();
const checkpoints = new CheckpointManager();

checkpoints.save(player);       // HP 100, level 1
player.takeDamage(70);
player.levelUp();
console.log(player.describe()); // HP 30, level 2
checkpoints.loadLast(player);
console.log(player.describe()); // HP 100, level 1
