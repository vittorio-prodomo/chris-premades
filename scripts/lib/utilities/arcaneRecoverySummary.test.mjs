import test from 'node:test';
import assert from 'node:assert';
import {arcaneRecoverySummary} from './arcaneRecoverySummary.mjs';

// A plain label stand-in for CONFIG.DND5E.spellLevels, which is localized and
// lives outside this module so the helper stays testable.
const label = (level) => `${level}${{1: 'st', 2: 'nd', 3: 'rd'}[level] ?? 'th'} Level`;

test('lists a single recovered slot', () => {
    let html = arcaneRecoverySummary({recovered: [{level: 1, amount: 1}], allowed: 3, label});
    assert.match(html, /1st Level/);
    assert.match(html, /1 of 3/);
});

test('lists several levels, lowest first, with counts', () => {
    let html = arcaneRecoverySummary({
        recovered: [{level: 2, amount: 1}, {level: 1, amount: 2}],
        allowed: 4,
        label
    });
    assert.match(html, /1st Level[^<]*×\s*2/);
    assert.match(html, /2nd Level[^<]*×\s*1/);
    assert.ok(html.indexOf('1st Level') < html.indexOf('2nd Level'), 'ascending by level');
    // 2 slots at level 1 plus 1 at level 2 = 4 slot levels
    assert.match(html, /4 of 4/);
});

test('drops levels the player took none of', () => {
    let html = arcaneRecoverySummary({
        recovered: [{level: 1, amount: 0}, {level: 3, amount: 1}],
        allowed: 3,
        label
    });
    assert.doesNotMatch(html, /1st Level/);
    assert.match(html, /3rd Level/);
});

test('recovering nothing produces nothing at all', () => {
    assert.equal(arcaneRecoverySummary({recovered: [], allowed: 3, label}), null);
    assert.equal(arcaneRecoverySummary({recovered: [{level: 1, amount: 0}], allowed: 3, label}), null);
});

test('reports fewer levels used than allowed without complaint', () => {
    // the player may deliberately bank less than the maximum
    let html = arcaneRecoverySummary({recovered: [{level: 1, amount: 1}], allowed: 5, label});
    assert.match(html, /1 of 5/);
});

test('⚠️ escapes the label — it reaches the card as markup', () => {
    let evil = () => '<img src=x onerror=alert(1)>';
    let html = arcaneRecoverySummary({recovered: [{level: 1, amount: 1}], allowed: 1, label: evil});
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
});
