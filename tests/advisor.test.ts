import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { stem, tokens, detect, closest, type Need, type Doc } from '../src/advisor.ts';
import { advisorNeeds } from '../src/data/advisorNeeds.ts';

const need = (id: string, ...words: string[]): Need => ({ id, label: id, why: '', words, use: [] });
const found = (text: string, needs = advisorNeeds) => [...detect(text, needs).keys()];

test('tokens: lower case, stemmed, split at punctuation and hyphens', () => {
  assert.deepEqual(tokens('Real-time Payments, queues & caching!'), ['real', 'time', 'payment', 'queue', 'cach']);
  assert.equal(stem('class'), 'class', 'a double s is not a plural');
  assert.equal(stem('queries'), 'query');
});

test('detect: a need is found by any of its words, whatever the word form', () => {
  const needs = [need('pay', 'payment', 'credit card'), need('live', 'real time')];
  assert.deepEqual([...detect('Customers make payments by Credit Cards.', needs)], [['pay', ['payment', 'credit card']]]);
  assert.deepEqual(found('updates in real-time', needs), ['live'], 'a hyphen is a space');
  assert.deepEqual(found('', needs), []);
});

test('detect: whole words only, and a phrase needs its words side by side', () => {
  const needs = [need('form', 'form'), need('card', 'credit card')];
  assert.deepEqual(found('a platform that transforms data', needs), [], '"form" inside another word is not the word');
  assert.deepEqual(found('credit for every card', needs), []);
});

test('the site needs: everyday descriptions tick what a person would expect', () => {
  const delivery = found('A food delivery app: customers order from restaurants, pay in the app, and track the courier on a map');
  for (const id of ['payments', 'location']) assert.ok(delivery.includes(id), `food delivery should need ${id}`);
  assert.ok(found('a team edits the same document together and sees each other typing').includes('collaboration'));
  assert.ok(found('A contact form that emails me what people submit').includes('forms'));
  assert.ok(found('A contact form that emails me what people submit').includes('notifications'));
  assert.ok(found('A chatbot that answers questions about our company documents').includes('ai'));
});

test('the site needs: common words do not tick a need by accident', () => {
  assert.deepEqual(found('An app like Uber, in order to store the rest of my data and grow fast'), []);
  assert.deepEqual(found('I want to build something for people'), []);
});

test('the site needs: every recommendation is a page, every word is usable', () => {
  const folder = { concept: 'concepts', pattern: 'patterns', study: 'studies' } as const;
  const ids = new Set<string>();
  for (const n of advisorNeeds) {
    assert.ok(!ids.has(n.id), `need id "${n.id}" is used twice`); ids.add(n.id);
    assert.ok(n.label && n.why && n.words.length && n.use.length, `need "${n.id}" is incomplete`);
    for (const u of n.use) assert.ok(existsSync(new URL(`../src/content/${folder[u.kind]}/${u.slug}/meta.json`, import.meta.url)), `need "${n.id}": no ${u.kind} "${u.slug}"`);
    assert.equal(new Set(n.use.map((u) => `${u.kind}/${u.slug}`)).size, n.use.length, `need "${n.id}" recommends a page twice`);
    for (const w of n.words) {
      assert.equal(w, w.toLowerCase().trim(), `need "${n.id}": write "${w}" in lower case`);
      assert.ok(/^[a-z0-9 ]+$/.test(w), `need "${n.id}": "${w}" should be plain words (a hyphen is a space)`);
      assert.deepEqual(found(w, [n]), [n.id], `need "${n.id}": the word "${w}" does not find it`);
    }
  }
});

const doc = (key: string, name: string, body: string): Doc => ({ key, name: tokens(name), body: tokens(body) });
const docs = [
  doc('chat', 'Chat system', 'Design a chat app where people send messages to each other and see who is online'),
  doc('tickets', 'Ticket booking', 'Design a system that sells seats for concerts without selling a seat twice'),
  doc('shortener', 'URL shortener', 'Design a service that turns a long link into a short one and counts the clicks'),
];

test('closest: the pages that share the most telling words, best first', () => {
  const m = closest('I want to sell concert seats online', docs, 5);
  assert.equal(m[0].key, 'tickets');
  assert.deepEqual(m[0].shared.sort(), ['concert', 'seat', 'sell']);
  assert.ok(!m.some((x) => x.key === 'shortener'));
});

test('closest: a word in the name counts for more than one in the text', () => {
  const m = closest('send messages and booking', docs, 5);
  assert.deepEqual(m.map((x) => x.key), ['tickets', 'chat'], '"booking" is in a name; "send" and "messages" are only in a text');
});

test('closest: everyday words alone match nothing, and the limit holds', () => {
  assert.deepEqual(closest('I want to build an app for people', docs, 5), []);
  assert.deepEqual(closest('', docs, 5), []);
  assert.equal(closest('chat ticket url', docs, 2).length, 2);
});

test('closest: one shared word deep in a text is not a match, and weak matches are not listed beside a strong one', () => {
  assert.deepEqual(closest('a link for my garden', docs, 5), [], '"link" is only in the shortener text');
  assert.deepEqual(closest('chat system with messages for people online, and a link', docs, 5).map((x) => x.key), ['chat']);
});
