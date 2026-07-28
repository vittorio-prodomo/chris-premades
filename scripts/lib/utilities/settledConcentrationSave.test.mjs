import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSettledConcentrationSave } from './settledConcentrationSave.mjs';

const concentration = { hookNames: ['save', 'concentration'] };
const ordinarySave = { hookNames: ['save'] };
const roll = (target, isSuccess) => ({ options: { target }, isSuccess });

test('a concentration save that already succeeded is settled', () => {
    assert.equal(isSettledConcentrationSave(concentration, roll(10, true)), true);
});

test('a failed concentration save still wants its offer', () => {
    assert.equal(isSettledConcentrationSave(concentration, roll(10, false)), false);
});

test('an ordinary successful save is NOT settled — suppressing it would leak the outcome', () => {
    assert.equal(isSettledConcentrationSave(ordinarySave, roll(10, true)), false);
});

test('fails open when the roll has no DC to compare against', () => {
    assert.equal(isSettledConcentrationSave(concentration, roll(undefined, true)), false);
    assert.equal(isSettledConcentrationSave(concentration, { isSuccess: true }), false);
});

test('fails open on an undecided or missing isSuccess', () => {
    assert.equal(isSettledConcentrationSave(concentration, roll(10, undefined)), false);
    assert.equal(isSettledConcentrationSave(concentration, { options: { target: 10 } }), false);
});

test('fails open on missing/odd config and roll shapes', () => {
    assert.equal(isSettledConcentrationSave(undefined, roll(10, true)), false);
    assert.equal(isSettledConcentrationSave({}, roll(10, true)), false);
    assert.equal(isSettledConcentrationSave({ hookNames: 'concentration' }, roll(10, true)), false);
    assert.equal(isSettledConcentrationSave(concentration, undefined), false);
});

test('a NaN target is not a usable DC', () => {
    assert.equal(isSettledConcentrationSave(concentration, roll(Number.NaN, true)), false);
});
