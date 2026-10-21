# A presence service in Python:
# each device session is a key that expires unless it is renewed by a heartbeat, a user is online while any session lives,
# and friends are told only when the user's status changes, not on every heartbeat.
import sys

TTL = 30  # seconds a session survives without a heartbeat (three heartbeat intervals)
DEVICE_SLOTS = 8  # session key = user * DEVICE_SLOTS + device
HEARTBEAT_S = 10  # each device beats every 10 s, at its own phase
FRIENDS = 6
MAX_DEVICES = 3
DIE_ONE_IN = 3  # one device in 3 dies at 30..249 s
DIE_FROM = 30
DIE_SPREAD = 220
TICKS = 300
LOSS_ONE_IN = 5


class Presence:
    def __init__(self, friends_of):
        self.friends_of = friends_of  # user -> the users who must hear about this user
        self.expiry = {}              # session key -> time at which it expires
        self.live = {}                # user -> number of live sessions
        self.events = []              # status changes: (user, online)
        self.fanout = 0               # messages sent to friends

    def change(self, user, online):
        self.events.append((user, online))
        self.fanout += len(self.friends_of[user])

    def heartbeat(self, user, device, now):
        key = user * DEVICE_SLOTS + device
        is_new = key not in self.expiry
        self.expiry[key] = now + TTL  # renewing is one cheap write
        if not is_new:
            return
        self.live[user] = self.live.get(user, 0) + 1
        if self.live[user] == 1:
            self.change(user, True)  # the first session brings the user online

    def disconnect(self, user, device):  # a clean goodbye, or an expiry
        if self.expiry.pop(user * DEVICE_SLOTS + device, None) is None:
            return
        self.live[user] -= 1
        if self.live[user] == 0:
            self.change(user, False)  # the last session takes the user offline

    def sweep(self, now):  # in a real store the TTL does this for us
        for key, at in list(self.expiry.items()):
            if at <= now:
                self.disconnect(key // DEVICE_SLOTS, key % DEVICE_SLOTS)

    def is_online(self, user):
        return self.live.get(user, 0) > 0


seed = 77


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


USERS = 100
friends_of, devices = [], []
for u in range(USERS):
    friends = []
    while len(friends) < FRIENDS:
        f = random(USERS)
        if f != u and f not in friends:
            friends.append(f)
    friends_of.append(friends)
    for d in range(1 + random(MAX_DEVICES)):
        phase = random(HEARTBEAT_S)
        dies = random(DIE_ONE_IN) == 0
        dead = DIE_FROM + random(DIE_SPREAD) if dies else -1
        devices.append({'u': u, 'd': d, 'phase': phase, 'dead': dead, 'graceful': random(2) == 1})

presence = Presence(friends_of)
heartbeats = 0
for t in range(TICKS):
    for x in devices:
        if x['dead'] >= 0 and t == x['dead'] and x['graceful']:
            presence.disconnect(x['u'], x['d'])  # others just go silent
        alive = x['dead'] < 0 or t < x['dead']
        if alive and (t + x['phase']) % HEARTBEAT_S == 0 and random(LOSS_ONE_IN) != 0:  # one heartbeat in five is lost
            presence.heartbeat(x['u'], x['d'], t)
            heartbeats += 1
    presence.sweep(t)

online = sum(1 for _, on in presence.events if on)
print(f"heartbeats: {heartbeats}, fan-out if each one were broadcast: {heartbeats * 6}")
print(f"status changes: {len(presence.events)} (online {online}, offline {len(presence.events) - online}), fan-out: {presence.fanout}")
print(f"messages saved: {heartbeats * 6 // presence.fanout}x")

still_there = {x['u'] for x in devices if x['dead'] < 0}
right, count = True, 0
for u in range(USERS):
    count += presence.is_online(u)
    if presence.is_online(u) != (u in still_there):
        right = False
last, alternate = {}, True
for u, on in presence.events:
    if last.get(u, False) == on:
        alternate = False
    last[u] = on
print(f"online at the end: {count} of {USERS}; matches the devices still running: {str(right).lower()}")
print(f"each user's changes alternate online and offline: {str(alternate).lower()}")
sys.exit(0 if right and alternate else 1)
