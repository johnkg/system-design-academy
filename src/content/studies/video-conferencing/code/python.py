# An SFU choosing simulcast layers, in Python:
# every sender uploads a few layers of its video once, and the server forwards to each viewer the best layer that fits that viewer's downlink.
# Compared with a mesh, where every sender uploads a full copy to every other participant.
import sys

LAYERS = [150, 500, 1500]  # kbit/s of the low, medium and high layer
N = 6

SEED = 7
LINK_STEP, UP_STEPS, DOWN_STEPS = 1000, 6, 9  # links are whole Mbit/s: upload 1..6, download 1..9
seed = SEED


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


people = []
for pid in range(N):
    up = LINK_STEP + random(UP_STEPS) * LINK_STEP # kbit/s, drawn in this order
    down = LINK_STEP + random(DOWN_STEPS) * LINK_STEP
    people.append({'id': pid, 'up': up, 'down': down})


# A sender uploads layers from the lowest upwards for as long as they fit in its uplink.
def published(p):
    sent, used = [], 0
    for layer in LAYERS:
        if used + layer <= p['up']:
            sent.append(layer)
            used += layer
    return sent


sent = [published(p) for p in people]


# A viewer splits its downlink evenly over the other participants and takes the best layer that fits its share.
def choose(viewer):
    share = viewer['down'] // (N - 1)
    got = []
    for p in people:
        if p['id'] == viewer['id']:
            continue
        pick = sent[p['id']][0]
        for layer in sent[p['id']]:
            if layer <= share:
                pick = layer
        got.append(pick)
    return got


def join(values, sep):
    return sep.join(str(v) for v in values)


egress = ingress = 0
for p in people:
    got = choose(p)
    total = sum(got)
    egress += total
    ingress += sum(sent[p['id']])
    print(f"client {p['id']}: up {p['up']} down {p['down']} | sends {join(sent[p['id']], '+')} = {sum(sent[p['id']])} | gets {join(got, ',')} = {total}")
    if sum(sent[p['id']]) > p['up'] or total > p['down']:  # nobody may be asked for more than its link can carry
        sys.exit(1)

mesh_up = (N - 1) * LAYERS[2]
mesh_over = len([p for p in people if p['up'] < mesh_up])
print(f"server: in {ingress}, out {egress} kbit/s")
print(f"mesh would need {mesh_up} up from each client: {mesh_over} of {N} clients cannot send it")
if mesh_over == 0 or egress <= ingress:
    sys.exit(1)
