import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabel, patternCategories, patternCategoryIds } from '../src/data/patternCategories.ts';

test('category ids are unique and start with the three Gang of Four groups', () => {
  const ids = patternCategories.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 3), ['creational', 'structural', 'behavioral']);
  assert.deepEqual([...patternCategoryIds], ids);
});

test('every category has a label, a blurb and a colour', () => {
  for (const c of patternCategories) {
    assert.ok(c.label && c.blurb && c.color, `${c.id} is missing a field`);
  }
});

test('categoryLabel names a known category and falls back to the id', () => {
  assert.equal(categoryLabel('enterprise'), 'Enterprise');
  assert.equal(categoryLabel('nope'), 'nope');
});
