import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conceptLinks, learnFor } from '../src/learn.ts';

const names = new Map([['cache', 'Caching'], ['queue', 'Message queues']]);
const patterns = new Map([['observer', 'Observer']]);

test('conceptLinks resolves names, builds hrefs, skips unknown and duplicate refs', () => {
  const out = conceptLinks([{ slug: 'cache' }, { kind: 'concept', slug: 'cache' }, { slug: 'nope' }, { kind: 'pattern', slug: 'observer' }, { kind: 'pattern', slug: 'cache' }], names, patterns);
  assert.deepEqual(out, [{ name: 'Caching', href: '/concepts/cache/' }, { name: 'Observer', href: '/patterns/observer/' }]);
});

const conceptData = {
  problem: 'Servers become overloaded when traffic spikes suddenly',
  howItWorks: [
    { title: 'Hash the key', text: 'A hash function maps every key to a bucket on the ring' },
    { title: 'Replicate', text: 'Copies of each record are written to neighbouring replicas for durability' },
  ],
  pros: ['Cheap reads'], cons: ['Stale data possible'],
  whenToUse: ['Read heavy workloads'], whenNotToUse: ['Strict consistency needed'], pitfalls: ['Forgetting expiry'],
};
const q = (question: string, answer: string, explanation: string) => ({ question, options: ['x', answer, 'y', 'z'], answer: 1, explanation });

test('a concept question links to the section that teaches the idea', () => {
  const l = learnFor('concepts', 'ring', conceptData, q('Which copies hold each record?', 'Neighbouring replicas', 'Records are replicated to neighbouring replicas for durability'), names, patterns);
  assert.equal(l.where, 'How it works: Replicate');
  assert.equal(l.href, '/concepts/ring/#how-1');
  assert.deepEqual(l.concepts, []);
});

test('the explanation can point at the problem section', () => {
  const l = learnFor('concepts', 'ring', conceptData, q('What goes wrong first?', 'Overload', 'Servers become overloaded when traffic spikes'), names, patterns);
  assert.equal(l.href, '/concepts/ring/#problem');
});

test('when nothing matches, the first section is used (never undefined)', () => {
  const l = learnFor('concepts', 'ring', conceptData, q('zzzz?', 'qqqq', 'wwww'), names, patterns);
  assert.equal(l.href, '/concepts/ring/#problem');
});

const patternData = { problem: 'Callers need updates', pain: ['Tight coupling'], solution: 'Subscribe to the subject', benefits: ['Loose coupling'], whenToUse: ['Many listeners'], whenNotToUse: ['One listener'], pitfalls: ['Memory leaks from lingering subscribers'] };
test('pattern questions use pattern sections and the /patterns/ path', () => {
  const l = learnFor('patterns', 'observer', patternData, q('Which mistake causes leaks?', 'Lingering subscribers', 'Memory leaks happen from lingering subscribers'), names, patterns);
  assert.equal(l.href, '/patterns/observer/#pitfalls');
});

const studyData = {
  firstAttempt: { text: 'One database serves everything', limits: ['Single point of failure'] },
  steps: [{ title: 'Add a cache', problem: 'Reads overload the database', fix: 'Cache hot keys', tradeoff: 'Stale reads', concepts: [{ slug: 'cache' }] }],
  failures: [{ scenario: 'The cache node dies', impact: 'Database stampede', answer: 'Request coalescing', concepts: [{ slug: 'queue' }, { slug: 'ghost' }] }],
  alternatives: [{ title: 'ID format', options: [{ name: 'UUID', pro: 'no coordination', con: 'unordered' }], pick: 'UUID' }],
};
test('case study questions link to a step and list the concepts behind it', () => {
  const l = learnFor('studies', 'shortener', studyData, q('Why add a cache?', 'Reads overload the database', 'Cache hot keys so reads stop overloading the database'), names, patterns);
  assert.equal(l.href, '/case-studies/shortener/#step-1');
  assert.deepEqual(l.concepts, [{ name: 'Caching', href: '/concepts/cache/' }]);
});

test('case study failures link with their concepts, unknown ones dropped', () => {
  const l = learnFor('studies', 'shortener', studyData, q('What happens when the cache node dies?', 'Database stampede', 'The cache node dies and requests stampede the database; request coalescing helps'), names, patterns);
  assert.equal(l.href, '/case-studies/shortener/#fail-0');
  assert.deepEqual(l.concepts.map((c) => c.name), ['Message queues']);
});

test('case studies without alternatives still work', () => {
  const { alternatives, ...rest } = studyData;
  const l = learnFor('studies', 's', rest, q('Single point of failure?', 'One database', 'One database is a single point of failure'), names, patterns);
  assert.equal(l.href, '/case-studies/s/#first-attempt');
});
