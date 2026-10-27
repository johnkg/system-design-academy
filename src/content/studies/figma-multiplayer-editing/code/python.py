# A tiny model of the technique behind a server-authoritative editor, in Python. It is a teaching sketch, not Figma's code.
# 1. A document is a map of (object, property) to value. The server decides the order of changes, and the last change
#    to a property in that order wins. Different properties never conflict.
# 2. A client shows its own edit at once. While that edit is unacknowledged it ignores incoming changes to that property.
# 3. A child's parent and its position among its siblings are one property, and the server refuses a parent that makes a cycle.
# There is no randomness or clock, so every run prints the same thing.

server = {}  # "object.property" -> value, in the order the server accepted changes


class Client:
    def __init__(self, name):
        self.name = name
        self.view = {}
        self.pending = {}


clients = [Client("A"), Client("B")]
A, B = clients


def edit(client, key, value):
    client.view[key] = value  # the screen changes immediately
    client.pending[key] = client.pending.get(key, 0) + 1
    print(f"{client.name} edits {key} = {value}")
    return (client, key, value)


def receive(client, change):
    sender, key, value = change
    if sender is client:
        client.pending[key] -= 1  # an acknowledgement
    if client.pending.get(key, 0) > 0:
        print(f"  {client.name} skips {key} = {value}: it has its own unacknowledged edit there")
        return
    client.view[key] = value


# The server takes the changes in the order they reached it and tells everyone.
def serve(changes):
    for i, change in enumerate(changes, 1):
        sender, key, value = change
        server[key] = value
        print(f"server #{i}: {sender.name} sets {key} = {value}")
        for client in clients:
            receive(client, change)


print("-- properties")
red = edit(A, "box.fill", "red")
green = edit(A, "box.fill", "green")
blue = edit(B, "box.fill", "blue")
move = edit(A, "box.x", 10)
fade = edit(B, "box.opacity", 0.5)
serve([red, blue, move, green, fade])  # B's blue reached the server between A's two fills
for c in clients:
    print(f"{c.name} sees fill={c.view['box.fill']} x={c.view['box.x']} opacity={c.view['box.opacity']}")
print(f"server has fill={server['box.fill']} x={server['box.x']} opacity={server['box.opacity']}")

print("-- tree")
tree = {"frame": ("page", 0.25), "box": ("page", 0.75)}  # object -> (parent, position): the page's children


def children(parent):
    return [i for i, v in sorted(tree.items(), key=lambda kv: (kv[1][1], kv[0])) if v[0] == parent]


def between(low, high):  # a new position between two neighbours
    return (low + high) / 2


def set_parent(obj, parent, pos):
    up = parent
    while up != "page":
        if up == obj:
            print(f"server refuses {obj} under {parent}: that would make a cycle")
            return
        up = tree[up][0]
    tree[obj] = (parent, pos)  # parent and position change together, as one property
    print(f"{obj} under {parent} at {pos:.3f}")


set_parent("label", "page", between(0.25, 0.75))
print(f"page children: {', '.join(children('page'))}")
set_parent("box", "page", tree["frame"][1] / 2)
print(f"page children: {', '.join(children('page'))}")
set_parent("frame", "box", 0.5)  # one client puts frame inside box
set_parent("box", "frame", 0.5)  # at the same time another puts box inside frame
print(f"box children: {', '.join(children('box'))}; frame children: {', '.join(children('frame')) or 'none'}")
