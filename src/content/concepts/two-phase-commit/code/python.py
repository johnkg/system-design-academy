"""Two-phase commit in Python: a coordinator collects votes, then commits or aborts everywhere."""


class Participant:
    def __init__(self, name, can_commit):
        self.name = name
        self.can_commit = can_commit
        self.state = "idle"

    def prepare(self):
        # Do the work, write it to durable storage and lock the data; then promise to commit if asked
        self.state = "prepared (locks held)" if self.can_commit else "aborted"
        return self.can_commit

    def commit(self):
        self.state = "committed"

    def abort(self):
        self.state = "aborted"


def two_phase_commit(participants, coordinator_crashes_after_votes=False):
    # Phase 1: ask everyone
    votes = [p.prepare() for p in participants]
    print(f"  votes: {', '.join(f'{p.name}={'yes' if v else 'no'}' for p, v in zip(participants, votes))}")
    decision = "commit" if all(votes) else "abort"
    print(f"  coordinator logs decision: {decision}")

    if coordinator_crashes_after_votes:
        print("  coordinator CRASHES before telling anyone")
    else:
        # Phase 2: tell everyone
        for p in participants:
            p.commit() if decision == "commit" else p.abort()
    print(f"  final states: {' | '.join(f'{p.name}: {p.state}' for p in participants)}")


print("all participants vote yes:")
two_phase_commit([Participant("bankA", True), Participant("bankB", True)])

print("one participant votes no:")
two_phase_commit([Participant("bankA", True), Participant("bankB", False)])

print("coordinator crashes after the votes:")
two_phase_commit([Participant("bankA", True), Participant("bankB", True)], coordinator_crashes_after_votes=True)
