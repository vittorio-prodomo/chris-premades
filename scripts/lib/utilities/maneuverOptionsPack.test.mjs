import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {build} from '../../../packData/t232-buildManeuverOptions.mjs';
import {keyForManeuverName} from './maneuverHandles.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packData/cpr-class-features-2024/Maneuver_Options_cprManeuverOpt24.json');

test('the Maneuver Options document on disk is what the generator produces — regenerate after editing a maneuver', () => {
    assert.equal(fs.readFileSync(OUT, 'utf8'), JSON.stringify(build(), null, 2) + '\n');
});

test('every maneuver activity is reachable from its printed name (the prune pass depends on it)', () => {
    let doc = build();
    let cpr = doc.flags['chris-premades'];
    let secondary = cpr.maneuverOptions.secondary;
    for (let [key, id] of Object.entries(cpr.activityIdentifiers)) {
        let activity = doc.system.activities[id];
        assert.ok(activity, `activity ${id} exists`);
        if (key in secondary) continue;
        assert.equal(keyForManeuverName(activity.name), key, `${activity.name} -> ${key}`);
    }
    assert.equal(Object.keys(cpr.activityIdentifiers).length - Object.keys(secondary).length, 20, 'twenty maneuvers');
});

test('every effect is owned by a maneuver that exists, and every activity effect reference resolves', () => {
    let doc = build();
    let cpr = doc.flags['chris-premades'];
    let effectIds = new Set(doc.effects.map(i => i._id));
    for (let [effectId, key] of Object.entries(cpr.maneuverOptions.effectOwners)) {
        assert.ok(effectIds.has(effectId));
        assert.ok(key in cpr.activityIdentifiers, `${key} owns ${effectId}`);
    }
    assert.equal(Object.keys(cpr.maneuverOptions.effectOwners).length, doc.effects.length, 'no unowned effect');
    for (let activity of Object.values(doc.system.activities)) {
        for (let ref of activity.effects ?? []) assert.ok(effectIds.has(ref._id), `${activity.name} -> ${ref._id}`);
    }
});

test('no item-level reaction condition leaks onto the other reactions', () => {
    assert.equal(build().flags['midi-qol'].reactionCondition, '');
});
