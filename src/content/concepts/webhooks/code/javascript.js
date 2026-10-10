// A webhook receiver in JavaScript: verify the signature, reject old timestamps, ignore duplicate events.
// A fixed secret and clock make the demo deterministic.
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = "whsec_demo";
const TOLERANCE_SECONDS = 300;

// The sender signs "timestamp.body" with the shared secret
const sign = (timestamp, body) => createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");

class WebhookReceiver {
  #handled = new Set();
  paidOrders = [];

  receive({ timestamp, signature, body }, now) {
    const expected = Buffer.from(sign(timestamp, body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "400 bad signature";
    if (now - timestamp > TOLERANCE_SECONDS) return "400 timestamp too old (possible replay)";

    const event = JSON.parse(body);
    if (this.#handled.has(event.id)) return "200 duplicate ignored"; // acknowledge, but do nothing
    this.#handled.add(event.id);
    this.paidOrders.push(event.order); // in real life: enqueue and reply right away
    return "200 processed";
  }
}

const body = '{"id":"evt_9","type":"payment.succeeded","order":"order-42"}';
const request = { timestamp: 1000, signature: sign(1000, body), body };
const receiver = new WebhookReceiver();

console.log(`genuine event:      ${receiver.receive(request, 1010)}`);
console.log(`same event again:   ${receiver.receive(request, 1020)}`);
console.log(`forged body:        ${receiver.receive({ ...request, body: body.replace("order-42", "order-99") }, 1030)}`);
console.log(`replayed too late:  ${receiver.receive(request, 2000)}`);
console.log(`orders marked paid: [${receiver.paidOrders}]`);
