import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNewSize, classifyWillingTarget } from './enlargeReduceRules.mjs';

const FRIENDLY = 1, NEUTRAL = 0, HOSTILE = -1, SECRET = -2;

test('enlarge steps one size up through the whole ladder', () => {
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'tiny', hasRoom: true}), 'sm');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'sm', hasRoom: true}), 'med');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'med', hasRoom: true}), 'lg');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'lg', hasRoom: true}), 'huge');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'huge', hasRoom: true}), 'grg');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'grg', hasRoom: true}), 'grg', 'already at the top');
});

test('enlarge from medium and up needs room; tiny/small never do (same footprint)', () => {
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'med', hasRoom: false}), 'med');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'lg', hasRoom: false}), 'lg');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'sm', hasRoom: false}), 'med');
    assert.equal(resolveNewSize({selection: 'enlarge', size: 'tiny', hasRoom: false}), 'sm');
});

test('reduce steps one size down and stops at tiny', () => {
    assert.equal(resolveNewSize({selection: 'reduce', size: 'grg'}), 'huge');
    assert.equal(resolveNewSize({selection: 'reduce', size: 'med'}), 'sm');
    assert.equal(resolveNewSize({selection: 'reduce', size: 'sm'}), 'tiny');
    assert.equal(resolveNewSize({selection: 'reduce', size: 'tiny'}), 'tiny');
});

test('the caster is trivially willing toward themself, whatever the disposition', () => {
    assert.equal(classifyWillingTarget({disposition: HOSTILE, friendly: FRIENDLY, isCaster: true}), 'caster');
});

test('a friendly token gets the willing offer', () => {
    assert.equal(classifyWillingTarget({disposition: FRIENDLY, friendly: FRIENDLY, isCaster: false}), 'friendly');
});

test('neutral, hostile and secret tokens roll the save as usual', () => {
    for (const disposition of [NEUTRAL, HOSTILE, SECRET]) {
        assert.equal(classifyWillingTarget({disposition, friendly: FRIENDLY, isCaster: false}), 'other');
    }
});
