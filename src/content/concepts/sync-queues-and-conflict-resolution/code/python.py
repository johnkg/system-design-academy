# Two devices edit one shared record with 5 fields over 60 minutes. Device B is offline for a window and queues its edits
# (an outbox); at reconnect the queue is replayed and a policy settles the conflicts. Integers and fixed seeds only.
FIELDS = ["title", "notes", "due", "status", "priority"]
BASE = {"title": "Buy milk", "notes": "-", "due": "Fri", "status": "open", "priority": "low"}
OFFLINE_START = 15  # minute when device B loses its connection
DELETE_AT = 23      # minute when device A deletes the record, if the delete option is on
EDITS = 14
ACK_LOST_PCT = 25   # share of replayed mutations whose acknowledgement is lost, so the device sends them again


def make_rng(seed):
    state = [seed]

    def nxt():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return nxt


# One edit about every 4 minutes, by A or B, to one of the fields. The value says who wrote it and when.
def timeline():
    nxt = make_rng(97)
    edits = []
    for k in range(EDITS):
        t = k * 4 + (nxt() % 4)
        device = "A" if nxt() % 2 == 0 else "B"
        field = FIELDS[nxt() % len(FIELDS)]
        edits.append({"t": t, "device": device, "field": field, "value": f"{device}{t}"})
    return edits


# The last edit per field: earlier ones by the same device on the same field are overwritten by their own author.
def net(items):
    by_field = {}
    for e in items:
        by_field[e["field"]] = e
    return list(by_field.values())


# policy: 'lww' (whole record, newest clock wins), 'server' (replayed mutations apply in arrival order),
# 'merge' (per field; notes are joined; other fields newest clock wins), 'ask' (same-field conflicts go to the user).
# skew: minutes that device B's clock runs ahead of the truth (negative: behind).
def run(policy, offline_min, skew, delete_on):
    end = OFFLINE_START + offline_min
    delete_in_window = delete_on and DELETE_AT < end
    # The scenario ends when B reconnects. A cannot edit a record it has deleted.
    edits = [e for e in timeline() if e["t"] < end and not (delete_in_window and e["device"] == "A" and e["t"] >= DELETE_AT)]
    state = dict(BASE)
    c = {"deleted": False, "lost": 0, "merged": 0, "to_user": 0}
    for e in edits:
        if e["t"] < OFFLINE_START:
            state[e["field"]] = e["value"]
    before = dict(state)
    a_win = [e for e in edits if e["device"] == "A" and OFFLINE_START <= e["t"] < end]
    b_queue = [e for e in edits if e["device"] == "B" and OFFLINE_START <= e["t"] < end]  # the outbox
    a_net, b_net = net(a_win), net(b_queue)
    for e in a_net:
        state[e["field"]] = e["value"]  # A is online: the server has these already

    def b_ts(e):
        return e["t"] + skew  # what B's clock wrote on its edits

    both = len(a_net) > 0 and len(b_net) > 0
    a_only = [a for a in a_net if not any(b["field"] == a["field"] for b in b_net)]
    b_only = [b for b in b_net if not any(a["field"] == b["field"] for a in a_net)]
    same = [b for b in b_net if any(a["field"] == b["field"] for a in a_net)]

    def field_level():
        if both:
            c["merged"] += len(a_only) + len(b_only)
        for e in b_only:
            state[e["field"]] = e["value"]
        for b in same:
            a = next(x for x in a_net if x["field"] == b["field"])
            if policy == "server":
                state[b["field"]] = b["value"]  # B arrived last: B overwrites A
                c["lost"] += 1
            elif policy == "merge" and b["field"] == "notes":
                state[b["field"]] = f"{a['value']}+{b['value']}"
                c["merged"] += 1
            elif policy == "merge":
                if b_ts(b) > a["t"]:
                    state[b["field"]] = b["value"]  # newest clock keeps its value
                c["lost"] += 1
            else:
                c["to_user"] += 1  # ask: the user chooses, nothing is dropped

    if delete_in_window and len(b_net) > 0:
        # delete versus edit
        b_last = max(b_ts(e) for e in b_net)
        if policy == "lww":
            if DELETE_AT > b_last:
                c["deleted"] = True
                c["lost"] += len(b_net)  # the delete is newer: B's edits die with the record
            else:
                state.update(before)
                for e in b_net:
                    state[e["field"]] = e["value"]
                c["lost"] += len(a_net) + 1
        elif policy == "server":
            c["deleted"] = True
            c["lost"] += len(b_net)  # the tombstone arrived first
        else:
            field_level()  # keep the record: delete lost, or ask
            if policy == "merge":
                c["lost"] += 1
            else:
                c["to_user"] += 1
    else:
        if delete_in_window:
            c["deleted"] = True
        if not both:
            for e in b_net:
                state[e["field"]] = e["value"]
        elif policy == "lww":
            a_last = max(e["t"] for e in a_net)
            b_last = max(b_ts(e) for e in b_net)
            if b_last >= a_last:
                state.update(before)
                for e in b_net:
                    state[e["field"]] = e["value"]
                c["lost"] += len(a_net)
            else:
                c["lost"] += len(b_net)
        else:
            field_level()
    # The outbox: each mutation has an id. Some acknowledgements are lost, so the device sends them again.
    nxt = make_rng(17)
    size = dupes = 0
    for j, e in enumerate(b_queue):
        size += len(f"B-{j + 1}") + len(e["field"]) + len(e["value"]) + 24
        if nxt() % 100 < ACK_LOST_PCT:
            dupes += 1
    record = "DELETED" if c["deleted"] else " ".join(f"{f}={state[f]}" for f in FIELDS)
    print(f"{policy.ljust(6)} lost {c['lost']}, merged {c['merged']}, asked {c['to_user']}; outbox {len(b_queue)} mutations, {size} bytes; duplicate sends ignored {dupes}")
    print(f"       {record}")


for label, offline, skew, delete in [
    ("20 minutes offline, clocks agree", 20, 0, False),
    ("20 minutes offline, device B clock 8 minutes behind", 20, -8, False),
    ("20 minutes offline, A deletes the record", 20, 0, True),
    ("5 minutes offline, clocks agree", 5, 0, False),
]:
    print(f"-- {label}")
    for policy in ["lww", "server", "merge", "ask"]:
        run(policy, offline, skew, delete)
