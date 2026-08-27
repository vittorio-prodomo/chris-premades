import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingUses } from './resourceSpend.mjs';

test('reports what is left of a limited resource', () => {
    assert.equal(remainingUses({spent: 1, max: 4}), 3);
    assert.equal(remainingUses({spent: 4, max: 4}), 0);
});

test('never reports a negative remainder, and tolerates missing data', () => {
    assert.equal(remainingUses({spent: 9, max: 4}), 0);
    assert.equal(remainingUses(undefined), null);
    assert.equal(remainingUses({spent: 1}), null);
});
