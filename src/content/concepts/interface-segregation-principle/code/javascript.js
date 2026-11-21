// Interface Segregation Principle: a device family (print, scan, fax) with five clients, built with three kinds of interface.
// Then three changes arrive: a new method (staple), a new device type (LabelPrinter) and a changed signature (print).
// Look for: stub methods devices are forced to write, existing clients hit by each change, and how many interfaces exist.
const ROLE_OF = { print: 'Printing', setPaper: 'Printing', scan: 'Scanning', scanToEmail: 'Scanning', fax: 'Faxing', faxStatus: 'Faxing', status: 'Admin', reset: 'Admin', staple: 'Finishing' };
const CLIENTS = [ // what each client calls
  ['PrintDialog', ['print', 'setPaper']],
  ['ScanToEmail', ['scan', 'scanToEmail']],
  ['FaxDesk', ['fax', 'faxStatus']],
  ['CopyShortcut', ['scan', 'print']],
  ['HealthMonitor', ['status', 'reset']],
];
const START_METHODS = ['print', 'setPaper', 'scan', 'scanToEmail', 'fax', 'faxStatus', 'status', 'reset'];
const START_DEVICES = [ // what each device can really do
  ['BasicPrinter', ['print', 'setPaper', 'status', 'reset']],
  ['OfficeMachine', ['print', 'setPaper', 'scan', 'scanToEmail', 'fax', 'faxStatus', 'status', 'reset']],
];

// An interface is [name, methods]. Fat: one for everything. Roles: one per client need. Per method: one each.
function interfaces(mode, methods) {
  if (mode === 'fat') return [['Device', methods]];
  if (mode === 'per-method') return methods.map((m) => ['I' + m[0].toUpperCase() + m.slice(1), [m]]);
  const out = [];
  for (const m of methods) {
    let r = out.find((x) => x[0] === ROLE_OF[m]);
    if (!r) { r = [ROLE_OF[m], []]; out.push(r); }
    r[1].push(m);
  }
  return out;
}
const implementers = (devices, iface) => devices.filter((d) => d[1].some((m) => iface[1].includes(m)));
// A device must implement every method of each interface it takes part in: the ones it cannot do become stubs.
const stubsOf = (device, ifaces) => ifaces.filter((i) => i[1].some((m) => device[1].includes(m))).reduce((n, i) => n + i[1].filter((m) => !device[1].includes(m)).length, 0);
const totalStubs = (devices, ifaces) => devices.reduce((n, d) => n + stubsOf(d, ifaces), 0);
const dependsOn = (client, iface) => client[1].some((m) => iface[1].includes(m));
// Methods a client can see through its interfaces but never calls.
const noise = (ifaces) => CLIENTS.reduce((n, c) => n + ifaces.filter((i) => dependsOn(c, i)).reduce((k, i) => k + i[1].filter((m) => !c[1].includes(m)).length, 0), 0);

for (const [title, mode] of [['One fat interface', 'fat'], ['Role interfaces by client need', 'role'], ['One method per interface', 'per-method']]) {
  let methods = START_METHODS.slice();
  let devices = START_DEVICES.map((d) => [d[0], d[1].slice()]);
  let ifaces = interfaces(mode, methods);
  console.log(`== ${title}`);
  console.log(`  today: interfaces ${ifaces.length}; stub methods ${totalStubs(devices, ifaces)}; unused methods visible to clients ${noise(ifaces)}`);

  // A: a new method, staple, that only the office machine can do.
  const beforeA = ifaces, stubsBeforeA = totalStubs(devices, ifaces);
  methods = methods.concat(['staple']);
  devices[1][1].push('staple');
  ifaces = interfaces(mode, methods);
  let changed = ifaces.filter((i) => { const old = beforeA.find((o) => o[0] === i[0]); return !old || old[1].length !== i[1].length; });
  let hit = CLIENTS.filter((c) => changed.some((i) => beforeA.find((o) => o[0] === i[0]) && dependsOn(c, beforeA.find((o) => o[0] === i[0]))));
  let touched = devices.filter((d) => changed.some((i) => d[1].some((m) => i[1].includes(m))));
  console.log(`  A add method staple: new stubs ${totalStubs(devices, ifaces) - stubsBeforeA}; existing clients affected ${hit.length}; devices edited ${touched.length}`);

  // B: a new device type that can only print and report status.
  const label = ['LabelPrinter', ['print', 'status']];
  devices = devices.concat([label]);
  console.log(`  B new device LabelPrinter: new stubs ${stubsOf(label, ifaces)}; existing clients affected 0; devices edited 1`);

  // C: print() gets a new parameter.
  const printIface = ifaces.find((i) => i[1].includes('print'));
  hit = CLIENTS.filter((c) => dependsOn(c, printIface));
  touched = implementers(devices, printIface);
  console.log(`  C change print(): new stubs 0; existing clients affected ${hit.length} (${hit.map((c) => c[0]).join(', ')}); devices edited ${touched.length}`);
  console.log(`  after all three: interfaces ${ifaces.length}; stub methods ${totalStubs(devices, ifaces)}; unused methods visible to clients ${noise(ifaces)}`);
}
