// Two devices edit one shared record with 5 fields over 60 minutes. Device B is offline for a window and queues its edits
// (an outbox); at reconnect the queue is replayed and a policy settles the conflicts. Integers and fixed seeds only.
const FIELDS = ['title', 'notes', 'due', 'status', 'priority'];
const BASE = { title: 'Buy milk', notes: '-', due: 'Fri', status: 'open', priority: 'low' };
const OFFLINE_START = 15;  // minute when device B loses its connection
const DELETE_AT = 23;      // minute when device A deletes the record, if the delete option is on
const EDITS = 14;
const ACK_LOST_PCT = 25;   // share of replayed mutations whose acknowledgement is lost, so the device sends them again

function makeRng(seed) { let s = seed; return () => { s = (s * 48271) % 2147483647; return s; }; }

// One edit about every 4 minutes, by A or B, to one of the fields. The value says who wrote it and when.
function timeline() {
  const next = makeRng(97);
  const edits = [];
  for (let k = 0; k < EDITS; k++) {
    const t = k * 4 + (next() % 4);
    const device = next() % 2 === 0 ? 'A' : 'B';
    const field = FIELDS[next() % FIELDS.length];
    edits.push({ t, device, field, value: `${device}${t}` });
  }
  return edits;
}

// The last edit per field: earlier ones by the same device on the same field are overwritten by their own author.
function net(list) {
  const byField = {};
  for (const e of list) byField[e.field] = e;
  return Object.values(byField);
}

// policy: 'lww' (whole record, newest clock wins), 'server' (replayed mutations apply in arrival order),
// 'merge' (per field; notes are joined; other fields newest clock wins), 'ask' (same-field conflicts go to the user).
// skew: minutes that device B's clock runs ahead of the truth (negative: behind).
function run(policy, offlineMin, skew, deleteOn) {
  const end = OFFLINE_START + offlineMin;
  const deleteInWindow = deleteOn && DELETE_AT < end;
  // The scenario ends when B reconnects. A cannot edit a record it has deleted.
  const edits = timeline().filter((e) => e.t < end && !(deleteInWindow && e.device === 'A' && e.t >= DELETE_AT));
  const state = { ...BASE };
  let deleted = false, lost = 0, merged = 0, toUser = 0;
  for (const e of edits) if (e.t < OFFLINE_START) state[e.field] = e.value;
  const before = { ...state };
  const aWin = edits.filter((e) => e.device === 'A' && e.t >= OFFLINE_START && e.t < end);
  const bQueue = edits.filter((e) => e.device === 'B' && e.t >= OFFLINE_START && e.t < end); // the outbox
  const aNet = net(aWin), bNet = net(bQueue);
  for (const e of aNet) state[e.field] = e.value;           // A is online: the server has these already
  const bTs = (e) => e.t + skew;                              // what B's clock wrote on its edits
  const both = aNet.length > 0 && bNet.length > 0;
  const aOnly = aNet.filter((a) => !bNet.some((b) => b.field === a.field));
  const bOnly = bNet.filter((b) => !aNet.some((a) => a.field === b.field));
  const same = bNet.filter((b) => aNet.some((a) => a.field === b.field));
  const fieldLevel = () => {
    if (both) merged += aOnly.length + bOnly.length;
    for (const e of bOnly) state[e.field] = e.value;
    for (const b of same) {
      const a = aNet.find((x) => x.field === b.field);
      if (policy === 'server') { state[b.field] = b.value; lost++; }                       // B arrived last: B overwrites A
      else if (policy === 'merge' && b.field === 'notes') { state[b.field] = `${a.value}+${b.value}`; merged++; }
      else if (policy === 'merge') { if (bTs(b) > a.t) state[b.field] = b.value; lost++; } // newest clock keeps its value
      else toUser++;                                                                       // ask: the user chooses, nothing is dropped
    }
  };
  if (deleteInWindow && bNet.length > 0) {
    // delete versus edit
    const bLast = Math.max(...bNet.map(bTs));
    if (policy === 'lww') {
      if (DELETE_AT > bLast) { deleted = true; lost += bNet.length; }                      // the delete is newer: B's edits die with the record
      else { Object.assign(state, before); for (const e of bNet) state[e.field] = e.value; lost += aNet.length + 1; }
    } else if (policy === 'server') { deleted = true; lost += bNet.length; }               // the tombstone arrived first
    else { fieldLevel(); if (policy === 'merge') lost++; else toUser++; }                  // keep the record: delete lost, or ask
  } else {
    if (deleteInWindow) deleted = true;
    if (!both) { for (const e of bNet) state[e.field] = e.value; }
    else if (policy === 'lww') {
      const aLast = Math.max(...aNet.map((e) => e.t)), bLast = Math.max(...bNet.map(bTs));
      if (bLast >= aLast) { Object.assign(state, before); for (const e of bNet) state[e.field] = e.value; lost += aNet.length; }
      else lost += bNet.length;
    } else fieldLevel();
  }
  // The outbox: each mutation has an id. Some acknowledgements are lost, so the device sends them again.
  const next = makeRng(17);
  let bytes = 0, dupes = 0;
  bQueue.forEach((e, j) => { bytes += `B-${j + 1}`.length + e.field.length + e.value.length + 24; if (next() % 100 < ACK_LOST_PCT) dupes++; });
  const record = deleted ? 'DELETED' : FIELDS.map((f) => `${f}=${state[f]}`).join(' ');
  console.log(`${policy.padEnd(6)} lost ${lost}, merged ${merged}, asked ${toUser}; outbox ${bQueue.length} mutations, ${bytes} bytes; duplicate sends ignored ${dupes}`);
  console.log(`       ${record}`);
}

for (const [label, offline, skew, del] of [['20 minutes offline, clocks agree', 20, 0, false], ['20 minutes offline, device B clock 8 minutes behind', 20, -8, false], ['20 minutes offline, A deletes the record', 20, 0, true], ['5 minutes offline, clocks agree', 5, 0, false]]) {
  console.log(`-- ${label}`);
  for (const policy of ['lww', 'server', 'merge', 'ask']) run(policy, offline, skew, del);
}
