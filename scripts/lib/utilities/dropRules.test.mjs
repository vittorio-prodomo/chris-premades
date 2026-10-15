import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropHeight, heightDC, fallDiceCount, landingSplit, landingMissDamage, plungeSplit, sizeIndex, aimMode, knockedProne, landingOutcome, isAdjacent } from './dropRules.mjs';

test('height is faller minus target; level or higher target is unknown', () => {
    assert.equal(dropHeight(25, 0), 25);
    assert.equal(dropHeight(10, 10), null);
    assert.equal(dropHeight(0, 15), null);
    assert.equal(dropHeight(undefined, 0), null);
});

test('the height DC table, including the +2 per further 10 ft', () => {
    for (let [h, dc] of [[5, 10], [10, 10], [20, 10], [21, 13], [30, 13], [31, 15], [40, 15], [41, 17], [50, 17], [51, 19], [60, 19]]) assert.equal(heightDC(h), dc, `${h} ft`);
});

test('fall dice: 1d6 per FULL 10 ft', () => {
    assert.deepEqual([9, 10, 19, 20, 35].map(fallDiceCount), [0, 1, 1, 2, 3]);
});

test('landing hit: no damage at 10 ft or less, 2/3 vs 1/3 above (faller rounded down)', () => {
    assert.deepEqual(landingSplit(10, 6), {target: 0, faller: 0});
    assert.deepEqual(landingSplit(30, 12), {target: 8, faller: 4});
    assert.deepEqual(landingSplit(20, 7), {target: 5, faller: 2});
    assert.deepEqual(landingSplit(20, 2), {target: 2, faller: 0});
});

test('landing miss: full damage above 10 ft, none at 10 ft or less', () => {
    assert.equal(landingMissDamage(10, 5), 0);
    assert.equal(landingMissDamage(15, 5), 5);
});

test('plunge hit: all to the target up to 20 ft, 2/3 vs 1/3 above', () => {
    assert.deepEqual(plungeSplit(20, 9), {target: 9, faller: 0});
    assert.deepEqual(plungeSplit(30, 12), {target: 8, faller: 4});
});

test('size: advantage vs larger, disadvantage vs smaller, prone unless two or more sizes larger', () => {
    assert.equal(sizeIndex('med'), 2);
    assert.equal(aimMode('med', 'lg'), 'advantage');
    assert.equal(aimMode('med', 'sm'), 'disadvantage');
    assert.equal(aimMode('med', 'med'), 'normal');
    assert.equal(knockedProne('med', 'lg'), true);
    assert.equal(knockedProne('med', 'huge'), false);
    assert.equal(knockedProne('sm', 'huge'), false);
    assert.equal(knockedProne('lg', 'tiny'), true);
});

test('landing outcome: below DC misses; undetected hits; a save meeting the DC dodges', () => {
    assert.equal(landingOutcome({aimTotal: 9, dc: 10, undetected: true, dodgeSave: null}), 'miss');
    assert.equal(landingOutcome({aimTotal: 15, dc: 10, undetected: true, dodgeSave: null}), 'hit');
    assert.equal(landingOutcome({aimTotal: 15, dc: 10, undetected: false, dodgeSave: null}), 'hit');
    assert.equal(landingOutcome({aimTotal: 15, dc: 10, undetected: false, dodgeSave: 15}), 'dodged');
    assert.equal(landingOutcome({aimTotal: 15, dc: 10, undetected: false, dodgeSave: 14}), 'hit');
});

test('adjacency: touching (incl. diagonals) but never overlapping', () => {
    let target = {x: 5, y: 5, w: 1, h: 1};
    assert.equal(isAdjacent({x: 4, y: 4, w: 1, h: 1}, target), true);
    assert.equal(isAdjacent({x: 6, y: 5, w: 1, h: 1}, target), true);
    assert.equal(isAdjacent({x: 5, y: 5, w: 1, h: 1}, target), false);
    assert.equal(isAdjacent({x: 7, y: 5, w: 1, h: 1}, target), false);
    assert.equal(isAdjacent({x: 3, y: 5, w: 2, h: 2}, {x: 5, y: 5, w: 2, h: 2}), true);
});
