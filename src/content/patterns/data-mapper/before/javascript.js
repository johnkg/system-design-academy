// Without the pattern: the User reads and writes rows, so it knows the column names.

class User {
  constructor(row) {
    this.name = row.full_name; // column names baked into the domain class
    this.email = row.mail;
  }
  toRow() { return { full_name: this.name, mail: this.email }; }
}

const row = { full_name: "Ada Lovelace", mail: "ada@example.com" };
const user = new User(row);
console.log(`Loaded: ${user.name} <${user.email}>`);

// The schema changes: mail becomes email_address. The User and every class like it must be edited.
const renamed = { full_name: "Ada Lovelace", email_address: "ada@example.com" };
const broken = new User(renamed);
console.log(`Loaded after the column rename: ${broken.name} <${broken.email}>`); // email is undefined
