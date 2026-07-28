import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_DIRECTION_MODES, isDirectionalTemplate, resolvePushAngle } from './pushDirection.mjs';

const source = {x: 1000, y: 1000};
const east = {x: 1100, y: 1000};
const south = {x: 1000, y: 1100};
const cone = {t: 'cone', direction: 90};

test('radial mode ignores the template and points source -> target', () => {
    const angle = resolvePushAngle({mode: 'radial', template: cone, sourceCenter: source, targetCenter: east});
    assert.equal(angle, null, 'null means "keep the stock caster-to-target ray"');
});

test('parallel mode returns the template direction in radians', () => {
    const angle = resolvePushAngle({mode: 'parallel', template: cone, sourceCenter: source, targetCenter: east});
    assert.equal(angle, Math.PI / 2);
});

test('every target of one cast gets the SAME angle regardless of where it stands', () => {
    const a = resolvePushAngle({mode: 'parallel', template: cone, sourceCenter: source, targetCenter: east});
    const b = resolvePushAngle({mode: 'parallel', template: cone, sourceCenter: source, targetCenter: south});
    assert.equal(a, b, 'that is the whole point of the BG3 feel');
});

test('a ray template is directional (a self-origin cube is a fat ray)', () => {
    assert.equal(isDirectionalTemplate({t: 'ray', direction: 0}), true);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'ray', direction: 180}, sourceCenter: source, targetCenter: east}), Math.PI);
});

test('a circle template is NOT directional — a burst keeps shoving outward', () => {
    assert.equal(isDirectionalTemplate({t: 'circle', direction: 45}), false);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'circle', direction: 45}, sourceCenter: source, targetCenter: east}), null);
});

test('a rect template is NOT directional', () => {
    assert.equal(isDirectionalTemplate({t: 'rect', direction: 45}), false);
});

test('no template at all falls back to radial', () => {
    assert.equal(resolvePushAngle({mode: 'parallel', sourceCenter: source, targetCenter: east}), null);
    assert.equal(resolvePushAngle({mode: 'parallel', template: null, sourceCenter: source, targetCenter: east}), null);
});

test('a template with an unusable direction falls back to radial', () => {
    assert.equal(isDirectionalTemplate({t: 'cone'}), false);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'cone'}, sourceCenter: source, targetCenter: east}), null);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'cone', direction: NaN}, sourceCenter: source, targetCenter: east}), null);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'cone', direction: '90'}, sourceCenter: source, targetCenter: east}), null);
});

test('direction 0 is a real direction, not a missing one', () => {
    assert.equal(isDirectionalTemplate({t: 'cone', direction: 0}), true);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'cone', direction: 0}, sourceCenter: source, targetCenter: east}), 0);
});

test('an unset / unknown mode is treated as radial', () => {
    assert.equal(resolvePushAngle({template: cone, sourceCenter: source, targetCenter: east}), null);
    assert.equal(resolvePushAngle({mode: undefined, template: cone, sourceCenter: source, targetCenter: east}), null);
    assert.equal(resolvePushAngle({mode: 'sideways', template: cone, sourceCenter: source, targetCenter: east}), null);
});

test('negative and >360 directions normalise into radians the same way Foundry stores them', () => {
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'ray', direction: 360}, sourceCenter: source, targetCenter: east}), Math.PI * 2);
    assert.equal(resolvePushAngle({mode: 'parallel', template: {t: 'ray', direction: -90}, sourceCenter: source, targetCenter: east}), -Math.PI / 2);
});

test('the mode list is the setting\'s choice list', () => {
    assert.deepEqual(PUSH_DIRECTION_MODES, ['radial', 'parallel']);
});
