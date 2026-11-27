// Without the pattern: one thread per connection, each blocked on its own reads.
// (Modelled by counting: a real thread-per-connection server would block in read() on each of these.)

for (const connections of [3, 10000]) {
  const threads = connections; // one blocked thread for every connection, busy or idle
  console.log(`${connections} connections need ${threads} threads`);
}
// Most of those threads are asleep, waiting for a message that may not come for minutes.
