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

test('the sustain offer resolves the item off the stashed itemUuid flag, never off the effect origin', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    // `effectUtils.createEffect` overwrites `effectData.origin` with the concentration effect's uuid
    // whenever `concentrationItem` is passed (effectUtils.js:37), and Witch Bolt always concentrates.
    // `fromUuid(sourceEffect.origin)` would therefore resolve an ActiveEffect, not the item, and
    // `getActivityByIdentifier`'s unguarded `.system.activities.find` would throw at the table with
    // no visible error (swallowed by combat.js's executeMacro try/catch) — the whole offer silently
    // never fires. Guard both ends of the fix: the flag is stashed at cast time, and read back at
    // offer time instead of `origin`.
    assert.ok(!/fromUuid\(sourceEffect\.origin\)/.test(source), 'must not resolve the sustain item off sourceEffect.origin');
    assert.ok(source.includes("itemUuid: workflow.item.uuid"), 'the cast-time effect data must stash the item uuid');
    assert.ok(source.includes("fromUuid(sourceEffect.flags['chris-premades']?.witchBolt?.itemUuid)"),
        'the offer must resolve the item off the stashed itemUuid flag');
});

test('the bonus-action gate uses the canonical MidiQOL helper, not a hand-rolled marker check', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    // `actorUtils.hasUsedBonusAction` wraps MidiQOL's counter-vs-max check; a hand-rolled
    // `actor.effects.find(i => i.id === 'dnd5ebonusaction')` only tests presence and diverges the
    // moment anything grants a second bonus action.
    assert.ok(source.includes('actorUtils.hasUsedBonusAction(actor)'));
    assert.ok(!source.includes("dnd5ebonusaction"), 'must not hand-roll the bonus-action marker check');
});

test('the offer prefers the dispatching trigger token, then the uuid stashed at cast time', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    // The dispatcher hands us the token whose turn it is — always prefer it.
    assert.ok(source.includes('let casterToken = trigger.token;'));
    // ⚠️ `actor.getActiveTokens()[0]` is the LAST resort, not the first fallback: for a linked actor
    // with several tokens on the scene it measures range from an arbitrary body. The uuid captured at
    // cast time comes first, the way Warding Bond stores `bondUuid`.
    assert.ok(source.includes('casterTokenUuid'));
    assert.match(source, /let stashed = data\?\.casterTokenUuid \? await fromUuid\(data\.casterTokenUuid\) : undefined;/);
});
