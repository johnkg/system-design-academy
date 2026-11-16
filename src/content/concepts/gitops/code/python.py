# GitOps reconciler: Git holds the desired state, a controller in the cluster pulls it and makes the live state match.
# A 15-minute window of one app, second by second. Everything is integers and fixed events, so the output never changes.
END = 900          # seconds simulated
POLL = 180         # how often the controller looks at Git (3 minutes is a common default)
REACT = 5          # a webhook, or a change the controller sees in the cluster, is acted on this many seconds later
ALERT_AFTER = 60   # a broken version is noticed, and reverted in Git, this long after it goes live
HAND_EDIT_AT = 200 # someone runs "kubectl scale --replicas=10" by hand
# Commits to Git: deploy v2, deploy v3 (which is broken), delete the old cleanup job.
COMMITS = [{"at": 20, "image": "v2"}, {"at": 430, "image": "v3"}, {"at": 640, "remove_job": True}]


def run(name, webhook, self_heal, prune):
    git = {"image": "v1", "replicas": 3, "job": True}
    live = dict(git)
    applied = dict(git)  # what the controller last applied from Git
    todo = []            # (time, reason) of syncs waiting to run
    log = []
    s = {"hand_at": -1, "hand_lasted": -1, "v2_live": -1, "v3_live": -1, "bad_for": -1, "revert_at": -1}

    def sync(t, why):
        git_changed = git["image"] != applied["image"] or git["job"] != applied["job"]
        drifted = live["replicas"] != git["replicas"]
        if not git_changed and not (drifted and why == "self-heal"):
            return
        # A sync applies every manifest in Git, so it also undoes hand edits. Deleting what Git no longer lists needs prune.
        if drifted and s["hand_lasted"] < 0:
            s["hand_lasted"] = t - s["hand_at"]
            log.append(f"{t}s {why}: replicas 10 -> 3 (the hand edit is gone)")
        if live["image"] != git["image"]:
            log.append(f"{t}s {why}: image {live['image']} -> {git['image']}")
        live["image"] = git["image"]
        live["replicas"] = git["replicas"]
        if live["job"] and not git["job"] and prune:
            live["job"] = False
            log.append(f"{t}s {why}: cleanup job deleted")
        applied.update(git)
        if live["image"] == "v2" and s["v2_live"] < 0:
            s["v2_live"] = t
        if live["image"] == "v3" and s["v3_live"] < 0:
            s["v3_live"] = t
        if s["v3_live"] >= 0 and s["bad_for"] < 0 and live["image"] != "v3":
            s["bad_for"] = t - s["v3_live"]

    def commit(t, c):
        if c.get("image"):
            git["image"] = c["image"]
        if c.get("remove_job"):
            git["job"] = False
        what = "revert to image v2" if c.get("revert") else (f"image {c['image']}" if c.get("image") else "delete the cleanup job")
        log.append(f"{t}s commit: {what}")
        if webhook:
            todo.append((t + REACT, "webhook"))

    out_of_sync = 0
    for t in range(1, END + 1):
        for c in COMMITS:
            if c["at"] == t:
                commit(t, c)
        if s["v3_live"] >= 0 and s["revert_at"] < 0 and t == s["v3_live"] + ALERT_AFTER:
            s["revert_at"] = t
            commit(t, {"image": "v2", "revert": True})
        if t == HAND_EDIT_AT:
            live["replicas"] = 10
            s["hand_at"] = t
            log.append(f"{t}s hand edit: replicas 3 -> 10")
            if self_heal:
                todo.append((t + REACT, "self-heal"))  # the controller watches the cluster and sees the change
        for at, why in list(todo):
            if at == t:
                sync(t, why)
        if t % POLL == 0:
            sync(t, "poll")
        if live["image"] != git["image"] or live["replicas"] != git["replicas"] or live["job"] != git["job"]:
            out_of_sync += 1

    print(f"-- {name}")
    for line in log:
        print(f"  {line}")
    print(f"  v2 live {s['v2_live'] - COMMITS[0]['at']}s after its commit; broken v3 served for {s['bad_for']}s")
    hand = "never undone" if s["hand_lasted"] < 0 else f"lasted {s['hand_lasted']}s"
    job = "still running, an orphan" if live["job"] else "deleted"
    print(f"  hand edit {hand}; cleanup job {job}; out of sync {out_of_sync}s of {END}")
    if out_of_sync > END or s["bad_for"] <= 0:
        raise RuntimeError("impossible result")


run("poll every 3 min, no self-heal, no prune", webhook=False, self_heal=False, prune=False)
run("poll every 3 min, self-heal, prune", webhook=False, self_heal=True, prune=True)
run("webhook on push, self-heal, prune", webhook=True, self_heal=True, prune=True)
