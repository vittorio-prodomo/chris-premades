import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 Batch B slice 4 — guards on the four ports that ride the official 2024 encoding.
 *
 * Their activities are taken wholesale from `dnd-players-handbook.classes`, because WotC's own items
 * already express the 2024 diffs (including the `max(str, dex)` idiom we derived independently for
 * the save DC). These tests pin the things a wholesale copy can silently get wrong: the scale key,
 * the 2024 formula changes, and whether the item spends its own die or the driver's.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/', import.meta.url));
const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));

function byIdentifier(identifier) {
    for (const file of readdirSync(packDir).filter(f => f.startsWith('Maneuvers__') && f.endsWith('.json'))) {
        const pack = JSON.parse(readFileSync(packDir + file, 'utf8'));
        if (pack.flags['chris-premades']?.info?.identifier === identifier) return { file, pack };
    }
    return null;
}
const soleActivity = (pack) => Object.values(pack.system.activities)[0];

test('all four slice-4 maneuvers exist in the 2024 pack', () => {
    for (const id of ['maneuversParry', 'maneuversRally', 'maneuversTripAttack', 'maneuversPushingAttack']) {
        assert.ok(byIdentifier(id), `${id} missing from cpr-class-features-2024`);
    }
});

test('no 2024 maneuver reads the PHB scale key -- CPR items read the DDB parse\'s', () => {
    /*
     * The official items use @scale.battle-master.superiority.die; a DDB-imported sheet (Xender) has
     * combat-superiority-die. Leaving the PHB key in place resolves to nothing and silently falls
     * back to a d6 -- the documented "stray d6" symptom.
     */
    for (const file of readdirSync(packDir).filter(f => f.startsWith('Maneuvers__') && f.endsWith('.json'))) {
        const raw = readFileSync(packDir + file, 'utf8');
        assert.ok(
            !/@scale\.battle-master\.superiority\.die/.test(raw),
            `${file} still reads the PHB scale key; CPR needs combat-superiority-die`
        );
    }
});

test('Parry reduces by die + the BETTER of Str/Dex, as a reaction', () => {
    const { pack } = byIdentifier('maneuversParry');
    const act = soleActivity(pack);
    assert.equal(act.type, 'heal');
    assert.equal(act.activation?.type, 'reaction');
    const formula = act.healing?.custom?.formula ?? '';
    assert.match(formula, /max\(/, '2024 adds "your Strength or Dexterity modifier (your choice)"');
    assert.match(formula, /@abilities\.str\.mod/);
    assert.match(formula, /@abilities\.dex\.mod/);
    assert.deepEqual(act.healing?.types, ['healing']);
});

test('Rally grants temp HP of die + HALF FIGHTER LEVEL, not Charisma', () => {
    // The 2014 encoding added the Charisma modifier. Copying it forward would be wrong for every
    // Fighter whose Charisma is not coincidentally half their level.
    const { pack } = byIdentifier('maneuversRally');
    const act = soleActivity(pack);
    assert.equal(act.type, 'heal');
    assert.equal(act.activation?.type, 'bonus');
    assert.deepEqual(act.healing?.types, ['temphp'], 'Rally grants TEMPORARY hit points');
    const formula = act.healing?.custom?.formula ?? '';
    assert.match(formula, /floor\(@classes\.fighter\.levels\s*\/\s*2\)/);
    assert.ok(!/@abilities\.cha/.test(formula), 'the 2014 Charisma term must not survive the port');
});

test('Trip Attack applies Prone through a status effect, not a macro', () => {
    const { pack } = byIdentifier('maneuversTripAttack');
    const act = soleActivity(pack);
    assert.equal(act.type, 'save');
    assert.deepEqual(Array.from(act.save?.ability ?? []), ['str']);
    const statuses = (pack.effects ?? []).flatMap(e => e.statuses ?? []);
    assert.ok(statuses.includes('prone'), 'the Tripped effect must carry the prone status');
});

test('Pushing Attack carries a handler, because the official item never moves anyone', () => {
    const { pack } = byIdentifier('maneuversPushingAttack');
    assert.deepEqual(pack.flags['chris-premades'].macros?.midi?.item, ['maneuversPushingAttack']);
    const source = readFileSync(modernManeuvers, 'utf8');
    assert.match(source, /async function pushOnFailedSave/);
    // Must read settled saves, so it cannot run before them.
    assert.match(source, /if \(!workflow\.failedSaves\?\.size\) return;/);
    const entry = source.match(/export let maneuversPushingAttack = \{[\s\S]*?\n\};/)?.[0] ?? '';
    assert.match(entry, /pass: 'rollFinished'/, 'failedSaves is only settled by rollFinished');
});

test('the on-hit riders spend the DRIVER\'s die; the directly-used ones spend their own', () => {
    /*
     * The §T83 distinction, and the trap Batch A got wrong: a maneuver with an item-level
     * consumption target needs `activityIdentifiers` so the re-pointer can resolve it, and one
     * without must NOT declare a target at all (the driver decrements the die itself).
     */
    const expectations = {
        maneuversParry: true,           // Reaction, used directly
        maneuversRally: true,           // Bonus Action, used directly
        maneuversTripAttack: false,     // on-hit rider
        maneuversPushingAttack: false   // on-hit rider
    };
    for (const [identifier, ownDie] of Object.entries(expectations)) {
        const { file, pack } = byIdentifier(identifier);
        const targets = soleActivity(pack).consumption?.targets ?? [];
        if (ownDie) {
            assert.equal(targets.length, 1, `${file} should consume its own superiority die`);
            assert.ok(
                pack.flags['chris-premades']?.activityIdentifiers?.use,
                `${file} consumes its own die, so it needs activityIdentifiers.use for the re-pointer`
            );
            // ...and the map is inert unless the registry actually registers the repair passes.
            // Batch A's Evasive Footwork had one half without the other for a full release.
            const source = readFileSync(modernManeuvers, 'utf8');
            const entry = source.match(new RegExp(`export let ${identifier} = \\{[\\s\\S]*?\\n\\};`))?.[0] ?? '';
            assert.ok(entry, `${identifier} registry entry not found`);
            assert.match(entry, /macro: added/,
                `${file} declares activityIdentifiers but never registers the 'added' passes that use it`);
        } else {
            assert.equal(targets.length, 0,
                `${file} is spent by the driver; an item-level target would double-spend`);
        }
    }
});

test('every slice-4 maneuver is exported from the modern registry', () => {
    const source = readFileSync(fileURLToPath(new URL('../../macros.js', import.meta.url)), 'utf8');
    for (const id of ['maneuversParry', 'maneuversRally', 'maneuversTripAttack', 'maneuversPushingAttack']) {
        assert.match(source, new RegExp(`\\b${id}\\b`), `${id} unexported -- it would never resolve`);
    }
});
