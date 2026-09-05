import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTokenSizeUpdate, systemDerivesTokenScale, SIZE_SCALES } from './tokenSizeScale.mjs';

test('a plain token shrinking sm -> tiny scales its texture down relatively', () => {
    const r = resolveTokenSizeUpdate({size: 'tiny', old: 'sm', sourceScaleX: 0.8, systemDerivesScale: false});
    assert.equal(r.sizeDiff, 0);
    assert.deepEqual(r.update, {width: 1, height: 1, texture: {scaleX: 0.5, scaleY: 0.5}});
});

test('a plain token restores EXACTLY after a shrink-then-restore round trip', () => {
    const down = resolveTokenSizeUpdate({size: 'tiny', old: 'sm', sourceScaleX: 0.8, systemDerivesScale: false});
    const up = resolveTokenSizeUpdate({size: 'sm', old: 'tiny', sourceScaleX: down.update.texture.scaleX, systemDerivesScale: false});
    assert.equal(up.update.texture.scaleX, 0.8);
});

test('an UNLINKED ring goblin (source 1, shown at 0.8 by dnd5e) round-trips on the SOURCE value', () => {
    // This is the T219 report: upstream read the derived 0.8 and drifted 0.8 -> 0.4 -> 0.512.
    const down = resolveTokenSizeUpdate({size: 'tiny', old: 'sm', sourceScaleX: 1, systemDerivesScale: false});
    assert.equal(down.update.texture.scaleX, 0.625, 'dnd5e then shows 0.625 * 0.8 = 0.5, the tiny look');
    const up = resolveTokenSizeUpdate({size: 'sm', old: 'tiny', sourceScaleX: down.update.texture.scaleX, systemDerivesScale: false});
    assert.equal(up.update.texture.scaleX, 1, 'back to the source value, shown at 0.8 again');
});

test('a plain token with a custom scale keeps its ratio (1.2 on a medium -> 1.2 * 0.8 on small)', () => {
    const r = resolveTokenSizeUpdate({size: 'sm', old: 'med', sourceScaleX: 1.2, systemDerivesScale: false});
    assert.ok(Math.abs(r.update.texture.scaleX - 0.96) < 1e-9);
});

test('a LINKED ring token never gets a texture scale — dnd5e derives it from the size itself', () => {
    const down = resolveTokenSizeUpdate({size: 'tiny', old: 'sm', sourceScaleX: 1, systemDerivesScale: true});
    assert.deepEqual(down.update, {width: 1, height: 1}, 'footprint only, no texture key at all');
    const up = resolveTokenSizeUpdate({size: 'sm', old: 'tiny', sourceScaleX: 1, systemDerivesScale: true});
    assert.deepEqual(up.update, {width: 1, height: 1});
});

test('a linked ring token growing med -> lg still gets the footprint change', () => {
    const r = resolveTokenSizeUpdate({size: 'lg', old: 'med', sourceScaleX: 1, systemDerivesScale: true});
    assert.equal(r.sizeDiff, 1);
    assert.deepEqual(r.update, {width: 2, height: 2});
});

test('a plain token growing med -> lg changes the footprint but not the scale (both scale 1)', () => {
    const r = resolveTokenSizeUpdate({size: 'lg', old: 'med', sourceScaleX: 1, systemDerivesScale: false});
    assert.deepEqual(r.update, {width: 2, height: 2}, 'no scaleDiff, so no texture write');
});

test('no change at all returns null', () => {
    assert.equal(resolveTokenSizeUpdate({size: 'med', old: 'med', sourceScaleX: 1, systemDerivesScale: false}), null);
});

test('an unknown size key returns null instead of writing NaN', () => {
    assert.equal(resolveTokenSizeUpdate({size: 'colossal', old: 'med', sourceScaleX: 1, systemDerivesScale: false}), null);
    assert.equal(resolveTokenSizeUpdate({size: 'med', old: undefined, sourceScaleX: 1, systemDerivesScale: false}), null);
});

test('a missing source scale writes the footprint only, never NaN', () => {
    const r = resolveTokenSizeUpdate({size: 'tiny', old: 'sm', sourceScaleX: undefined, systemDerivesScale: false});
    assert.deepEqual(r.update, {width: 1, height: 1});
});

test('systemDerivesTokenScale is ring AND linked, nothing less', () => {
    assert.equal(systemDerivesTokenScale({ring: {enabled: true}, actorLink: true}), true);
    assert.equal(systemDerivesTokenScale({ring: {enabled: true}, actorLink: false}), false, 'an unlinked ring token: the delta size never sees the effect');
    assert.equal(systemDerivesTokenScale({ring: {enabled: false}, actorLink: true}), false);
    assert.equal(systemDerivesTokenScale(undefined), false);
});

test('the scale table matches dnd5e\'s dynamicTokenScale (sm 0.8, tiny 0.5, rest 1)', () => {
    assert.deepEqual(SIZE_SCALES, {grg: 1, huge: 1, lg: 1, med: 1, sm: 0.8, tiny: 0.5});
});
