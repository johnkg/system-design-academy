import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/graph.ts';

type Level = 'beginner' | 'intermediate' | 'advanced';
const concept = (id: string, area: string, difficulty: Level, related: string[] = []) => ({
  id, data: { name: id.toUpperCase(), area, difficulty, related: related.map((slug) => ({ kind: 'concept', slug })) },
});
const study = (id: string, ...slugs: string[]) => ({ id, data: { name: `Study ${id}`, steps: [{ concepts: slugs.map((slug) => ({ kind: 'concept', slug })) }] } });
const node = (g: ReturnType<typeof buildGraph>, slug: string) => g.find((n) => n.slug === slug)!;

test('read first = linked and easier; opens the door to = the reverse', () => {
  const g = buildGraph([concept('a', 'data', 'beginner', ['b']), concept('b', 'data', 'advanced', ['a'])], []);
  assert.deepEqual(node(g, 'b').first, ['a']);
  assert.deepEqual(node(g, 'a').first, []);
  assert.deepEqual(node(g, 'a').next, ['b']);
  assert.deepEqual(node(g, 'b').next, []);
});

test('a one-way link across areas is "also see", not "read first"', () => {
  const g = buildGraph([concept('a', 'data', 'beginner'), concept('b', 'api', 'advanced', ['a'])], []);
  assert.deepEqual(node(g, 'b').first, []);
});

test('a one-way link inside one area counts, and works in both directions', () => {
  const g = buildGraph([concept('a', 'data', 'beginner'), concept('b', 'data', 'advanced', ['a'])], []);
  assert.deepEqual(node(g, 'b').first, ['a']);
  assert.deepEqual(node(g, 'a').next, ['b']);
});

test('a mutual link across areas counts', () => {
  const g = buildGraph([concept('a', 'data', 'beginner', ['b']), concept('b', 'api', 'advanced', ['a'])], []);
  assert.deepEqual(node(g, 'b').first, ['a']);
});

test('same-level links are never "read first"', () => {
  const g = buildGraph([concept('a', 'data', 'intermediate', ['b']), concept('b', 'data', 'intermediate', ['a'])], []);
  assert.deepEqual(node(g, 'a').first, []);
  assert.deepEqual(node(g, 'b').first, []);
});

test('links to unknown slugs, patterns and self are ignored', () => {
  const c = concept('a', 'data', 'advanced', ['a', 'ghost']);
  c.data.related.push({ kind: 'pattern', slug: 'a' });
  const g = buildGraph([c, concept('b', 'data', 'beginner')], []);
  assert.deepEqual(node(g, 'a').first, []);
});

test('read first is limited to the 4 best connected easier concepts, ties by slug', () => {
  const easy = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => concept(id, 'data', 'beginner'));
  const hard = concept('h', 'data', 'advanced', easy.map((e) => e.id));
  const extra = concept('x', 'data', 'intermediate', ['e5']); // e5 now has the highest degree
  const g = buildGraph([...easy, hard, extra], []);
  assert.deepEqual(node(g, 'h').first, ['e5', 'e1', 'e2', 'e3']);
});

test('studies are attached to the concepts they teach, once each, sorted by name', () => {
  const g = buildGraph(
    [concept('a', 'data', 'beginner'), concept('b', 'data', 'beginner')],
    [study('z', 'a', 'a'), study('m', 'a', 'b')],
  );
  assert.deepEqual(node(g, 'a').studies.map((s) => s.slug), ['m', 'z']);
  assert.deepEqual(node(g, 'b').studies.map((s) => s.slug), ['m']);
  assert.equal(node(g, 'a').studies[0].href, '/case-studies/m/');
});

test('node fields come from the data', () => {
  const [n] = buildGraph([concept('a', 'data', 'beginner')], []);
  assert.deepEqual({ slug: n.slug, name: n.name, area: n.area, level: n.level, href: n.href }, { slug: 'a', name: 'A', area: 'data', level: 'beginner', href: '/concepts/a/' });
});
