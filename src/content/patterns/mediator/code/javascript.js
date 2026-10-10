// Mediator in JavaScript. Users talk only to the ChatRoom.

class ChatRoom { // Concrete Mediator
  #users = new Map();

  register(user) { this.#users.set(user.name, user); user.room = this; }

  send(from, message, to = null) {
    const recipients = to ? [this.#users.get(to)] : [...this.#users.values()].filter((u) => u !== from);
    for (const user of recipients) user?.receive(from.name, message);
  }
}

class User { // Colleague
  constructor(name) { this.name = name; this.room = null; }
  send(message, to) { this.room.send(this, message, to); } // goes via the mediator
  receive(from, message) { console.log(`${this.name} got "${message}" from ${from}`); }
}

const room = new ChatRoom();
const ada = new User("Ada");
const bob = new User("Bob");
const cy = new User("Cy");
[ada, bob, cy].forEach((u) => room.register(u));

ada.send("Hi all");        // Bob and Cy receive it
bob.send("Hi Ada", "Ada"); // only Ada receives it
