// Without the pattern: a shallow copy shares the nested list.

class Enemy {
  constructor(name, hp, items = []) {
    this.name = name;
    this.hp = hp;
    this.items = items;
  }
}

const template = new Enemy("Goblin", 30, ["club"]);
const a = { ...template };   // looks like a copy, but items is the same array
const b = { ...template };

a.items.push("shield");
console.log(a.items); // [ 'club', 'shield' ]
console.log(b.items); // [ 'club', 'shield' ]  <- leaked into b (and into template)
console.log(template.items === a.items); // true
