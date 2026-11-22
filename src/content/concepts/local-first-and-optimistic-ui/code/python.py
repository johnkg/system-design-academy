# Three ways a to-do app can handle 20 user actions: wait for the server, update optimistically, or work local-first.
# Fixed seed and integer maths only, so the output never changes.
ACTIONS = 20
UI_MS = 16                # time to redraw the screen from local state
OFFLINE_NOTICE_MS = 3000  # a request that cannot reach the server is given up on after this long
SEED = 2024


# Park-Miller generator: the same integers in every language.
def make_rng(seed):
    state = [seed]

    def nxt():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return nxt


# Each action gets a latency jitter (0 to 30 percent) and a roll (0 to 99): the server fails it when roll < failure rate.
def plan():
    nxt = make_rng(SEED)
    actions = []
    for _ in range(ACTIONS):
        jitter = nxt() % 31
        roll = nxt() % 100
        actions.append((jitter, roll))
    return actions


# offline_after: the connection drops after this many actions, and the app is closed while still offline.
def run(mode, latency_ms, fail_pct, offline_after):
    shown_total = rolled_back = lost = failed = saved = queued = 0
    for i, (jitter, roll) in enumerate(plan()):
        online = i < offline_after
        lat = latency_ms * (100 + jitter) // 100
        fails = online and roll < fail_pct
        if fails:
            failed += 1
        if mode == "wait":
            shown_total += lat if online else OFFLINE_NOTICE_MS  # the screen changes only when the server answers
            if online and not fails:
                saved += 1
            if not online:
                lost += 1                                        # typed, never sent, gone when the app closes
        elif mode == "optimistic":
            shown_total += UI_MS                                 # the screen changes at once
            if fails:
                rolled_back += 1                                 # ...and is wrong until the failure arrives
            if online and not fails:
                saved += 1
            if not online:
                lost += 1                                        # the user saw it applied, the pending request dies with the app
        else:
            shown_total += UI_MS                                 # written to the local database, screen redrawn
            if online:
                saved += 1                                       # failed requests stay in the queue and are retried
            else:
                queued += 1                                      # still in the persisted queue when the app closes
    avg = shown_total // ACTIONS
    print(f"{mode.ljust(10)} screen changes after {avg} ms on average; rolled back {rolled_back}; failed requests {failed}; on the server {saved}; lost on close {lost}; kept in queue {queued}")


for latency, fail in [(400, 15), (1200, 30)]:
    print(f"-- latency {latency} ms, server failures {fail}%, connection drops after action 14")
    for mode in ["wait", "optimistic", "local"]:
        run(mode, latency, fail, 14)
