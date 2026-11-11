import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claims, shown, parseSteps } from '../scripts/walkthrough-steps.mjs';

// A small simulation: the controls and buttons as the page describes them to the walkthrough check.
const slider = (label: string, min: number, max: number, step = 1) => ({ kind: 'range', label, min: String(min), max: String(max), step: String(step) });
const select = (label: string, ...texts: string[]) => ({ kind: 'select', label, options: texts.map((text, i) => ({ value: `o${i}`, text })) });
const box = (label: string) => ({ kind: 'checkbox', label });
const RATE = 0, LAG = 1, POLICY = 2, SHARDS = 3, PREFILL = 4, QUERY = 5, AGENTS = 6;
const controls = [
  slider('Rate limit (requests)', 100, 1000, 100),
  slider('Lag (ms)', 0, 1000, 100),
  select('Policy', 'Unbounded queue', 'Bounded queue, reject fast', 'Divert overflow to a provider'),
  select('Shards', '1', '4', '8', '16'),
  box('Chunked prefill'),
  { kind: 'text', label: 'Query' },
  slider('Agents', 1, 20),
];
const RESET = 0, RUN = 1, SEND = 2;
const buttons = [{ text: 'Reset' }, { text: 'Run' }, { text: 'Send' }];

const press = (b: number, times = 1) => ({ type: 'press', b, times });
const set = (c: number, value: unknown) => ({ type: 'set', c, value });
// The actions of a one-sentence step.
const script = (step: string, withControls: object[] = controls, withButtons = buttons) => parseSteps([step], withControls, withButtons).parsed[0].flat();

test('claims: the numbers a step quotes', () => {
  const found = claims('At p99 the 2024 run of 3 nodes shows about 300 ms, 1,819 ms and 68.6 %, over HTTP2.');
  assert.deepEqual(found.map((c: { raw: string }) => c.raw), ['300', '1,819', '68.6'], 'names, years and small counts are not claims');
  assert.deepEqual(found.map((c: { approx: boolean }) => c.approx), [true, false, false]);
  assert.deepEqual(claims('It drops to 0.5 s.').map((c: { value: number; decimals: number }) => [c.value, c.decimals]), [[0.5, 1]], 'a small number with decimals is a claim');
});

test('shown: exact for plain numbers, rounded to the quoted decimals, 5% either way after "about"', () => {
  const [about, plain, decimal] = claims('about 300 ms, 1,819 ms and 68.6 %');
  assert.ok(shown(plain, [7, 1819]));
  assert.ok(!shown(plain, [1818, 1820, 1819.4]), 'a plain number must be shown exactly');
  assert.ok(shown(decimal, [68.57]), '68.57 on the page reads as 68.6');
  assert.ok(!shown(decimal, [68.66, 69]));
  assert.ok(shown(about, [288]) && shown(about, [315]));
  assert.ok(!shown(about, [284]) && !shown(about, [316]));
});

test('buttons are pressed in the order the step names them', () => {
  assert.deepEqual(script('Press Reset, then raise the rate limit to 400 and press Run.'), [press(RESET), set(RATE, 400), press(RUN)]);
  assert.deepEqual(script('Press Send twice.'), [press(SEND, 2)]);
  assert.deepEqual(script('Press Send 3 times.'), [press(SEND, 3)]);
  assert.deepEqual(script('Change the policy without pressing Run.'), [], '"without pressing" presses nothing');
});

test('a slider is set by the number after its label, or just before it', () => {
  assert.deepEqual(script('Set the lag to 500 ms.'), [set(LAG, 500)]);
  assert.deepEqual(script('Put 12 agents on it.'), [set(AGENTS, 12)]);
  assert.deepEqual(script('To 500 ms.'), [set(LAG, 500)], 'a bare number goes to the one slider in that unit');
  assert.deepEqual(script('Set the agents to 50.'), [], 'a number outside the slider is not a setting');
  assert.deepEqual(script('Set the lag to 250 ms.'), [], 'nor one between its steps');
});

test('numbers that describe a result are not settings', () => {
  assert.deepEqual(script('Set the lag to 500 ms: the queue grows to 800 requests.'), [set(LAG, 500)], 'after the colon is the result');
  assert.deepEqual(script('The load drops from 400 to 300 requests.'), []);
  assert.deepEqual(script('The lag can rise up to 300 ms.'), []);
});

test('an option is chosen by its text, its first words or its number', () => {
  assert.deepEqual(script('Switch to bounded queue, reject fast: about 75% are answered.'), [set(POLICY, 'o1')]);
  assert.deepEqual(script('Now divert overflow.'), [set(POLICY, 'o2')]);
  assert.deepEqual(script('Choose 8 shards and press Run.'), [set(SHARDS, 'o2'), press(RUN)]);
  assert.deepEqual(script('Set shards to 16.'), [set(SHARDS, 'o3')]);
});

test('boxes are ticked and unticked', () => {
  assert.deepEqual(script('Tick Chunked prefill.'), [set(PREFILL, true)]);
  assert.deepEqual(script('Untick Chunked prefill.'), [set(PREFILL, false)], 'the second word of the label does not tick it again');
  assert.deepEqual(script('Turn Chunked prefill off.'), [set(PREFILL, false)]);
});

test('a word shared by two boxes ticks only the one whose whole label is written', () => {
  const two = [box('Readiness checks the database'), box('Liveness checks the database')];
  assert.deepEqual(script('Now tick liveness checks the database too.', two), [set(1, true)]);
});

test('a box named by part of its label follows the verb', () => {
  const dims = [select('Strategy', 'Type 1 (overwrite)', 'Type 2 (history)'), box('Use the effective date for late changes'), box('Track tier changes')];
  assert.deepEqual(script('Choose Type 2 (history) and untick Use the effective date.', dims), [set(0, 'o1'), set(1, false)]);
  assert.deepEqual(script('Untick Track tier changes.', dims), [set(2, false)], '"changes" is not the other box');
  const oauth = [box('PKCE (S256), required by the server'), box('Client checks state')];
  assert.deepEqual(script('Untick state and PKCE still stops it.', oauth), [set(1, false), set(0, true)], 'only the first is unticked');
});

test('text is typed into a text box', () => {
  assert.deepEqual(script('Set Query to red apple juice and press Run.'), [set(QUERY, 'red apple juice'), press(RUN)]);
});

test('"repeat" presses again what the step pressed, after its Reset', () => {
  const { parsed } = parseSteps(['Press Run. Repeat from Reset with 8 shards.'], controls, buttons);
  assert.deepEqual(parsed[0], [[press(RUN)], [press(RESET), set(SHARDS, 'o2'), press(RUN)]]);
});

test('a step that names no button continues with the one the last step pressed', () => {
  const { parsed } = parseSteps(['Press Run.', 'Set shards to 4.', 'The result stays the same.'], controls, buttons);
  assert.deepEqual(parsed, [[[press(RUN)]], [[set(SHARDS, 'o1'), press(RUN)]], [[]]]);
});

test('typed lists what the scripts put into sliders and text boxes', () => {
  const { typed } = parseSteps(['Set the lag to 500 ms and choose 8 shards.', 'Set Query to red apple juice.'], controls, buttons);
  assert.deepEqual(typed, [{ step: 0, value: 500, label: 'lag (ms)' }, { step: 1, value: 'red apple juice', label: 'query' }]);
});
