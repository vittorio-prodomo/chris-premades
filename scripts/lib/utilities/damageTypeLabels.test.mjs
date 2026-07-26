import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDamageLabel } from './damageTypeLabels.mjs';

// Mirrors the live world: these keys do not exist, and the config carries the localized name.
const has = () => false;
const types = {
    bludgeoning: {label: 'Bludgeoning'},
    piercing: {label: 'Piercing'},
    slashing: {label: 'Slashing'},
    fire: {label: 'Fire'}
};

test('resolves the legacy keys that Primal Companion renders raw (T72)', () => {
    assert.equal(resolveDamageLabel('DND5E.DamageBludgeoning', {has, types}), 'Bludgeoning');
    assert.equal(resolveDamageLabel('DND5E.DamagePiercing', {has, types}), 'Piercing');
    assert.equal(resolveDamageLabel('DND5E.DamageSlashing', {has, types}), 'Slashing');
});

test('returns whatever the config holds, so a translated world gets its own language', () => {
    const italian = {bludgeoning: {label: 'Contundenti'}};
    assert.equal(resolveDamageLabel('DND5E.DamageBludgeoning', {has, types: italian}), 'Contundenti');
});

test('self-disables when the key actually resolves through i18n', () => {
    const hasKey = k => k === 'DND5E.DamageFire';
    assert.equal(resolveDamageLabel('DND5E.DamageFire', {has: hasKey, types}), 'DND5E.DamageFire');
});

test('leaves unrelated labels alone', () => {
    assert.equal(resolveDamageLabel('CHRISPREMADES.Dialog.DamageType', {has, types}), 'CHRISPREMADES.Dialog.DamageType');
    assert.equal(resolveDamageLabel('Bludgeoning', {has, types}), 'Bludgeoning');
    assert.equal(resolveDamageLabel('', {has, types}), '');
});

test('a picker never loses a button when the type is unknown or the config is missing', () => {
    assert.equal(resolveDamageLabel('DND5E.DamageWibble', {has, types}), 'DND5E.DamageWibble');
    assert.equal(resolveDamageLabel('DND5E.DamageFire', {has, types: {}}), 'DND5E.DamageFire');
    assert.equal(resolveDamageLabel('DND5E.DamageFire', {has}), 'DND5E.DamageFire');
    assert.equal(resolveDamageLabel('DND5E.DamageFire'), 'DND5E.DamageFire');
    assert.equal(resolveDamageLabel('DND5E.DamageFire', {has, types: {fire: {}}}), 'DND5E.DamageFire');
    assert.equal(resolveDamageLabel('DND5E.DamageFire', {has, types: {fire: {label: ''}}}), 'DND5E.DamageFire');
});

test('passes non-string labels through untouched', () => {
    assert.equal(resolveDamageLabel(undefined, {has, types}), undefined);
    assert.equal(resolveDamageLabel(null, {has, types}), null);
    assert.equal(resolveDamageLabel(42, {has, types}), 42);
});
