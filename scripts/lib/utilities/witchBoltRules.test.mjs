import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateEndCondition, shouldOfferSustain} from './witchBoltRules.mjs';

test('in range, no conditions -> spell continues', () => {
    assert.equal(evaluateEndCondition({distance: 30, maxRange: 60, targetStatuses: [], targetPresent: true}), null);
});

test('exactly at max range still continues', () => {
    assert.equal(evaluateEndCondition({distance: 60, maxRange: 60, targetStatuses: [], targetPresent: true}), null);
});

test('beyond max range ends the spell', () => {
    assert.equal(evaluateEndCondition({distance: 60.1, maxRange: 60, targetStatuses: [], targetPresent: true}), 'range');
});

test('total cover ends the spell', () => {
    assert.equal(evaluateEndCondition({distance: 10, maxRange: 60, targetStatuses: ['coverTotal'], targetPresent: true}), 'cover');
});

test('half cover does NOT end the spell', () => {
    assert.equal(evaluateEndCondition({distance: 10, maxRange: 60, targetStatuses: ['coverHalf'], targetPresent: true}), null);
});

test('three-quarters cover does NOT end the spell', () => {
    assert.equal(evaluateEndCondition({distance: 10, maxRange: 60, targetStatuses: ['coverThreeQuarters'], targetPresent: true}), null);
});

test('a dead target ends the spell', () => {
    assert.equal(evaluateEndCondition({distance: 10, maxRange: 60, targetStatuses: ['dead'], targetPresent: true}), 'dead');
});

test('a vanished target ends the spell', () => {
    assert.equal(evaluateEndCondition({distance: 10, maxRange: 60, targetStatuses: [], targetPresent: false}), 'missing');
});

test('a Set of statuses works as well as an array', () => {
    assert.equal(evaluateEndCondition({distance: 10, maxRange: 60, targetStatuses: new Set(['coverTotal']), targetPresent: true}), 'cover');
});

test('missing beats every other reason', () => {
    assert.equal(evaluateEndCondition({distance: 999, maxRange: 60, targetStatuses: ['dead', 'coverTotal'], targetPresent: false}), 'missing');
});

test('an unmeasurable distance does not end the spell', () => {
    // MidiQOL.computeDistance returns -1 when it cannot measure; never end on that.
    assert.equal(evaluateEndCondition({distance: -1, maxRange: 60, targetStatuses: [], targetPresent: true}), null);
});

test('offer when the effect is up, the bonus action is free and nothing ended it', () => {
    assert.equal(shouldOfferSustain({effectPresent: true, bonusActionUsed: false, endReason: null}), true);
});

test('no offer once the bonus action is spent', () => {
    assert.equal(shouldOfferSustain({effectPresent: true, bonusActionUsed: true, endReason: null}), false);
});

test('no offer when the effect is gone', () => {
    assert.equal(shouldOfferSustain({effectPresent: false, bonusActionUsed: false, endReason: null}), false);
});

test('no offer when an end condition already holds', () => {
    assert.equal(shouldOfferSustain({effectPresent: true, bonusActionUsed: false, endReason: 'cover'}), false);
});

test('the caster effect watches movement and the target effect watches movement + new conditions', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    // The caster effect gets its watcher at cast time, through createEffect's macros option.
    assert.match(source, /type:\s*'movement',\s*macros:\s*\['witchBoltSource'\]/);
    // The target effect's watchers ship in packData; the macro only has to export them.
    assert.match(source, /export let witchBoltTarget/);
    assert.match(source, /pass:\s*'actorCreated'/);
    assert.match(source, /pass:\s*'moved'/);
});

test('half and three-quarters cover are never treated as total (regression on the RAW reading)', () => {
    const source = readFileSync(new URL('./witchBoltRules.mjs', import.meta.url), 'utf8');
    assert.ok(!source.includes('coverHalf'));
    assert.ok(!source.includes('coverThreeQuarters'));
});

test('the offer is raised through the GPS socket op, read off game.gps at CALL time', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    // The dialog must be BUILT on the recipient's client, otherwise the countdown chrome — which
    // mutates a live dialog instance — cannot be attached for a player-owned caster.
    assert.ok(source.includes("executeAsUser('process3rdPartyReactionDialog'"));
    assert.match(source, /type:\s*'singleDialog'/);
    // ⚠️ game.gps is reassigned WHOLESALE at GPS's ready hook, so a hoisted reference goes stale.
    assert.ok(source.includes('game.gps?.socket'));
    assert.ok(!/const\s+\w+\s*=\s*game\.gps\s*;/.test(source), 'must not hoist game.gps into a module-level const');
});

test('the sustain offer runs at turnStart on the caster effect', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    assert.match(source, /pass:\s*'turnStart'/);
});
