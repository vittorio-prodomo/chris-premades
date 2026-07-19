import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModifierFormula } from './rollUtils.buildModifierFormula.mjs';

const die = (expression, { flavor = null, isDeterministic = false, formula = expression } = {}) =>
    ({ expression, formula, flavor, isDeterministic });

test('appends modifier + source flavor to a bare die', () => {
    const terms = [die('2d4')];
    assert.equal(buildModifierFormula(terms, 'r1', 'Healer'), '2d4r1[Healer]');
});

test('preserves an existing type flavor, combining with the source', () => {
    const terms = [die('3d6', { flavor: 'fire' })];
    assert.equal(buildModifierFormula(terms, 'r1', 'Elemental Adept'), '3d6r1[fire · Elemental Adept]');
});

test('deterministic terms pass through untouched', () => {
    const terms = [die('2d4'), die(' + ', { isDeterministic: true }), die('4', { isDeterministic: true })];
    assert.equal(buildModifierFormula(terms, 'r1', 'Healer'), '2d4r1[Healer] + 4');
});

test('idempotent: a term already carrying the modifier is left as its formula', () => {
    const terms = [die('2d4r1', { formula: '2d4r1' })];
    assert.equal(buildModifierFormula(terms, 'r1', 'Healer'), '2d4r1');
});

test('works for the min3 floor modifier too', () => {
    const terms = [die('2d6')];
    assert.equal(buildModifierFormula(terms, 'min3', 'Great Weapon Fighting'), '2d6min3[Great Weapon Fighting]');
});
