// Data Mapper in JavaScript. The User knows nothing about the table; the mapper does.

class User { // Domain object
  constructor(id, name, email) { Object.assign(this, { id, name, email }); }
  rename(name) { this.name = name; }
}

class Table { // Storage: rows are plain column-to-value objects
  rows = new Map();
  put(id, row) { this.rows.set(id, { ...row }); }
  get(id) { return { ...this.rows.get(id) }; }
  renameColumn(from, to) {
    for (const [id, row] of this.rows) {
      this.rows.set(id, Object.fromEntries(Object.entries(row).map(([k, v]) => [k === from ? to : k, v])));
    }
  }
}

class UserMapper { // Mapper: the only place that knows the column names
  constructor(table, columns) { this.table = table; this.columns = columns; }
  find(id) {
    const row = this.table.get(id);
    return new User(id, row[this.columns.name], row[this.columns.email]);
  }
  save(user) {
    this.table.put(user.id, { [this.columns.name]: user.name, [this.columns.email]: user.email });
  }
}

const show = (row) => Object.entries(row).map(([k, v]) => `${k}=${v}`).join("; ");

const table = new Table();
table.put(1, { full_name: "Ada Lovelace", mail: "ada@example.com" });
const mapper = new UserMapper(table, { name: "full_name", email: "mail" });

const user = mapper.find(1);
console.log(`Loaded: ${user.name} <${user.email}>`);

user.rename("Ada King");
mapper.save(user);
console.log(`Row: ${show(table.get(1))}`);

table.renameColumn("mail", "email_address"); // the schema changes...
const afterRename = new UserMapper(table, { name: "full_name", email: "email_address" }); // ...and only this line follows
const again = afterRename.find(1);
console.log(`Loaded after the column rename: ${again.name} <${again.email}>`);
