// A mobile release over 30 days for 1,000,000 active users. Version 7 goes out through a staged store rollout (1%, 5%, 20%,
// 50%, 100%) and may carry a bug. The run shows how fast the bug is found, how it is stopped, who is left on it and who is
// locked out. Day 0 is a Thursday. All numbers are integers; the only randomness is the seeded generator below, which the
// automatic gate uses to sample users, so the output never changes.
const DAYS = 30;
const USERS = 1000000;
const OLD_MIX = [600000, 220000, 180000]; // users on v6, v5, and v4 or older on the day v7 ships
const STUCK_PCT = 13;    // 8% never update and 5% have a phone too old for the update: they stay where they are
const ORGANIC_PCT = 15;  // of the willing users the store offers the update to, this share installs it each day
const HOTFIX_PCT = 25;   // of the users on the broken build, this share installs the fix each day
const STICKY_PCT = 3;    // users on the broken build who never take the fix (they have switched updates off)
const FORCED_PCT = 70;   // of the willing users behind a forced-upgrade screen, this share updates each day
const FLOOR_DAY = 14;    // the day the minimum supported version is raised
const FIX_DAYS = 1;      // a day to fix, build and test before the hotfix is submitted to the store
const HALT_DAYS = 3;     // how long a false alarm freezes the rollout while people look
const BASE_PM = 5;       // 5 in 1,000 users crash on an ordinary day, on any healthy version
const MARGIN_PM = 3;     // the gate halts when the new version is worse than the old one by more than this
const TICKETS = 3000;    // with no monitoring, support tickets and store reviews notice at this many hurt users
const TICKET_LAG = 3;    // days from that moment until a fix or a switch-off is under way
const REVIEW_MIN = 5000; // a person does not act on fewer users than this on the new version
const SEED = 20261120;
const stageAt = (u) => (u < 2 ? 1 : u < 4 ? 5 : u < 7 ? 20 : u < 10 ? 50 : 100); // store share on the u-th unfrozen day
const weekday = (d) => (d + 3) % 7 < 5; // day 0 is a Thursday

function run(name, { bug, bugPm, monitor, sample, kill, delay, floor }) {
  let rng = SEED;
  const rand = () => (rng = (rng * 48271) % 2147483647); // Park-Miller: the same numbers in every language
  const W = OLD_MIX.map((c) => Math.floor((c * (100 - STUCK_PCT)) / 100)); // willing to update, by old version
  const S = OLD_MIX.map((c, i) => c - W[i]);                               // stuck where they are
  const U = W.reduce((a, b) => a + b, 0);
  const blocked = floor === 'v5' ? [2] : floor === 'v6' ? [1, 2] : floor === 'v7' ? [0, 1, 2] : [];
  const flagRoute = bug === 'flag' && kill === 'flag';
  let nV7 = 0, nFix = 0, adopted = 0, hits = 0, aff = 0, bugDays = 0, lockedStuck = 0, sticky = 0;
  let stage = 0, unfrozen = 0, F = -1, H = -1, freezeUntil = 0, falseHalts = 0, full = -1;
  const suffer = [], endNew = [], endAff = [];
  for (let d = 0; d < DAYS; d++) {
    if (flagRoute && F >= 0 && d >= F) aff = 0; // the flag is off: nobody hits the bug any more
    if (monitor === 'review' && F < 0 && bug !== 'none' && weekday(d) && d > 0) {
      // a person reads yesterday's dashboard: enough users, and a crash rate at least double the old one
      if (endNew[d - 1] >= REVIEW_MIN && 1000 * endAff[d - 1] >= BASE_PM * endNew[d - 1]) F = d + 1;
    }
    if (F >= 0 && !flagRoute && H < 0) H = F + FIX_DAYS + delay; // the hotfix day, after store review
    const halted = d < freezeUntil || (F >= 0 && !flagRoute && d >= F && d < H);
    if (d === H) sticky = Math.floor((nV7 * STICKY_PCT) / 100);
    if (H >= 0 && d >= H) {
      const mig = Math.floor(((nV7 - sticky) * HOTFIX_PCT) / 100);
      if (nV7 > 0) aff = Math.floor((aff * (nV7 - mig)) / nV7);
      nV7 -= mig; nFix += mig;
    }
    if (H >= 0 && d >= H) stage = 100; // the hotfix goes to everyone at once
    else if (!halted) { stage = stageAt(unfrozen); unfrozen++; }
    if (stage === 100 && full < 0) full = d;
    const adopt = (x) => {
      if (x <= 0) return;
      adopted += x;
      if (H >= 0 && d >= H) { nFix += x; return; }
      nV7 += x;
      if (bug !== 'none' && !(flagRoute && F >= 0 && d >= F)) { const a = Math.floor((x * bugPm) / 1000); hits += a; aff += a; }
    };
    if (d === FLOOR_DAY) for (const b of blocked) { lockedStuck += S[b]; S[b] = 0; }
    if (d >= FLOOR_DAY && !halted && stage === 100) {
      for (const b of blocked) { const m = Math.floor((W[b] * FORCED_PCT) / 100); W[b] -= m; adopt(m); }
    }
    if (!halted) {
      const sumW = W.reduce((a, b) => a + b, 0);
      const want = Math.min(sumW, Math.floor(((Math.floor((U * stage) / 100) - adopted) * ORGANIC_PCT) / 100));
      if (want > 0) {
        let given = 0;
        const take = W.map((w) => { const t = Math.floor((want * w) / sumW); given += t; return t; });
        for (let b = 0; b < 3 && given < want; b++) { const e = Math.min(W[b] - take[b], want - given); take[b] += e; given += e; }
        for (let b = 0; b < 3; b++) W[b] -= take[b];
        adopt(want);
      }
    }
    suffer.push(aff); endNew.push(nV7 + nFix); endAff.push(aff); bugDays += aff;
    if (F < 0 && bug !== 'none' && monitor === 'none' && hits >= TICKETS) F = d + TICKET_LAG;
    if (F < 0 && monitor === 'gate' && nV7 + nFix >= sample && d >= freezeUntil) {
      // the gate samples this many users of the new version and compares their crash rate with the old version's
      const pm = BASE_PM * 1000 + Math.floor((aff * 1000000) / (nV7 + nFix)); // crashes per million users
      let c = 0;
      for (let i = 0; i < sample; i++) if (rand() % 1000000 < pm) c++;
      if (c * 1000 > sample * (BASE_PM + MARGIN_PM)) {
        if (aff > 0) F = d + 1;                                   // a real bug: stop and fix
        else { freezeUntil = d + 1 + HALT_DAYS; falseHalts++; }   // noise: the rollout stops for a few days for nothing
      }
    }
  }
  let peak = 0, contained = -1; // contained: the first day fewer than a tenth of the peak number of users are still being hit
  suffer.forEach((s, d) => { if (s > peak) { peak = s; contained = -1; } else if (contained < 0 && s * 10 < peak) contained = d; });
  const liveBug = bug !== 'none' && !(flagRoute && F >= 0);
  const locked = lockedStuck + blocked.reduce((a, b) => a + W[b], 0);
  const old = W.map((w, i) => (blocked.includes(i) ? 0 : w) + S[i]);
  if (nV7 + nFix + old[0] + old[1] + old[2] + locked !== USERS) throw new Error('users lost');
  console.log(`-- ${name}`);
  console.log(`  bug: ${hits} users hit it, ${bugDays} user-days with it, ${bug === 'none' ? 'no bug' : contained < 0 ? 'not contained in 30 days' : `contained on day ${contained}`}`);
  console.log(`  rollout: store at 100% on day ${full < 0 ? 'never' : full}, ${falseHalts} false halts, ${liveBug ? nV7 : 0} users still on the broken version`);
  console.log(`  mix: v7 ${nV7}, v7.1 ${nFix}, v6 ${old[0]}, v5 ${old[1]}, v4 or older ${old[2]}, locked out ${locked}`);
}

const base = { bug: 'crash', bugPm: 30, monitor: 'none', sample: 2000, kill: 'build', delay: 3, floor: 'none' };
run('3% crash, no monitoring, new build only', base);
run('3% crash, daily review', { ...base, monitor: 'review' });
run('3% crash, automatic gate on 2000 users', { ...base, monitor: 'gate' });
run('3% crash, automatic gate on 20000 users', { ...base, monitor: 'gate', sample: 20000 });
run('3% crash, gate, 7 days of store review for the hotfix', { ...base, monitor: 'gate', delay: 7 });
run('bug behind a flag, gate, server flag', { ...base, bug: 'flag', monitor: 'gate', kill: 'flag' });
run('crash in the build, gate, server flag', { ...base, monitor: 'gate', kill: 'flag' });
run('healthy release, gate on 200 users', { ...base, bug: 'none', monitor: 'gate', sample: 200 });
run('healthy release, gate on 20000 users', { ...base, bug: 'none', monitor: 'gate', sample: 20000 });
run('3% crash, gate, minimum version v7 on day 14', { ...base, monitor: 'gate', floor: 'v7' });
run('3% crash, gate, minimum version v5 on day 14', { ...base, monitor: 'gate', floor: 'v5' });
