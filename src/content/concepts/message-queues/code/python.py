"""A message queue in Python: publish, receive, ack, retry, and a dead-letter queue."""
from dataclasses import dataclass

MAX_ATTEMPTS = 3  # deliveries before a message goes to the dead-letter queue


@dataclass
class Message:
    id: int
    body: str
    attempts: int = 0


class MessageQueue:
    def __init__(self, max_attempts=MAX_ATTEMPTS):
        self.max_attempts = max_attempts
        self._ready = []
        self._in_flight = {}
        self._next_id = 1
        self.dead_letters = []

    def publish(self, body):
        self._ready.append(Message(self._next_id, body))
        self._next_id += 1

    def receive(self):  # hand a message to a worker; it stays "in flight" until acked or nacked
        if not self._ready:
            return None
        message = self._ready.pop(0)
        message.attempts += 1
        self._in_flight[message.id] = message
        return message

    def ack(self, message_id):  # done: delete it for good
        self._in_flight.pop(message_id, None)

    def nack(self, message_id):  # failed: try again later, or give up after too many attempts
        message = self._in_flight.pop(message_id)
        if message.attempts >= self.max_attempts:
            self.dead_letters.append(message)
        else:
            self._ready.append(message)


def run_worker(queue, handle):
    while (message := queue.receive()) is not None:
        try:
            handle(message.body)
            queue.ack(message.id)
            print(f"ok     {message.body}")
        except Exception as error:
            print(f"failed {message.body} (attempt {message.attempts}): {error}")
            queue.nack(message.id)


def handle(body):
    if "BAD" in body:
        raise ValueError("malformed address")


queue = MessageQueue(MAX_ATTEMPTS)
for m in ["email:ada", "email:BAD", "email:cy"]:
    queue.publish(m)  # the producer never waits

run_worker(queue, handle)
print(f"dead letters: [{', '.join(m.body for m in queue.dead_letters)}]")
