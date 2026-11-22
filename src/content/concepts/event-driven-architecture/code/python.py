# Event-driven architecture: one "place an order" flow built four ways, with the same order data, the same outage and the same change.
# Look for: messages per order, hops until the customer gets an answer vs until the order is done, who the publisher can name, and orders lost or delayed in an outage.
# A message is (from, to, label, carries_order). A hop is one message that causally follows another (it leaves a service that just received one).
# Assumptions: every hop costs 5 ms; Payments handles 3 orders per tick when it is up; 10 ticks of arrivals; the workflow gives up on an order after 2 ticks of waiting; direct calls and the workflow answer the customer only when the flow is done (an asynchronous workflow could answer at once, like the event designs).
HOP_MS, CAPACITY, ARRIVAL_TICKS, OUTAGE_START, PATIENCE = 5, 3, 10, 3, 2


def direct():  # the order service calls each service in turn and waits for each reply
    m = []
    for s in ["Payments", "Inventory", "Shipping", "Notify", "Analytics"]:
        m.append(("Orders", s, "call", True))
        m.append((s, "Orders", "reply", False))
    return m


def orchestrated():  # one workflow service sends the commands and waits for the replies
    m = [("Orders", "Workflow", "start", True)]
    for s in ["Payments", "Inventory", "Shipping", "Notify", "Analytics"]:
        m.append(("Workflow", s, "command", True))
        m.append((s, "Workflow", "reply", False))
    m.append(("Workflow", "Orders", "done", False))
    return m


def choreography():  # each service publishes what happened, and others react
    return [
        ("Orders", "Payments", "OrderPlaced", True), ("Orders", "Analytics", "OrderPlaced", True), ("Orders", "Notify", "OrderPlaced", True),
        ("Payments", "Inventory", "PaymentTaken", True), ("Payments", "Analytics", "PaymentTaken", True),
        ("Inventory", "Shipping", "StockReserved", True),
        ("Shipping", "Notify", "Shipped", True), ("Shipping", "Analytics", "Shipped", True),
    ]


def everything_an_event():  # every step announces that it started and finished, and an audit service listens to all
    m = []
    for s in ["Payments", "Analytics", "Audit", "Notify"]:
        m.append(("Orders", s, "OrderPlaced", True))
    chain = ["Payments", "Inventory", "Shipping", "Notify"]
    for i, s in enumerate(chain):
        for w in ["Analytics", "Audit"]:
            m.append((s, w, "Started", False))
        nxt = [chain[i + 1]] if i + 1 < len(chain) else []
        for w in nxt + ["Analytics", "Audit"]:
            m.append((s, w, "Done", True))
    return m


# (name, messages, waits for the end, publisher names its consumers, driver, places that define the flow, fraud edits, fraud review, outage mode)
DESIGNS = [
    ("Direct calls", direct(), True, True, "Orders", ["Orders"], ["Orders"], [], "fail"),
    ("Orchestrated commands", orchestrated(), True, True, "Workflow", ["Workflow"], ["Workflow"], [], "patient"),
    ("Choreographed events", choreography(), False, False, "Orders", ["Orders", "Payments", "Inventory", "Shipping", "Notify", "Analytics"], ["Payments"], ["Analytics", "Notify"], "queue"),
    ("Everything an event", everything_an_event(), False, False, "Orders", ["Orders", "Payments", "Inventory", "Shipping", "Notify", "Analytics", "Audit"], ["Payments"], ["Analytics", "Audit", "Notify"], "queue"),
]


def depth(msgs):  # longest causal chain: a message follows an earlier one that arrived at its sender
    d = []
    for j, m in enumerate(msgs):
        d.append(1)
        for i in range(j):
            if msgs[i][1] == m[0]:
                d[j] = max(d[j], d[i] + 1)
    return max(d)


def outage(mode, rate, down):  # orders arrive for ARRIVAL_TICKS ticks; Payments is down for `down` ticks from OUTAGE_START
    def is_down(t):
        return OUTAGE_START <= t < OUTAGE_START + down

    queue = []
    failed = done = high = last = max_wait = 0
    for t in range(40):
        arrivals = rate if t < ARRIVAL_TICKS else 0
        for _ in range(arrivals):
            if mode == "fail" and is_down(t):
                failed += 1
            elif mode == "fail":
                done += 1
                last = max(last, t)
            else:
                queue.append(t)
        if mode == "patient":
            keep = [a for a in queue if t - a <= PATIENCE]
            failed += len(queue) - len(keep)
            queue = keep
        if mode != "fail" and not is_down(t):
            n = min(CAPACITY, len(queue))
            for a in queue[:n]:
                done += 1
                max_wait = max(max_wait, t - a)
                last = max(last, t)
            queue = queue[n:]
        high = max(high, len(queue))
    return failed, done, high, max_wait, last


for name, msgs, waits, names, driver, flow, fraud_edit, fraud_review, mode in DESIGNS:
    hops = depth(msgs)
    resp = hops if waits else 1
    carriers = set()
    for m in msgs:
        if m[3]:
            carriers.add(m[0])
            carriers.add(m[1])
    named = len({m[1] for m in msgs if m[3] and m[0] == driver}) if names else 0
    print(f"== {name}: messages per order {len(msgs)}; hops until the customer is answered {resp} ({resp * HOP_MS} ms); hops until the order is done {hops} ({hops * HOP_MS} ms)")
    print(f"  places that define the flow {len(flow)}; services edited to add a field to the order {len(carriers)}; consumers the publisher's own code names {named}")
    print(f"  add a fraud check: files edited {len(fraud_edit)}, new files 1, subscribers to review {len(fraud_review)}")
    for rate, down in [(2, 4), (3, 8)]:
        failed, done, high, wait, last = outage(mode, rate, down)
        print(f"  Payments down {down} ticks at {rate} orders per tick: failed {failed}, done {done}, queue high-water {high}, longest wait {wait} ticks, last done at tick {last}")
