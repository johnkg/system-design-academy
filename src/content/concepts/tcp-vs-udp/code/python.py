"""Reliable delivery over a lossy network, tick by tick, in Python:
numbered segments, cumulative acknowledgements, in-order delivery and retransmission.
This is a teaching model of what TCP does, not real networking code."""

TOTAL = 5      # segments 0 to 4
LATENCY = 1    # ticks for a packet to cross the network
TIMEOUT = 4    # ticks before the sender resends an unacknowledged segment
LAST_TICK = 11  # the simulation runs ticks 0 to 11
lost_first_time = {2}  # the network drops segment 2 the first time it is sent

in_flight = []  # packets travelling: {"arrive_at", "kind", "n"}
sent_at = [None] * TOTAL
attempts = [0] * TOTAL
received = set()
next_to_deliver = 0  # receiver: the next segment the application is waiting for
acked = 0            # sender: everything below this has been acknowledged


def transmit(tick, segment):
    sent_at[segment] = tick
    attempts[segment] += 1
    label = "resends" if attempts[segment] > 1 else "sends"
    if attempts[segment] == 1 and segment in lost_first_time:
        print(f"tick {tick}: sender {label} segment {segment} -> LOST in the network")
    else:
        print(f"tick {tick}: sender {label} segment {segment}")
        in_flight.append({"arrive_at": tick + LATENCY, "kind": "data", "n": segment})


for tick in range(LAST_TICK + 1):
    # Packets that arrive on this tick
    for packet in [p for p in in_flight if p["arrive_at"] == tick]:
        if packet["kind"] == "data":
            received.add(packet["n"])
            delivered = []
            while next_to_deliver in received:
                delivered.append(next_to_deliver)
                next_to_deliver += 1
            print(f"tick {tick}: receiver gets {packet['n']}, delivers [{','.join(map(str, delivered))}] to the application")
            in_flight.append({"arrive_at": tick + LATENCY, "kind": "ack", "n": next_to_deliver})  # "I have everything below n"
        else:
            acked = max(acked, packet["n"])

    # The sender sends one new segment per tick, and resends the oldest unacknowledged one after a timeout
    if tick < TOTAL:
        transmit(tick, tick)
    elif acked < TOTAL and sent_at[acked] is not None and tick - sent_at[acked] >= TIMEOUT:
        transmit(tick, acked)

print(f"delivered in order: {next_to_deliver} of {TOTAL} segments")
print("UDP would have delivered [0,1,3,4] immediately and never delivered 2")
