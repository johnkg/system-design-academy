// A package registry in JavaScript:
// immutable publishes stored by content hash, semver range resolution over a dependency graph, and an integrity check on install.
import { createHash } from 'node:crypto';

const INTEGRITY_HEX = 16; // hex digits of the SHA-256 kept in the integrity string, enough for a demo
const sha = (text) => createHash('sha256').update(text).digest('hex');
const parse = (v) => v.split('.').map(Number);
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

// Turn a range such as "^1.2.0", "~1.4.0" or ">=1.1.0 <2.0.0" into a list of [operator, version] tests that must all pass.
function comparators(range) {
  const tests = [];
  for (const tok of range.split(' ').filter(Boolean)) {
    if (tok === '*') continue;
    if (tok[0] === '^') { // compatible: the left-most non-zero number may not change
      const v = parse(tok.slice(1));
      tests.push(['>=', v], ['<', v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1]]);
    } else if (tok[0] === '~') { // patch updates only
      const v = parse(tok.slice(1));
      tests.push(['>=', v], ['<', [v[0], v[1] + 1, 0]]);
    } else {
      const n = tok.startsWith('>=') || tok.startsWith('<=') ? 2 : tok[0] === '>' || tok[0] === '<' ? 1 : 0;
      tests.push([n ? tok.slice(0, n) : '=', parse(tok.slice(n))]);
    }
  }
  return tests;
}

function satisfies(version, range) {
  const v = parse(version);
  return comparators(range).every(([op, w]) => {
    const c = cmp(v, w);
    return op === '>=' ? c >= 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : op === '<' ? c < 0 : c === 0;
  });
}

class Registry {
  constructor() { this.index = new Map(); this.blobs = new Map(); } // index: name -> version -> metadata; blobs: hash -> tarball

  publish(name, version, deps) {
    const body = `${name}@${version}|${deps.map(([n, r]) => `${n}:${r}`).join(',')}`; // stands in for the tarball bytes
    const integrity = 'sha256-' + sha(body).slice(0, INTEGRITY_HEX);
    if (!this.index.has(name)) this.index.set(name, new Map());
    const old = this.index.get(name).get(version);
    if (old) { // a version is immutable: the same bytes are a no-op, different bytes are refused
      if (old.integrity !== integrity) throw new Error(`${name}@${version} already exists with different content`);
      return false;
    }
    this.index.get(name).set(version, { deps, integrity, yanked: false });
    this.blobs.set(integrity, body);
    return true;
  }

  yank(name, version) { this.index.get(name).get(version).yanked = true; } // hidden from new resolutions, still downloadable

  // Pick the highest allowed version of every package. A lock entry that still fits the range wins, even if it was yanked.
  resolve(root, lock = new Map()) {
    const chosen = new Map();
    const queue = root.map(([n, r]) => [n, r, 'app']);
    while (queue.length) {
      const [name, range, from] = queue.shift();
      if (chosen.has(name)) {
        if (!satisfies(chosen.get(name), range)) throw new Error(`${from} needs ${name} ${range}, but ${name}@${chosen.get(name)} is already chosen`);
        continue;
      }
      const versions = this.index.get(name);
      if (!versions) throw new Error(`unknown package ${name}`);
      let pick = lock.has(name) && satisfies(lock.get(name), range) ? lock.get(name) : null;
      if (!pick) {
        const ok = [...versions].filter(([v, m]) => !m.yanked && satisfies(v, range)).map(([v]) => v).sort((a, b) => cmp(parse(a), parse(b)));
        pick = ok.length ? ok[ok.length - 1] : null;
      }
      if (!pick) throw new Error(`no version of ${name} matches ${range}`);
      chosen.set(name, pick);
      for (const [d, r] of versions.get(pick).deps) queue.push([d, r, `${name}@${pick}`]);
    }
    return chosen;
  }

  // Download each tarball by hash and check that the bytes still hash to the value in the lock.
  install(chosen) {
    const bad = [];
    for (const [name, version] of chosen) {
      const integrity = this.index.get(name).get(version).integrity;
      if ('sha256-' + sha(this.blobs.get(integrity)).slice(0, INTEGRITY_HEX) !== integrity) bad.push(`${name}@${version}`);
    }
    return bad;
  }
}

const show = (m) => [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, v]) => `${n}@${v}`).join(', ');
const reg = new Registry();
const releases = [
  ['colorize', '1.0.0', []], ['colorize', '1.1.0', []], ['colorize', '1.1.5', []], ['colorize', '2.0.0', []],
  ['pathx', '1.0.0', []], ['pathx', '1.2.0', []], ['pathx', '1.3.0', []], ['pathx', '2.0.0', []],
  ['tinyutil', '0.3.0', []], ['tinyutil', '0.3.4', []], ['tinyutil', '0.4.0', []],
  ['loglite', '1.4.0', [['colorize', '^1.0.0']]], ['loglite', '1.4.2', [['colorize', '>=1.1.0 <2.0.0']]], ['loglite', '1.5.0', [['colorize', '^1.1.0']]],
  ['webkit', '2.1.0', [['pathx', '^1.2.0'], ['tinyutil', '^0.3.0']]], ['webkit', '2.2.0', [['pathx', '^1.2.0'], ['tinyutil', '^0.3.1']]],
  ['webkit', '3.0.0', [['pathx', '^2.0.0']]],
];
for (const [n, v, d] of releases) reg.publish(n, v, d);

const app = [['webkit', '^2.0.0'], ['loglite', '~1.4.0'], ['pathx', '^1.2.0']];
const lock = reg.resolve(app);
console.log(`resolved: ${show(lock)}`);
try { reg.resolve([['webkit', '^3.0.0'], ['pathx', '^1.0.0']]); } catch (e) { console.log(`conflict: ${e.message}`); }

reg.yank('webkit', '2.2.0');
console.log(`after yank, new install: ${show(reg.resolve(app))}`);
console.log(`after yank, locked install: ${show(reg.resolve(app, lock))}`);

console.log(`webkit@2.1.0 integrity ${reg.index.get('webkit').get('2.1.0').integrity}`);
console.log(`republish same bytes: ${reg.publish('webkit', '2.1.0', [['pathx', '^1.2.0'], ['tinyutil', '^0.3.0']])}`);
let refused = false;
try { reg.publish('webkit', '2.1.0', [['evil', '*']]); } catch (e) { refused = true; console.log(`republish other bytes: ${e.message}`); }

const clean = reg.install(lock).length;
reg.blobs.set(reg.index.get('pathx').get('1.3.0').integrity, 'pathx@1.3.0|evil:*'); // someone swaps the stored bytes
const bad = reg.install(lock);
console.log(`install before tamper: ${clean} bad; after tamper: ${bad.join(', ')}`);
if (!refused || clean !== 0 || bad.length !== 1 || show(lock) !== 'colorize@1.1.5, loglite@1.4.2, pathx@1.3.0, tinyutil@0.3.4, webkit@2.2.0') process.exit(1);
