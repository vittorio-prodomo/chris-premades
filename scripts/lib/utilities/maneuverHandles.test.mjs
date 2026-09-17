import test from 'node:test';
import assert from 'node:assert/strict';
import {activityKeyFor, identifierFor, maneuverLabel, resolveManeuverHandles} from './maneuverHandles.mjs';

test('activityKeyFor / identifierFor round-trip the item identifier', () => {
    assert.equal(activityKeyFor('maneuversGoadingAttack'), 'goadingAttack');
    assert.equal(activityKeyFor('maneuversRiposte'), 'riposte');
    assert.equal(identifierFor('goadingAttack'), 'maneuversGoadingAttack');
    assert.equal(identifierFor(activityKeyFor('maneuversTripAttack')), 'maneuversTripAttack');
    assert.equal(activityKeyFor('superiorityDice'), 'superiorityDice', 'not a maneuver identifier — untouched');
    assert.equal(activityKeyFor('maneuvers'), 'maneuvers');
    assert.equal(activityKeyFor(undefined), undefined);
});

test('a maneuver found under the parent comes back as an activity handle', () => {
    let handles = resolveManeuverHandles(['maneuversGoadingAttack', 'maneuversTripAttack'], {
        itemByIdentifier: () => undefined,
        parentActivityByKey: key => key === 'goadingAttack' ? {name: 'Goading Attack'} : undefined
    });
    assert.deepEqual(handles, [{identifier: 'maneuversGoadingAttack', kind: 'activity', doc: {name: 'Goading Attack'}}]);
});

test('the separate-item shape still resolves — a sheet that was never migrated', () => {
    let handles = resolveManeuverHandles(['maneuversGoadingAttack'], {
        itemByIdentifier: id => id === 'maneuversGoadingAttack' ? {name: 'Maneuver: Goading Attack'} : undefined,
        parentActivityByKey: () => undefined
    });
    assert.equal(handles.length, 1);
    assert.equal(handles[0].kind, 'item');
});

test('both shapes present: the parent wins, so nothing is offered twice; order is preserved', () => {
    let handles = resolveManeuverHandles(['maneuversManeuveringAttack', 'maneuversGoadingAttack'], {
        itemByIdentifier: id => ({name: 'item ' + id}),
        parentActivityByKey: key => key === 'goadingAttack' ? {name: 'Goading Attack'} : undefined
    });
    assert.deepEqual(handles.map(h => [h.identifier, h.kind]), [['maneuversManeuveringAttack', 'item'], ['maneuversGoadingAttack', 'activity']]);
});

test('no lookups, no handles', () => {
    assert.deepEqual(resolveManeuverHandles(['maneuversRiposte'], {}), []);
    assert.deepEqual(resolveManeuverHandles(undefined, {}), []);
});

test('maneuverLabel: the activity name under the parent, the item name otherwise', () => {
    assert.equal(maneuverLabel({underParent: true, activityName: 'Riposte', itemName: 'Maneuver Options'}), 'Riposte');
    assert.equal(maneuverLabel({underParent: false, activityName: 'Use', itemName: 'Maneuver: Riposte'}), 'Maneuver: Riposte');
    assert.equal(maneuverLabel({underParent: true, activityName: '', itemName: 'Maneuver Options'}), 'Maneuver Options');
});

import {keyForManeuverName, planManeuverPrune} from './maneuverHandles.mjs';

test('keyForManeuverName: every prefix, suffix and apostrophe the sources produce', () => {
    assert.equal(keyForManeuverName('Riposte'), 'riposte');
    assert.equal(keyForManeuverName('Maneuver: Goading Attack'), 'goadingAttack');
    assert.equal(keyForManeuverName('Maneuver Options: Parry (Str.)'), 'parry');
    assert.equal(keyForManeuverName('Maneuvers: Trip Attack (Dex.)'), 'tripAttack');
    assert.equal(keyForManeuverName('Commander’s Strike'), 'commandersStrike');
    assert.equal(keyForManeuverName("Commander's Strike"), 'commandersStrike');
    assert.equal(keyForManeuverName('Bait and Switch'), 'baitAndSwitch');
    assert.equal(keyForManeuverName(''), '');
    assert.equal(keyForManeuverName(undefined), '');
});

const FULL = {
    activityIdentifiers: {riposte: 'A1', goadingAttack: 'A2', sweepingAttack: 'A3', sweepingAttackAttack: 'A4', precisionAttack: 'A5'},
    hiddenActivities: ['sweepingAttackAttack'],
    owners: {secondary: {sweepingAttackAttack: 'sweepingAttack'}, effectOwners: {E1: 'precisionAttack', E2: 'goadingAttack'}}
};

test('prune keeps the chosen maneuvers and drops the rest, with what they own', () => {
    let plan = planManeuverPrune({...FULL, chosenNames: ['Riposte', 'Maneuver: Goading Attack']});
    assert.deepEqual(plan.removeKeys.sort(), ['precisionAttack', 'sweepingAttack', 'sweepingAttackAttack']);
    assert.deepEqual(plan.removeActivityIds.sort(), ['A3', 'A4', 'A5']);
    assert.deepEqual(plan.removeEffectIds, ['E1']);
    assert.deepEqual(plan.hiddenActivities, []);
});

test('a chosen maneuver keeps its secondary activity and its hidden flag', () => {
    let plan = planManeuverPrune({...FULL, chosenNames: ['Sweeping Attack', 'Precision Attack']});
    assert.deepEqual(plan.removeKeys.sort(), ['goadingAttack', 'riposte']);
    assert.deepEqual(plan.removeEffectIds, ['E2']);
    assert.deepEqual(plan.hiddenActivities, ['sweepingAttackAttack']);
});

test('no stamp = leave the item alone (dragged from the compendium, homebrew)', () => {
    assert.equal(planManeuverPrune({...FULL, chosenNames: undefined}), null);
    assert.equal(planManeuverPrune({...FULL, chosenNames: []}), null);
});

test('⚠️ not one chosen name resolves: a naming mismatch — never empty the feature over it', () => {
    assert.equal(planManeuverPrune({...FULL, chosenNames: ['Fancy Footwork', 'Something New']}), null);
});

test('already pruned: nothing to do', () => {
    let plan = planManeuverPrune({
        chosenNames: ['Riposte'], activityIdentifiers: {riposte: 'A1'}, hiddenActivities: [], owners: {effectOwners: {}}
    });
    assert.equal(plan, null);
});

test('an unknown chosen name among known ones is simply ignored', () => {
    let plan = planManeuverPrune({...FULL, chosenNames: ['Riposte', 'Fancy Footwork']});
    assert.ok(plan.removeKeys.includes('goadingAttack'));
    assert.ok(!plan.removeKeys.includes('riposte'));
});

import {repointItemUsesCount} from './maneuverHandles.mjs';

test('repointItemUsesCount: the count follows the pool\'s REAL name; everything else is untouched', () => {
    let changes = [
        {key: 'flags.midi-qol.optional.PrecisionAttack.label', value: 'Precision Attack'},
        {key: 'flags.midi-qol.optional.PrecisionAttack.count', value: 'ItemUses.Superiority Dice'},
        {key: 'flags.midi-qol.optional.PrecisionAttack.attack.fail.mwak', value: '@scale.battle-master.combat-superiority-die'}
    ];
    let out = repointItemUsesCount(changes, 'Combat Superiority');
    assert.equal(out[1].value, 'ItemUses.Combat Superiority');
    assert.deepEqual(out[0], changes[0]);
    assert.deepEqual(out[2], changes[2]);
    assert.equal(changes[1].value, 'ItemUses.Superiority Dice', 'input not mutated');
});

test('repointItemUsesCount: already right, not an ItemUses count, or no pool name = null', () => {
    assert.equal(repointItemUsesCount([{key: 'flags.midi-qol.optional.X.count', value: 'ItemUses.Combat Superiority'}], 'Combat Superiority'), null);
    assert.equal(repointItemUsesCount([{key: 'flags.midi-qol.optional.X.count', value: 'every'}], 'Combat Superiority'), null);
    assert.equal(repointItemUsesCount([{key: 'flags.midi-qol.optional.X.count', value: 'ItemUses.Superiority Dice'}], ''), null);
    assert.equal(repointItemUsesCount(undefined, 'x'), null);
});
