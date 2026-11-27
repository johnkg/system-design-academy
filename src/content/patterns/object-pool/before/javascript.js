// Without the pattern: every request opens its own connection.

let opened = 0;
function openConnection() { // slow, and the database allows only a few at once
  opened += 1;
  return { id: opened };
}

for (const request of [1, 2, 3, 4]) {
  const conn = openConnection();
  console.log(`request ${request} opens a new connection ${conn.id}`);
}
console.log(`Connections created: ${opened}`); // one per request: no reuse, no upper limit
