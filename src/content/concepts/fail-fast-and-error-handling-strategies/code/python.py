# Fail fast and error handling strategies. Part 1 parses the same five inputs with three error styles (an exception, a result value
# the caller must look at, and an error code the caller can forget). Part 2 runs a batch job over 100 records under five
# strategies: swallow and continue, fail fast, retry then fail fast, dead-letter and continue, and retry everything blindly.
# Some records are permanently bad (data errors), some fail a few times and then work (transient errors); in the last scenario
# each record builds on the one before, so continuing past a failure poisons what follows. Look for: the error
# code giving a wrong sum without a sound, which strategies leave wrong data behind, and how much work blind retry wastes.
INPUTS = ["12", "7", "x9", "", "40"]


class ParseError(Exception):
    pass


def parse_exc(text):  # style 1: raise
    if not text.isdigit():
        raise ParseError(f"bad number '{text}'")
    return int(text)


def parse_result(text):  # style 2: return (ok, value or message); the caller has to open it
    if not text.isdigit():
        return (False, f"bad number '{text}'")
    return (True, int(text))


def parse_code(text):  # style 3: -1 means failure, and nothing makes the caller check
    return int(text) if text.isdigit() else -1


try:
    total = 0
    for k, t in enumerate(INPUTS, 1):
        total += parse_exc(t)
except ParseError as e:
    print(f"exception: stopped at item {k}: {e}, partial sum {total}")
oks, errs = 0, []
for k, t in enumerate(INPUTS, 1):
    ok, v = parse_result(t)
    if ok:
        oks += v
    else:
        errs.append(k)
print(f"result values: sum {oks}, errors at items {', '.join(map(str, errs))}")
print(f"error codes, never checked: sum {sum(parse_code(t) for t in INPUTS)}, nothing flagged")


# Part 2. 100 records. Record i is permanently bad if (i*37) % 100 < bad%, else it fails its first f attempts (f = 1 + i*7 % 3)
# if (i*53 + 11) % 100 < transient%, and works after that. 37 and 53 are coprime with 100, so the shares are exact.
class Bad(Exception):
    pass


class Transient(Exception):
    pass


def work(i, attempt, bad, trans):
    if (i * 37) % 100 < bad:
        raise Bad()
    if (i * 53 + 11) % 100 < trans and attempt <= 1 + (i * 7) % 3:
        raise Transient()


def run(strategy, bad, trans, retries, dependent):
    n, attempts, correct, wrong, parked, unprocessed, noticed = 100, 0, 0, 0, 0, 0, 0
    aborted, broken = False, False
    allowed = retries if strategy in ("retry", "deadletter", "blind") else 0
    for i in range(1, n + 1):
        if aborted:
            unprocessed += 1
            continue
        failed, attempt = True, 1
        while attempt <= 1 + allowed:
            attempts += 1
            try:
                work(i, attempt, bad, trans)
                failed = False
                break
            except Bad:
                if strategy != "blind":  # a data error will not fix itself: only blind retry tries again
                    break
            except Transient:
                pass
            attempt += 1
        if not failed:
            if dependent and broken:
                wrong += 1  # computed on top of a record that was skipped or faked
            else:
                correct += 1
        elif strategy == "swallow":
            wrong += 1  # caught, ignored, a default value saved
            broken = True
        elif strategy in ("failfast", "retry"):
            aborted, unprocessed, noticed = True, unprocessed + 1, i
        else:
            parked += 1
            broken = True
            noticed = noticed or i
    return correct, wrong, parked, unprocessed, attempts, noticed


STRATEGIES = [("swallow", "swallow and continue"), ("failfast", "fail fast"), ("retry", "retry, then fail fast"),
              ("deadletter", "dead-letter and continue"), ("blind", "retry everything")]
for bad, trans, retries, dep in [(0, 20, 3, False), (10, 0, 3, False), (10, 10, 3, False), (10, 10, 3, True)]:
    print(f"bad {bad}%, transient {trans}%, retries {retries}, later records depend on earlier ones: {str(dep).lower()}")
    for key, label in STRATEGIES:
        c, w, p, u, a, nt = run(key, bad, trans, retries, dep)
        print(f"  {label}: correct {c}, wrong {w}, parked {p}, not processed {u}, attempts {a}, noticed at {nt if nt else 'never'}")
