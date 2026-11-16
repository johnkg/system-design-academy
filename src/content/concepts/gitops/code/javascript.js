// GitOps reconciler: Git holds the desired state, a controller in the cluster pulls it and makes the live state match.
// A 15-minute window of one app, second by second. Everything is integers and fixed events, so the output never changes.
const END = 900;          // seconds simulated
const POLL = 180;         // how often the controller looks at Git (3 minutes is a common default)
const REACT = 5;          // a webhook, or a change the controller sees in the cluster, is acted on this many seconds later
const ALERT_AFTER = 60;   // a broken version is noticed, and reverted in Git, this long after it goes live
const HAND_EDIT_AT = 200; // someone runs "kubectl scale --replicas=10" by hand
// Commits to Git: deploy v2, deploy v3 (which is broken), delete the old cleanup job.
const COMMITS = [{ at: 20, image: 'v2' }, { at: 430, image: 'v3' }, { at: 640, removeJob: true }];

function run(name, { webhook, selfHeal, prune }) {
  const git = { image: 'v1', replicas: 3, job: true };
  const live = { ...git };
  const applied = { ...git };       // what the controller last applied from Git
  const todo = [];                   // [time, reason] of syncs waiting to run
  const log = [];
  let handAt = -1, handLasted = -1, v2LiveAt = -1, v3LiveAt = -1, badFor = -1, revertAt = -1, outOfSync = 0;

  const sync = (t, why) => {
    const gitChanged = git.image !== applied.image || git.job !== applied.job;
    const drifted = live.replicas !== git.replicas;
    if (!gitChanged && !(drifted && why === 'self-heal')) return;
    // A sync applies every manifest in Git, so it also undoes hand edits. Deleting what Git no longer lists needs prune.
    if (drifted && handLasted < 0) { handLasted = t - handAt; log.push(`${t}s ${why}: replicas 10 -> 3 (the hand edit is gone)`); }
    if (live.image !== git.image) log.push(`${t}s ${why}: image ${live.image} -> ${git.image}`);
    live.image = git.image; live.replicas = git.replicas;
    if (live.job && !git.job && prune) { live.job = false; log.push(`${t}s ${why}: cleanup job deleted`); }
    Object.assign(applied, git);
    if (live.image === 'v2' && v2LiveAt < 0) v2LiveAt = t;
    if (live.image === 'v3' && v3LiveAt < 0) v3LiveAt = t;
    if (v3LiveAt >= 0 && badFor < 0 && live.image !== 'v3') badFor = t - v3LiveAt;
  };
  const commit = (t, c) => {
    if (c.image) git.image = c.image;
    if (c.removeJob) git.job = false;
    log.push(`${t}s commit: ${c.revert ? 'revert to image v2' : c.image ? `image ${c.image}` : 'delete the cleanup job'}`);
    if (webhook) todo.push([t + REACT, 'webhook']);
  };

  for (let t = 1; t <= END; t++) {
    for (const c of COMMITS) if (c.at === t) commit(t, c);
    if (v3LiveAt >= 0 && revertAt < 0 && t === v3LiveAt + ALERT_AFTER) { revertAt = t; commit(t, { image: 'v2', revert: true }); }
    if (t === HAND_EDIT_AT) {
      live.replicas = 10; handAt = t; log.push(`${t}s hand edit: replicas 3 -> 10`);
      if (selfHeal) todo.push([t + REACT, 'self-heal']); // the controller watches the cluster and sees the change
    }
    for (const [at, why] of todo) if (at === t) sync(t, why);
    if (t % POLL === 0) sync(t, 'poll');
    if (live.image !== git.image || live.replicas !== git.replicas || live.job !== git.job) outOfSync++;
  }

  console.log(`-- ${name}`);
  for (const line of log) console.log(`  ${line}`);
  console.log(`  v2 live ${v2LiveAt - COMMITS[0].at}s after its commit; broken v3 served for ${badFor}s`);
  console.log(`  hand edit ${handLasted < 0 ? 'never undone' : `lasted ${handLasted}s`}; cleanup job ${live.job ? 'still running, an orphan' : 'deleted'}; out of sync ${outOfSync}s of ${END}`);
  if (outOfSync > END || badFor <= 0) throw new Error('impossible result');
}

run('poll every 3 min, no self-heal, no prune', { webhook: false, selfHeal: false, prune: false });
run('poll every 3 min, self-heal, prune', { webhook: false, selfHeal: true, prune: true });
run('webhook on push, self-heal, prune', { webhook: true, selfHeal: true, prune: true });
