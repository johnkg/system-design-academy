# A virtual waiting room, in Python:
# signed queue tokens carry a place in line, a pointer admits a fixed number per tick, and the pointer is all the state that must survive a crash.
import hashlib
import hmac
import sys

SECRET = b'room-secret'


def mac(text):
    return hmac.new(SECRET, text.encode(), hashlib.sha256).hexdigest()[:12]


class WaitingRoom:
    def __init__(self, rate, saved=None):
        self.rate = rate                                   # people admitted per tick, set from what the backend can serve
        self.next = saved['next'] if saved else 0          # next place in line to hand out
        self.served = saved['served'] if saved else 0      # every place below this may enter
        self.tick = saved['tick'] if saved else 0
        self.early = []

    def save(self):
        return {'next': self.next, 'served': self.served, 'tick': self.tick}

    def token(self, seq):
        return f'{seq}.{mac("q" + str(seq))}'

    def join_early(self, id_):
        self.early.append(id_)

    # Before the sale opens, arrival time means nothing, so the pool is shuffled once (a lottery) and then numbered.
    def open(self, seed):
        s = seed
        for i in range(len(self.early) - 1, 0, -1):
            s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
            j = (s >> 16) % (i + 1)
            self.early[i], self.early[j] = self.early[j], self.early[i]
        return [(id_, self.join()) for id_ in self.early]

    def join(self):
        seq = self.next
        self.next += 1
        return self.token(seq)

    def seq_of(self, token):
        seq, _, tag = token.partition('.')
        return int(seq) if seq.isdigit() and tag == mac('q' + seq) else -1

    def status(self, token):
        seq = self.seq_of(token)
        if seq < 0:
            return 'invalid'
        if seq < self.served:
            return 'admitted'
        position = seq - self.served + 1
        return f'waiting, position {position}, about {-(-position // self.rate)} ticks'

    def advance(self):
        before = self.served
        self.tick += 1
        self.served = min(self.next, self.served + self.rate)
        return self.served - before

    def make_pass(self, seq):
        exp = self.tick + 5
        return f'{seq}.{exp}.{mac(f"p{seq}.{exp}")}'

    def pass_ok(self, pass_):
        seq, exp, tag = pass_.split('.')
        return tag == mac(f'p{seq}.{exp}') and int(seq) < self.served and self.tick <= int(exp)


def lower(flag):
    return 'true' if flag else 'false'


room = WaitingRoom(40)
for id_ in range(300):
    room.join_early(id_)
tokens = {}
lottery = room.open(7)
for id_, token in lottery:
    tokens[id_] = token
print(f"opened with {room.next} waiting; first five in the lottery: {', '.join(str(e[0]) for e in lottery[:5])}")
print(f'client 250: {room.status(tokens[250])}')

peak = 0
pass_ = None
crash_checked = False
for t in range(1, 21):
    for k in range(25):
        tokens[300 + (t - 1) * 25 + k] = room.join()
    peak = max(peak, room.advance())
    if t == 1:
        pass_ = room.make_pass(0)
    if t == 5:
        before = room.status(tokens[250])
        room = WaitingRoom(40, room.save())                # the whole process restarts, tokens in people's browsers stay valid
        crash_checked = before == room.status(tokens[250])
        print(f'after a restart at tick 5, client 250: {room.status(tokens[250])}')

seq, _, tag = tokens[250].partition('.')
forged_position = room.status(f'0.{tag}')
flipped_tag = room.status(f"{seq}.{tag[:-1]}{'1' if tag.endswith('0') else '0'}")
print(f'peak admitted in one tick: {peak} (limit 40)')
print(f"forged place 0 accepted: {lower(forged_position != 'invalid')}; altered tag accepted: {lower(flipped_tag != 'invalid')}")
print(f'old pass accepted at tick {room.tick}: {lower(room.pass_ok(pass_))}; fresh pass accepted: {lower(room.pass_ok(room.make_pass(100)))}')
everyone = all(room.status(tk) == 'admitted' for tk in tokens.values())
print(f'all {len(tokens)} admitted in order by tick {room.tick}: {lower(everyone)}')
if peak > 40 or not crash_checked or forged_position != 'invalid' or flipped_tag != 'invalid' or not everyone or room.pass_ok(pass_):
    sys.exit(1)
