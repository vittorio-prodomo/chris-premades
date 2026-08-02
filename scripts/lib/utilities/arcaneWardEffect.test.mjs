import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArcaneWardEffectData} from './arcaneWardEffect.mjs';

const base = {
    name: 'Arcane Ward: 12',
    description: 'Absorbs damage.',
    img: 'icons/feature.webp',
    originUuid: 'Actor.abc.Item.def',
    hp: 12,
    max: 12
};

test('carries the granting feature as origin, which is what the sheet resolves the Source column from', () => {
    assert.equal(buildArcaneWardEffectData(base).origin, 'Actor.abc.Item.def');
});

test('omits origin entirely when no feature uuid is known, rather than writing an unresolvable one', () => {
    const data = buildArcaneWardEffectData({...base, originUuid: undefined});
    assert.equal('origin' in data, false);
});

test('stores the live ward values where the ward macros read them back', () => {
    const data = buildArcaneWardEffectData({...base, hp: 7, max: 12});
    assert.deepEqual(data.flags['chris-premades'].arcaneWard, {hp: 7, max: 12});
});

test('passes the display fields through untouched', () => {
    const data = buildArcaneWardEffectData(base);
    assert.equal(data.name, 'Arcane Ward: 12');
    assert.equal(data.description, 'Absorbs damage.');
    assert.equal(data.img, 'icons/feature.webp');
});

test('keeps a zero-HP ward representable, since 0 is a real ward state and not "missing"', () => {
    const data = buildArcaneWardEffectData({...base, hp: 0});
    assert.equal(data.flags['chris-premades'].arcaneWard.hp, 0);
});
