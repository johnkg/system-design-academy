"""A webhook receiver in Python: verify the signature, reject old timestamps, ignore duplicate events.
A fixed secret and clock make the demo deterministic."""
import hashlib
import hmac
import json

SECRET = b"whsec_demo"
TOLERANCE_SECONDS = 300


# The sender signs "timestamp.body" with the shared secret
def sign(timestamp, body):
    return hmac.new(SECRET, f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()


class WebhookReceiver:
    def __init__(self):
        self._handled = set()
        self.paid_orders = []

    def receive(self, request, now):
        timestamp, signature, body = request["timestamp"], request["signature"], request["body"]
        if not hmac.compare_digest(sign(timestamp, body).encode(), signature.encode()):
            return "400 bad signature"
        if now - timestamp > TOLERANCE_SECONDS:
            return "400 timestamp too old (possible replay)"

        event = json.loads(body)
        if event["id"] in self._handled:
            return "200 duplicate ignored"  # acknowledge, but do nothing
        self._handled.add(event["id"])
        self.paid_orders.append(event["order"])  # in real life: enqueue and reply right away
        return "200 processed"


body = '{"id":"evt_9","type":"payment.succeeded","order":"order-42"}'
request = {"timestamp": 1000, "signature": sign(1000, body), "body": body}
receiver = WebhookReceiver()

print(f"genuine event:      {receiver.receive(request, 1010)}")
print(f"same event again:   {receiver.receive(request, 1020)}")
print(f"forged body:        {receiver.receive({**request, 'body': body.replace('order-42', 'order-99')}, 1030)}")
print(f"replayed too late:  {receiver.receive(request, 2000)}")
print(f"orders marked paid: [{','.join(receiver.paid_orders)}]")
