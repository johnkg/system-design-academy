# A miniature of the ideas in GitHub's 2016 post on gh-ost and in gh-ost's documentation of its cut-over, in Python
# (a teaching model, not GitHub's code): copy rows into a ghost table in chunks, replay the change log into it instead of
# using triggers, throttle on replica lag, and swap the tables with a sentry so that a failed cut-over can be retried.
# Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
import sys

ROWS = 10  # rows in the original table
CHUNK = 3  # rows copied at a time
LAG_LIMIT = 2  # ticks of replica lag above which the migration pauses
WRITE_TICKS = [1, 2, 4]  # ticks in which the application updates a row

# The original table: row id -> version. The change log is what gh-ost reads instead of triggers.
original = {i + 1: 1 for i in range(ROWS)}
ghost = {}
log = []  # change events: (row, version)
log_position = 0  # how much of the log has been applied to the ghost table


# The application changes row (tick + 1) to a newer version. The change is written to the log, not copied by a trigger.
def application_write(tick):
    row = tick + 1
    original[row] += 1
    log.append((row, original[row]))


def copy_chunk(start):
    copied = 0
    row = start
    while row < start + CHUNK and row <= ROWS:
        # A row the log has not yet replayed is copied with its current version; replaying the log later only moves versions forward.
        ghost[row] = max(ghost.get(row, 0), original[row])
        copied += 1
        row += 1
    return copied


def apply_log():
    global log_position
    applied = 0
    while log_position < len(log):
        row, version = log[log_position]
        if row in ghost:
            ghost[row] = max(ghost[row], version)
        applied += 1
        log_position += 1
    return applied


# Replica lag for each tick: the replica falls behind during the busy ticks.
def lag_at(tick):
    return 3 if 3 <= tick <= 5 else 0


def migrate():
    print("--- migration: copy chunks, replay the log, pause when the replica lags")
    nxt = 1
    paused_ticks = 0
    tick = 1
    while nxt <= ROWS or log_position < len(log):
        if tick in WRITE_TICKS:
            application_write(tick)
        if lag_at(tick) > LAG_LIMIT:
            paused_ticks += 1
            print(f"tick {tick}: replica lag {lag_at(tick)} is over {LAG_LIMIT}, throttled, no writes")
        else:
            copied = copy_chunk(nxt) if nxt <= ROWS else 0
            nxt += copied
            applied = apply_log()
            print(f"tick {tick}: copied {copied} rows, log events replayed {applied}, ghost has {len(ghost)} of {ROWS} rows")
        tick += 1
    return paused_ticks


# Cut-over: a sentry blocks the rename until everything is ready, and a failed attempt leaves the original in place.
def cut_over(fail_first_attempt):
    live_table = "original"
    attempt = 1
    while True:
        failed = fail_first_attempt and attempt == 1
        message = f"connection lost, table is still the {live_table}, queries released" if failed else "atomic rename done"
        print(f"cut-over attempt {attempt}: {message}")
        if not failed:
            return "ghost", attempt
        attempt += 1


paused = migrate()
same = all(ghost.get(row) == version for row, version in original.items())
print(f"tables identical: {'yes' if same else 'no'}, ticks paused: {paused}")
print("--- cut-over")
live, attempts = cut_over(True)
print(f"live table: {live} after {attempts} attempts")
ok = same and paused == 3 and live == "ghost" and attempts == 2
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
