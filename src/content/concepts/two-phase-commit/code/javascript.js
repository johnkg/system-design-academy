// Two-phase commit in JavaScript: a coordinator collects votes, then commits or aborts everywhere.

class Participant {
  state = "idle";
  constructor(name, canCommit) { this.name = name; this.canCommit = canCommit; }

  prepare() {
    // Do the work, write it to durable storage and lock the data; then promise to commit if asked
    this.state = this.canCommit ? "prepared (locks held)" : "aborted";
    return this.canCommit;
  }
  commit() { this.state = "committed"; }
  abort() { this.state = "aborted"; }
}

function twoPhaseCommit(participants, { coordinatorCrashesAfterVotes = false } = {}) {
  // Phase 1: ask everyone
  const votes = participants.map((p) => p.prepare());
  console.log(`  votes: ${participants.map((p, i) => `${p.name}=${votes[i] ? "yes" : "no"}`).join(", ")}`);
  const decision = votes.every(Boolean) ? "commit" : "abort";
  console.log(`  coordinator logs decision: ${decision}`);

  if (coordinatorCrashesAfterVotes) {
    console.log("  coordinator CRASHES before telling anyone");
  } else {
    // Phase 2: tell everyone
    for (const p of participants) decision === "commit" ? p.commit() : p.abort();
  }
  console.log(`  final states: ${participants.map((p) => `${p.name}: ${p.state}`).join(" | ")}`);
}

console.log("all participants vote yes:");
twoPhaseCommit([new Participant("bankA", true), new Participant("bankB", true)]);

console.log("one participant votes no:");
twoPhaseCommit([new Participant("bankA", true), new Participant("bankB", false)]);

console.log("coordinator crashes after the votes:");
twoPhaseCommit([new Participant("bankA", true), new Participant("bankB", true)], { coordinatorCrashesAfterVotes: true });
