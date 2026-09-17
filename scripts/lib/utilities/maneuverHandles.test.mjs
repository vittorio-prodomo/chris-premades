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
