import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedDieKeys } from './dieSelection.mjs';

test('an expired dialog selects nothing instead of throwing', () => {
    // DialogApp resolves to null when its timeout elapses (added with the 30s
    // auto-decline). Reading `.buttons` off that null is what crashed the
    // Heroic Inspiration offer mid-roll.
    assert.equal(selectedDieKeys(null), undefined);
    assert.equal(selectedDieKeys(undefined), undefined);
});

test('declining selects nothing', () => {
    assert.equal(selectedDieKeys({buttons: false}), undefined);
});

test('confirming returns only the ticked dice, without the button key', () => {
    assert.deepEqual(
        selectedDieKeys({buttons: true, '0-1-0': true, '0-1-1': false, '0-2-0': true}),
        ['0-1-0', '0-2-0']
    );
});
