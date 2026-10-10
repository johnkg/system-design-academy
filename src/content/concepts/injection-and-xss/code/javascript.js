// Keeping data and code apart in JavaScript: parameterized queries and HTML encoding.
// The "database" is only a printout here, so the focus stays on how the query is built.

// Unsafe: user input becomes part of the query text
const unsafeQuery = (name) => `SELECT * FROM users WHERE name = '${name}'`;

// Safe: the query text is fixed, and the value travels separately as data
const safeQuery = (name) => ({ text: "SELECT * FROM users WHERE name = ?", params: [name] });

const attack = "' OR '1'='1";
console.log(`unsafe, normal input: ${unsafeQuery("alice")}`);
console.log(`unsafe, attack input: ${unsafeQuery(attack)}`);
const safe = safeQuery(attack);
console.log(`safe, attack input:   ${safe.text}  with params [${safe.params.map((p) => JSON.stringify(p))}]`);

// Column names cannot be parameters, so allow only known values
const SORTABLE = new Set(["name", "created"]);
const orderBy = (column) => (SORTABLE.has(column) ? `ORDER BY ${column}` : "ORDER BY name");
console.log(`sort by created: ${orderBy("created")}`);
console.log(`sort by "name; DROP TABLE users": ${orderBy("name; DROP TABLE users")}`);

// Output encoding for HTML text and attribute values
const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const review = '<script>steal(document.cookie)</script>';
console.log(`raw HTML:     <p>${review}</p>`);
console.log(`encoded HTML: <p>${escapeHtml(review)}</p>`);
