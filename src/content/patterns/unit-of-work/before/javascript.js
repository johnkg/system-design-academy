// Without the pattern: every change is written the moment it is made.

const store = new Map();
function write(key, value) {
  if (key.startsWith("points:") && !/^\d+$/.test(value)) throw new Error("points must be a number");
  store.set(key, value);
}
const show = () => [...store].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(", ");

function checkout() {
  write("order:2", "paid");
  write("stock:apple", "8");
  write("points:ada", "lots"); // fails here: the first two writes are already saved
}

try { checkout(); } catch (error) { console.log(`Checkout failed: ${error.message}`); }
console.log(`Store: ${show()}`); // a paid order and lower stock, with no points
