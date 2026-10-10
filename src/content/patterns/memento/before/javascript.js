// Without the pattern: the save code reaches into the player's fields.

class Player {
  hp = 100;      // everything public so the saver can touch it
  level = 1;
}

const player = new Player();
const saves = [];

saves.push({ hp: player.hp, level: player.level }); // must know every field
player.hp -= 70;
player.level++;

const last = saves.pop();
player.hp = last.hp;                                 // and write each one back
player.level = last.level;
console.log(player);

// Add "inventory" to Player and forget to update the saver: saves silently lose it.
// Any code can also set player.hp = 9999 directly.
