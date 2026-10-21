# A minimal tracer in Python: spans, parent-child links and trace context propagation.
# A fake clock moved by hand makes the durations deterministic.

# Simulated work per service, in milliseconds.
PAYMENT_MS, ORDERS_BEFORE_MS, ORDERS_AFTER_MS, GATEWAY_EACH_SIDE_MS = 1800, 20, 30, 10
clock = 0  # milliseconds
spans = []


def start_span(name, parent=None):
    span = {
        "name": name,
        "trace_id": parent["trace_id"] if parent else "abc123",
        "parent_name": parent["name"] if parent else None,
        "start": clock,
        "end": 0,
    }
    spans.append(span)
    return span


def end_span(span):
    span["end"] = clock


def work(ms):  # pretend to do work
    global clock
    clock += ms


# The caller puts the trace context in a header, and the callee builds its span from it
def to_header(span):
    return f"{span['trace_id']}-{span['name']}"


def from_header(header):
    trace_id, parent_name = header.split("-")
    return {"trace_id": trace_id, "name": parent_name}


def payment_service(header):
    span = start_span("payment", from_header(header))
    work(PAYMENT_MS)  # the slow part
    end_span(span)


def order_service(header):
    span = start_span("orders", from_header(header))
    work(ORDERS_BEFORE_MS)
    payment_service(to_header(span))  # pass the context on
    work(ORDERS_AFTER_MS)
    end_span(span)


def gateway():
    span = start_span("gateway")
    work(GATEWAY_EACH_SIDE_MS)
    order_service(to_header(span))
    work(GATEWAY_EACH_SIDE_MS)
    end_span(span)


gateway()


# Print the trace as an indented tree with offsets and durations
def depth(span):
    if span["parent_name"]:
        return 1 + depth(next(s for s in spans if s["name"] == span["parent_name"]))
    return 0


for span in spans:
    print(f"{'  ' * depth(span)}{span['name']}  start +{span['start']} ms, took {span['end'] - span['start']} ms  [trace {span['trace_id']}]")
total = spans[0]["end"] - spans[0]["start"]


# Self time is a span's duration minus the time spent in its children: where the work really happened
def self_time(span):
    children = sum(s["end"] - s["start"] for s in spans if s["parent_name"] == span["name"])
    return span["end"] - span["start"] - children


busiest = spans[0]
for s in spans[1:]:
    if self_time(s) > self_time(busiest):
        busiest = s
print(f'total {total} ms; most self time: "{busiest["name"]}" ({self_time(busiest)} ms)')
