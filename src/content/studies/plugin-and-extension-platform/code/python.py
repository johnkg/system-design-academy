# A host application that calls third-party plugins while it serves requests, with and without isolation. Time moves in
# ticks of 100 ms for 300 seconds. 20 requests arrive each second, and each one is handled by the host and then by one
# of 5 plugins in turn. At 60 s an update makes plugin 3 misbehave. Everything is integers and nothing is random, so
# the output never changes. Plugin calls run either inside the host's own workers or in a sandbox per plugin.
TICKS, ARRIVE_UNTIL, ARRIVE = 3000, 2900, 2   # 2 requests a tick = 20 a second; the last 10 s is for finishing
WORKERS = 40            # host workers, shared by everything in the host process
HOST = 2                # ticks of the host's own work on each request
PLUGINS, BAD, BAD_AT = 5, 3, 600  # plugin 3 misbehaves from tick 600
NORMAL, SLOW, SLOW_EVERY = 3, 15, 25  # a plugin call takes 300 ms, and every 25th one (a big document) takes 1,500 ms
POOL = 4                # sandbox: calls to one plugin that may run at once (its resource limit)
BREAK_AFTER, BREAK_FOR = 5, 600  # sandbox: 5 failures in a row switch a plugin off for 60 s
RESTART = 300           # in-process: a crash takes the whole host down for 30 s
SNOOP = 50              # records a snooping plugin reads outside its grant on every call
PATIENCE = 100          # a user gives up after waiting 10 s in the queue
HANG, CRASH = 1000000, -1


def run(name, sandbox=False, bad="none", timeout=20):
    st = {"next_id": 0, "down_until": 0, "restarts": 0, "leaked": 0, "denied": 0, "bad_failed": 0,
          "served": 0, "fast": 0, "healthy_total": 0, "healthy_failed": 0}
    queue, running = [], []
    calls, used, streak, off_until = [0] * PLUGINS, [0] * PLUGINS, [0] * PLUGINS, [0] * PLUGINS
    latency = {}  # ticks from arrival to answer -> requests

    def finish(r, t, plugin_ok, dropped):
        """One request is finished: answered (maybe without its plugin) or dropped."""
        if r["plugin"] != BAD:
            st["healthy_total"] += 1
            if dropped or not plugin_ok:
                st["healthy_failed"] += 1
        if dropped:
            return
        st["served"] += 1
        d = t - r["arrived"]
        latency[d] = latency.get(d, 0) + 1
        if d <= 10:
            st["fast"] += 1

    def call_ticks(plugin, t):
        """How long this call takes: the update at BAD_AT makes plugin 3 hang, crash or snoop."""
        n = calls[plugin]
        calls[plugin] += 1
        if plugin == BAD and bad != "none" and t >= BAD_AT:
            if bad == "hang":
                return HANG
            if bad == "crash":
                return CRASH
            st["denied" if sandbox else "leaked"] += SNOOP  # snoop: works normally, and reads what it should not
            return NORMAL
        return SLOW if n % SLOW_EVERY == SLOW_EVERY - 1 else NORMAL

    def failed(plugin, t):
        if plugin == BAD:
            st["bad_failed"] += 1
        streak[plugin] += 1
        if streak[plugin] >= BREAK_AFTER:
            off_until[plugin] = t + BREAK_FOR

    for t in range(TICKS):
        arrivals = ARRIVE if t < ARRIVE_UNTIL else 0
        if not sandbox and t < st["down_until"]:  # the host is restarting: nobody is served
            for _ in range(arrivals):
                finish({"plugin": st["next_id"] % PLUGINS, "arrived": t}, t, False, True)
                st["next_id"] += 1
            continue
        due = [x for x in running if x["end"] == t]
        running = [x for x in running if x["end"] != t]
        for x in due:
            p = x["r"]["plugin"]
            if not sandbox:
                finish(x["r"], t, x["ok"], False)
            elif x["stage"] == "plugin":  # the sandboxed call is over
                used[p] -= 1
                if x["ok"]:
                    streak[p] = 0
                else:
                    failed(p, t)
                finish(x["r"], t, x["ok"], False)
            elif t < off_until[p] or used[p] >= POOL:  # switched off or at its limit: the host goes on without it
                if p == BAD:
                    st["bad_failed"] += 1
                finish(x["r"], t, False, False)
            else:
                d = call_ticks(p, t)
                if d == CRASH:  # only the sandbox dies, and restarts
                    failed(p, t)
                    finish(x["r"], t, False, False)
                else:
                    used[p] += 1
                    running.append({"r": x["r"], "end": t + min(d, timeout), "stage": "plugin", "ok": d <= timeout})
        for _ in range(arrivals):
            queue.append({"plugin": st["next_id"] % PLUGINS, "arrived": t})
            st["next_id"] += 1
        while queue and t - queue[0]["arrived"] > PATIENCE:
            finish(queue.pop(0), t, False, True)
        busy = len([x for x in running if x.get("stage") != "plugin"])
        while queue and busy < WORKERS:
            r = queue.pop(0)
            busy += 1
            if sandbox:
                running.append({"r": r, "end": t + HOST, "stage": "host"})
                continue
            d = call_ticks(r["plugin"], t)
            if d == CRASH:  # the plugin brings the whole host process down, and everything in flight with it
                st["restarts"] += 1
                st["down_until"] = t + RESTART
                finish(r, t, False, True)
                for x in running:
                    finish(x["r"], t, False, True)
                running = []
                for q in queue:
                    finish(q, t, False, True)
                queue = []
                break
            if r["plugin"] == BAD and d > timeout:
                st["bad_failed"] += 1
            running.append({"r": r, "end": t + HOST + min(d, timeout), "ok": d <= timeout})
    for r in queue:  # never reached by the end
        finish(r, TICKS, False, True)
    for x in running:
        finish(x["r"], TICKS, False, True)

    total = ARRIVE_UNTIL * ARRIVE
    seen, p95 = 0, 0
    for d in sorted(latency):
        seen += latency[d]
        if seen * 100 >= st["served"] * 95:
            p95 = d * 100
            break
    print(f"-- {name}")
    print(f"  requests served {st['served'] * 100 // total}%, answered within 1 s {st['fast'] * 100 // total}%, p95 latency {p95} ms")
    print(f"  requests for the 4 healthy plugins: {st['healthy_failed']} of {st['healthy_total']} dropped or without their plugin; the misbehaving plugin: {st['bad_failed']} calls failed or refused")
    print(f"  host restarts {st['restarts']}; records read outside the grant {st['leaked']}, blocked {st['denied']}")
    if st["served"] > total:
        raise RuntimeError("more answers than requests")


run("in the host process, all plugins healthy, 2 s timeout")
run("in the host process, plugin hangs, 2 s timeout", bad="hang")
run("in the host process, plugin hangs, 60 s timeout", bad="hang", timeout=600)
run("in the host process, plugin crashes", bad="crash")
run("in the host process, plugin snoops", bad="snoop")
run("sandbox per plugin, plugin hangs, 60 s timeout", sandbox=True, bad="hang", timeout=600)
run("sandbox per plugin, plugin crashes", sandbox=True, bad="crash")
run("sandbox per plugin, plugin snoops", sandbox=True, bad="snoop")
run("sandbox per plugin, all healthy, 1 s timeout", sandbox=True, timeout=10)
