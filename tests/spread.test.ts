import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spread, type Wanted } from '../src/spread.ts';

const opts = { pad: 8, top: 0, maxHeight: 600 };
const overlap = (a: Wanted, pa: { x: number; y: number }, b: Wanted, pb: { x: number; y: number }, pad: number) =>
  (a.w + b.w) / 2 + pad > Math.abs(pa.x - pb.x) + 1e-6 && (a.h + b.h) / 2 + pad > Math.abs(pa.y - pb.y) + 1e-6;

test('boxes that already fit stay where the author put them', () => {
  const items = [{ fx: 0.2, fy: 0.2, w: 40, h: 20 }, { fx: 0.8, fy: 0.8, w: 40, h: 20 }];
  const { pos, height } = spread(items, 400, 300, opts);
  assert.deepEqual(pos, [{ x: 80, y: 60 }, { x: 320, y: 240 }]);
  assert.equal(height, 300);
});

test('boxes stacked on one spot are pushed apart and stay inside the stage', () => {
  const items: Wanted[] = Array.from({ length: 4 }, () => ({ fx: 0.5, fy: 0.5, w: 80, h: 30 }));
  const width = 200;
  const { pos, height } = spread(items, width, 200, opts);
  for (let i = 0; i < items.length; i++) {
    assert.ok(pos[i].x >= items[i].w / 2 && pos[i].x <= width - items[i].w / 2, `box ${i} inside sideways`);
    assert.ok(pos[i].y >= items[i].h / 2 && pos[i].y + items[i].h / 2 <= height, `box ${i} inside the stage`);
    for (let j = i + 1; j < items.length; j++) assert.ok(!overlap(items[i], pos[i], items[j], pos[j], opts.pad), `boxes ${i} and ${j} apart`);
  }
});

test('the stage grows to fit but never past maxHeight', () => {
  const items: Wanted[] = Array.from({ length: 10 }, () => ({ fx: 0.5, fy: 0.1, w: 150, h: 60 }));
  const tall = spread(items, 160, 100, { ...opts, maxHeight: 2000 });
  assert.ok(tall.height > 100);
  const capped = spread(items, 160, 100, { ...opts, maxHeight: 150 });
  assert.equal(capped.height, 150);
});

test('boxes that are never on screen together may share a spot', () => {
  const items: Wanted[] = [{ fx: 0.5, fy: 0.5, w: 80, h: 30 }, { fx: 0.5, fy: 0.5, w: 80, h: 30 }];
  const { pos } = spread(items, 300, 200, { ...opts, together: () => false });
  assert.deepEqual(pos[0], pos[1]);
});

test('the top margin keeps the first row clear', () => {
  const { pos } = spread([{ fx: 0.5, fy: 0, w: 40, h: 20 }], 200, 100, { ...opts, top: 25 });
  assert.equal(pos[0].y, 35);
});

test('no items gives an empty layout at the base height', () => {
  assert.deepEqual(spread([], 200, 120, opts), { pos: [], height: 120 });
});

test('a box placed at the edge is pulled back inside, on both sides', () => {
  const { pos } = spread([{ fx: 0, fy: 0.5, w: 60, h: 20 }, { fx: 1, fy: 0.9, w: 60, h: 20 }], 200, 100, opts);
  assert.equal(pos[0].x, 30);
  assert.equal(pos[1].x, 170);
});
