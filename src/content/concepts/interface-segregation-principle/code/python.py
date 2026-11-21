# Interface Segregation Principle: a device family (print, scan, fax) with five clients, built with three kinds of interface.
# Then three changes arrive: a new method (staple), a new device type (LabelPrinter) and a changed signature (print).
# Look for: stub methods devices are forced to write, existing clients hit by each change, and how many interfaces exist.
ROLE_OF = {"print": "Printing", "setPaper": "Printing", "scan": "Scanning", "scanToEmail": "Scanning", "fax": "Faxing",
           "faxStatus": "Faxing", "status": "Admin", "reset": "Admin", "staple": "Finishing"}
CLIENTS = [  # what each client calls
    ("PrintDialog", ["print", "setPaper"]),
    ("ScanToEmail", ["scan", "scanToEmail"]),
    ("FaxDesk", ["fax", "faxStatus"]),
    ("CopyShortcut", ["scan", "print"]),
    ("HealthMonitor", ["status", "reset"]),
]
START_METHODS = ["print", "setPaper", "scan", "scanToEmail", "fax", "faxStatus", "status", "reset"]
START_DEVICES = [  # what each device can really do
    ("BasicPrinter", ["print", "setPaper", "status", "reset"]),
    ("OfficeMachine", ["print", "setPaper", "scan", "scanToEmail", "fax", "faxStatus", "status", "reset"]),
]


def interfaces(mode, methods):
    """An interface is (name, methods). Fat: one for everything. Roles: one per client need. Per method: one each."""
    if mode == "fat":
        return [("Device", list(methods))]
    if mode == "per-method":
        return [("I" + m[0].upper() + m[1:], [m]) for m in methods]
    out = []
    for m in methods:
        r = next((x for x in out if x[0] == ROLE_OF[m]), None)
        if r is None:
            r = (ROLE_OF[m], [])
            out.append(r)
        r[1].append(m)
    return out


def implementers(devices, iface):
    return [d for d in devices if any(m in iface[1] for m in d[1])]


def stubs_of(device, ifaces):
    """A device must implement every method of each interface it takes part in: the ones it cannot do become stubs."""
    return sum(len([m for m in i[1] if m not in device[1]]) for i in ifaces if any(m in device[1] for m in i[1]))


def total_stubs(devices, ifaces):
    return sum(stubs_of(d, ifaces) for d in devices)


def depends_on(client, iface):
    return any(m in iface[1] for m in client[1])


def noise(ifaces):
    """Methods a client can see through its interfaces but never calls."""
    return sum(sum(len([m for m in i[1] if m not in c[1]]) for i in ifaces if depends_on(c, i)) for c in CLIENTS)


def find(ifaces, name):
    return next((o for o in ifaces if o[0] == name), None)


for title, mode in [("One fat interface", "fat"), ("Role interfaces by client need", "role"), ("One method per interface", "per-method")]:
    methods = list(START_METHODS)
    devices = [(n, list(ms)) for n, ms in START_DEVICES]
    ifaces = interfaces(mode, methods)
    print(f"== {title}")
    print(f"  today: interfaces {len(ifaces)}; stub methods {total_stubs(devices, ifaces)}; unused methods visible to clients {noise(ifaces)}")

    # A: a new method, staple, that only the office machine can do.
    before_a, stubs_before_a = ifaces, total_stubs(devices, ifaces)
    methods = methods + ["staple"]
    devices[1][1].append("staple")
    ifaces = interfaces(mode, methods)
    changed = [i for i in ifaces if find(before_a, i[0]) is None or len(find(before_a, i[0])[1]) != len(i[1])]
    hit = [c for c in CLIENTS if any(find(before_a, i[0]) is not None and depends_on(c, find(before_a, i[0])) for i in changed)]
    touched = [d for d in devices if any(any(m in i[1] for m in d[1]) for i in changed)]
    print(f"  A add method staple: new stubs {total_stubs(devices, ifaces) - stubs_before_a}; existing clients affected {len(hit)}; devices edited {len(touched)}")

    # B: a new device type that can only print and report status.
    label = ("LabelPrinter", ["print", "status"])
    devices = devices + [label]
    print(f"  B new device LabelPrinter: new stubs {stubs_of(label, ifaces)}; existing clients affected 0; devices edited 1")

    # C: print() gets a new parameter.
    print_iface = next(i for i in ifaces if "print" in i[1])
    hit = [c for c in CLIENTS if depends_on(c, print_iface)]
    touched = implementers(devices, print_iface)
    print(f"  C change print(): new stubs 0; existing clients affected {len(hit)} ({', '.join(c[0] for c in hit)}); devices edited {len(touched)}")
    print(f"  after all three: interfaces {len(ifaces)}; stub methods {total_stubs(devices, ifaces)}; unused methods visible to clients {noise(ifaces)}")
