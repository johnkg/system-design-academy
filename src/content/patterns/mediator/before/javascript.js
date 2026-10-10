// Without the pattern: every user holds references to every other user.

class User {
  constructor(name) { this.name = name; this.friends = []; }
  send(message) { for (const f of this.friends) f.receive(this.name, message); }
  receive(from, message) { console.log(`${this.name} got "${message}" from ${from}`); }
}

const ada = new User("Ada"), bob = new User("Bob"), cy = new User("Cy");
ada.friends = [bob, cy];   // 3 users, 6 links to wire by hand
bob.friends = [ada, cy];
cy.friends = [ada, bob];

ada.send("Hi all");
// A 4th user means editing all three existing users. A "no swearing" rule means
// copying the check into every User. Muting someone means changing everyone's list.
