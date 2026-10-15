# A gateway session in Python: every message gets a per-user sequence number, a bounded queue protects the server
# from a slow client, and a short buffer lets a client that reconnects resume from the last number it saw.
import sys

BUFFER = 5  # messages kept for resume
QUEUE = 4   # messages waiting for one connection before it is cut off


class Session:
    def __init__(self):
        self.seq = 0
        self.buffer = []
        self.queue = []
        self.connected = True
        self.cut_offs = 0

    def send(self, text):
        self.seq += 1
        msg = (self.seq, text)
        self.buffer.append(msg)
        if len(self.buffer) > BUFFER:
            self.buffer.pop(0)                      # the oldest message falls out of the resume window
        if not self.connected:
            return                                  # nobody to write to: the buffer is all we keep
        if len(self.queue) >= QUEUE:                # slow consumer: close it
            self.connected = False
            self.queue = []
            self.cut_offs += 1
            return
        self.queue.append(msg)

    # The client says "my last sequence number was n". Replay what follows, or ask for a full refresh.
    def resume(self, last):
        self.connected = True
        self.queue = []
        if last >= self.seq:
            return ("replay", [])
        if self.buffer[0][0] > last + 1:            # the gap is older than the buffer
            return ("refresh", self.seq)
        return ("replay", [m for m in self.buffer if m[0] > last])


class Client:
    def __init__(self):
        self.last = 0
        self.applied = []

    def apply(self, msg):
        if msg[0] <= self.last:
            return                                  # a repeat is ignored
        self.last = msg[0]
        self.applied.append(msg[0])

    def read(self, session, n):
        for _ in range(n):
            if session.queue:
                self.apply(session.queue.pop(0))

    def reconnect(self, session):
        kind, payload = session.resume(self.last)
        if kind == "refresh":
            self.last = payload
            return f"refresh to {payload}"
        for m in payload:
            self.apply(m)
        return "replay [" + ",".join(str(m[0]) for m in payload) + "]"


s, c = Session(), Client()
for i in range(1, 7):
    s.send(f"m{i}")
    c.read(s, 1)
print(f"connected: client has seen up to {c.last}")

s.connected = False                                 # the phone enters a tunnel
for i in range(7, 10):
    s.send(f"m{i}")
print(f"resume from {c.last}: {c.reconnect(s)}")

s.connected = False                                 # a long outage: more messages than the buffer holds
for i in range(10, 18):
    s.send(f"m{i}")
print(f"resume from {c.last}: {c.reconnect(s)}")

for i in range(18, 24):                             # the client reads one, then stops reading
    s.send(f"m{i}")
    if i == 18:
        c.read(s, 1)
print(f"slow client cut off {s.cut_offs} time; queue limit {QUEUE}")
print(f"resume from {c.last}: {c.reconnect(s)}")
c.apply((23, "m23"))                                # the same message arrives a second time
ordered = all(i == 0 or x > c.applied[i - 1] for i, x in enumerate(c.applied))
print(f"applied {len(c.applied)} messages, last {c.last}, in order: {str(ordered).lower()}")
if c.last != s.seq or s.cut_offs != 1 or len(set(c.applied)) != len(c.applied):
    sys.exit(1)
