import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesFor, numbered, pad, words } from '../src/format.ts';
import { base, url } from '../src/url.ts';

test('pad makes two digits', () => {
  assert.equal(pad(0), '00'); assert.equal(pad(7), '07'); assert.equal(pad(12), '12'); assert.equal(pad(123), '123');
});

test('numbered skips falsy entries and numbers what remains in order', () => {
  assert.deepEqual(numbered([['a', 'A'], false, ['b', 'B'], undefined, null, ['c', 'C']]), [
    { id: 'a', label: 'A', num: '01' }, { id: 'b', label: 'B', num: '02' }, { id: 'c', label: 'C', num: '03' },
  ]);
  assert.deepEqual(numbered([]), []);
});

test('words counts strings, arrays and nested objects but not slugs, hrefs, answer or pick', () => {
  assert.equal(words('one  two\nthree'), 3);
  assert.equal(words(''), 0);
  assert.equal(words(['a b', ['c']]), 3);
  assert.equal(words({ text: 'a b c', slug: 'ignored words here', href: 'x y', answer: 3, pick: 'two words', nested: { more: 'd e' } }), 5);
  assert.equal(words(42), 0);
  assert.equal(words(null), 0);
});

test('minutesFor = reading time (200 wpm, rounded up) plus time for the simulation and quiz', () => {
  const text = (n: number) => Array(n).fill('w').join(' ');
  assert.equal(minutesFor('concept', text(200)), 1 + 3);
  assert.equal(minutesFor('concept', text(201)), 2 + 3);
  assert.equal(minutesFor('pattern', ''), 3);
  assert.equal(minutesFor('study', text(400)), 2 + 8);
});

test('url joins the base path and strips a leading slash (no base under plain Node)', () => {
  assert.equal(base, '');
  assert.equal(url('concepts/a/'), '/concepts/a/');
  assert.equal(url('/concepts/a/'), '/concepts/a/');
  assert.equal(url(''), '/');
});
