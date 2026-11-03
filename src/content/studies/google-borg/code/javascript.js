// A miniature of the Borg scheduler from Google's EuroSys 2015 paper, in JavaScript (a teaching model, not Google's code):
// a pending queue scanned from high to low priority, feasibility checking that counts the room taken by lower-priority tasks as
// available, scoring that prefers few stranded resources and few preemptions, preemption of the lowest-priority tasks, a down
// machine whose tasks are rescheduled, and resource reclamation that lends unused production reservations to batch work.
// Everything is deterministic.

const PROD = 200, BATCH = 100;
const machines = [
  { name: 'm1', cpu: 10, ram: 10, tasks: [], up: true },
  { name: 'm2', cpu: 10, ram: 10, tasks: [], up: true },
  { name: 'm3', cpu: 8, ram: 16, tasks: [], up: true },
];
const used = (m, minPrio = 0, field = 'cpu') => m.tasks.filter((t) => t.prio >= minPrio).reduce((s, t) => s + t[field], 0);

function candidates(task) { // feasibility: room left after counting only tasks that cannot be evicted by this one
  return machines.filter((m) => m.up && m.cpu - used(m, task.prio, 'cpu') >= task.cpu && m.ram - used(m, task.prio, 'ram') >= task.ram);
}
function score(m, task) { // lower is better
  const fc = (m.cpu - used(m, task.prio, 'cpu') - task.cpu) / m.cpu, fr = (m.ram - used(m, task.prio, 'ram') - task.ram) / m.ram;
  const stranded = Math.abs(fc - fr); // one resource left over while the other is used up
  const fitsNow = m.cpu - used(m) >= task.cpu && m.ram - used(m, 0, 'ram') >= task.ram;
  const evicted = fitsNow ? 0 : 1; // preempting other tasks costs more than using free room
  return stranded + evicted;
}
function place(task, pending) {
  const best = candidates(task).sort((a, b) => score(a, task) - score(b, task) || a.name.localeCompare(b.name))[0];
  if (!best) { console.log(`${task.name} (priority ${task.prio}): no machine, stays pending`); return; }
  const gone = [];
  while (best.cpu - used(best) < task.cpu || best.ram - used(best, 0, 'ram') < task.ram) {
    const victim = [...best.tasks].sort((a, b) => a.prio - b.prio)[0]; // lowest priority first
    best.tasks = best.tasks.filter((t) => t !== victim);
    gone.push(victim); pending.push(victim);
  }
  best.tasks.push(task);
  console.log(`${task.name} (priority ${task.prio}, ${task.cpu} cpu, ${task.ram} ram) -> ${best.name}${gone.length ? `, preempting ${gone.map((t) => t.name).join(', ')}` : ''}`);
}
function schedule(pending) { // high priority first, as the scan of the pending queue does
  pending.sort((a, b) => b.prio - a.prio);
  while (pending.length) place(pending.shift(), pending);
}
const show = () => console.log(machines.map((m) => `${m.name}${m.up ? '' : ' (down)'}: ${m.tasks.map((t) => t.name).join(' ') || '-'}`).join(' | '));

const task = (name, prio, cpu, ram) => ({ name, prio, cpu, ram });
console.log('--- placing tasks');
let pending = [task('web1', PROD, 4, 3), task('web2', PROD, 4, 3), task('batch1', BATCH, 5, 5), task('batch2', BATCH, 3, 8), task('batch3', BATCH, 4, 2)];
schedule(pending);
show();

console.log('--- a production task arrives and needs room');
pending = [task('db1', PROD, 8, 8)];
schedule(pending);
console.log(`running now: ${machines.flatMap((m) => m.tasks).map((t) => t.name).join(' ')}`);

console.log('--- a machine stops answering polls');
const down = machines.find((m) => m.tasks.some((t) => t.name === 'web1'));
down.up = false;
pending = down.tasks.splice(0).filter(Boolean);
console.log(`${down.name} marked down, rescheduling: ${pending.map((t) => t.name).join(' ')}`);
schedule(pending);
show();
down.up = true;
console.log(`${down.name} answers again: the master tells it to kill the copies that were rescheduled, leaving ${down.tasks.length} tasks on it`);

console.log('--- resource reclamation');
const limit = { cpu: 8, usage: 2, margin: 1 };
const reservation = limit.usage + limit.margin;
console.log(`a production task asks for ${limit.cpu} cpu but uses ${limit.usage}; its reservation is ${reservation}, so ${limit.cpu - reservation} cpu can be lent to batch tasks`);
console.log(`a batch task needing 4 cpu ${limit.cpu - reservation >= 4 ? 'fits in reclaimed resources' : 'does not fit'}; one needing 6 ${limit.cpu - reservation >= 6 ? 'fits' : 'does not fit'}`);
