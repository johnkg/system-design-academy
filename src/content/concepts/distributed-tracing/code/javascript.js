// A minimal tracer in JavaScript: spans, parent-child links and trace context propagation.
// A fake clock moved by hand makes the durations deterministic.

// Simulated work per service, in milliseconds.
const PAYMENT_MS = 1800, ORDERS_BEFORE_MS = 20, ORDERS_AFTER_MS = 30, GATEWAY_EACH_SIDE_MS = 10;
let clock = 0; // milliseconds
const spans = [];

function startSpan(name, parent = null) {
  const span = { name, traceId: parent ? parent.traceId : "abc123", parentName: parent ? parent.name : null, start: clock, end: 0 };
  spans.push(span);
  return span;
}
const endSpan = (span) => { span.end = clock; };
const work = (ms) => { clock += ms; }; // pretend to do work

// The caller puts the trace context in a header, and the callee builds its span from it
const toHeader = (span) => `${span.traceId}-${span.name}`;
function fromHeader(header) {
  const [traceId, parentName] = header.split("-");
  return { traceId, name: parentName };
}

function paymentService(header) {
  const span = startSpan("payment", fromHeader(header));
  work(PAYMENT_MS); // the slow part
  endSpan(span);
}

function orderService(header) {
  const span = startSpan("orders", fromHeader(header));
  work(ORDERS_BEFORE_MS);
  paymentService(toHeader(span)); // pass the context on
  work(ORDERS_AFTER_MS);
  endSpan(span);
}

function gateway() {
  const span = startSpan("gateway");
  work(GATEWAY_EACH_SIDE_MS);
  orderService(toHeader(span));
  work(GATEWAY_EACH_SIDE_MS);
  endSpan(span);
}

gateway();

// Print the trace as an indented tree with offsets and durations
const depth = (span) => (span.parentName ? 1 + depth(spans.find((s) => s.name === span.parentName)) : 0);
for (const span of spans) {
  console.log(`${"  ".repeat(depth(span))}${span.name}  start +${span.start} ms, took ${span.end - span.start} ms  [trace ${span.traceId}]`);
}
const total = spans[0].end - spans[0].start;
// Self time is a span's duration minus the time spent in its children: where the work really happened
const selfTime = (span) => span.end - span.start - spans.filter((s) => s.parentName === span.name).reduce((sum, s) => sum + s.end - s.start, 0);
const busiest = spans.reduce((a, b) => (selfTime(b) > selfTime(a) ? b : a));
console.log(`total ${total} ms; most self time: "${busiest.name}" (${selfTime(busiest)} ms)`);
