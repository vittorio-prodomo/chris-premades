import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 Batch B slice 1 — guards on the 2024 driver's own trigger list.
 *
 * Until 2026-07-29 the modern `superiorityDice` entry delegated its midi passes straight to the
 * legacy one (`midi: superiorityDiceLegacy.midi`), so a 2024 Battle Master was driven by the 2014
 * trigger array -- which still lists `maneuversGrapplingStrike`, a maneuver 2024 deleted. It was
 * inert in practice (lookup is by identifier and no 2024 sheet holds that item), but it could never
 * be fixed by editing the shared array: the legacy line legitimately needs it.
 *
 * These read source text rather than importing the macro modules, matching
 * modernItemPackRegistry.test.mjs -- the macro files import Foundry globals that do not exist here.
 */

const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
const legacyDriver = fileURLToPath(new URL('../../macros/2014/classFeatures/fighter/battleMaster/superiorityDice.js', import.meta.url));
const modernRegistryPath = fileURLToPath(new URL('../../macros.js', import.meta.url));

function arrayLiteral(source, name) {
    const match = source.match(new RegExp(`(?:export )?const ${name} = \\[([^\\]]*)\\]`));
    assert.ok(match, `could not find a '${name}' array literal -- did it get renamed?`);
    return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

function modernRegistryExports() {
    const source = readFileSync(modernRegistryPath, 'utf8');
    const names = new Set();
    for (const match of source.matchAll(/^export \{([^}]*)\} from/gm)) {
        for (const raw of match[1].split(',')) {
            const name = raw.includes(' as ') ? raw.split(' as ').pop() : raw;
            if (name.trim()) names.add(name.trim());
        }
    }
    return names;
}

test('the modern driver no longer borrows the legacy midi passes', () => {
    const source = readFileSync(modernManeuvers, 'utf8');
    assert.ok(
        !/midi:\s*superiorityDiceLegacy\.midi/.test(source),
        'the 2024 superiorityDice entry is delegating to the legacy driver again -- ' +
        'that reinstates the 2014 trigger list, Grappling Strike included'
    );
    assert.ok(
        /macro:\s*modernHit/.test(source),
        'the 2024 driver should register its own handler'
    );
});

test('the 2024 trigger list does not offer Grappling Strike, which 2024 deleted', () => {
    const modern = arrayLiteral(readFileSync(modernManeuvers, 'utf8'), 'modernTriggerManeuvers');
    assert.ok(!modern.includes('maneuversGrapplingStrike'), 'Grappling Strike does not exist in 2024');
});

test('the legacy trigger list KEEPS Grappling Strike -- 2014 still has it', () => {
    // The whole reason the modern list exists separately. If someone "cleans up" the legacy array,
    // the 2014 line silently loses a maneuver.
    const legacy = arrayLiteral(readFileSync(legacyDriver, 'utf8'), 'legacyTriggerManeuvers');
    assert.ok(legacy.includes('maneuversGrapplingStrike'), 'the 2014 line legitimately has Grappling Strike');
});

test('every identifier in the 2024 trigger list is a real CPR maneuver -- no typos', () => {
    // A typo fails SILENTLY: getItemByIdentifier returns nothing and the maneuver simply never
    // appears in the prompt. That is how all 23 went unnoticed in the first place. Checked against
    // the LEGACY registry because that is where all 23 are defined; the modern one is still filling
    // up as Batch B lands (see the tripwire below).
    const modern = arrayLiteral(readFileSync(modernManeuvers, 'utf8'), 'modernTriggerManeuvers');
    const source = readFileSync(fileURLToPath(new URL('../../legacyMacros.js', import.meta.url)), 'utf8');
    const known = new Set();
    for (const match of source.matchAll(/^export \{([^}]*)\} from/gm)) {
        for (const raw of match[1].split(',')) {
            const name = raw.includes(' as ') ? raw.split(' as ').pop() : raw;
            if (name.trim()) known.add(name.trim());
        }
    }
    for (const identifier of modern) {
        assert.ok(known.has(identifier), `${identifier} is not a known CPR maneuver identifier`);
    }
});

test('TRIPWIRE: the trigger identifiers still awaiting a Batch B port are exactly these three', () => {
    /*
     * The 2024 trigger list is a statement of RAW -- which maneuvers are on-hit riders in 2024 --
     * not of what has been built. Three of them are still Batch B and resolve to nothing today,
     * which is harmless (the lookup just finds no item) and correct to list in advance.
     *
     * This test exists to fire WHEN ONE IS PORTED: at that moment the driver starts offering it for
     * real, so it wants live verification rather than a silent behaviour change. Delete the entry
     * from PENDING as each lands.
     */
    // Slice 4a ported Pushing Attack and Trip Attack (2026-07-29); slice 4b ported Distracting
    // Strike (2026-07-30), the last one. ⚠️ EMPTY IS NOW THE CORRECT STATE — every identifier the
    // 2024 driver offers resolves to a real modern maneuver. If this set grows again, someone added
    // a trigger identifier ahead of its port; that is still legitimate (see above), but it means the
    // driver is offering something that silently does nothing until the port lands.
    const PENDING = new Set([]);
    const modern = arrayLiteral(readFileSync(modernManeuvers, 'utf8'), 'modernTriggerManeuvers');
    const exported = modernRegistryExports();
    const stillPending = modern.filter(i => !exported.has(i)).sort();
    assert.deepEqual(
        stillPending, [...PENDING].sort(),
        'the set of unported on-hit riders changed. If you just ported one, remove it from PENDING ' +
        'here -- and note the 2024 driver now offers it live, so verify it at the table.'
    );
});

test('Sweeping Attack is not in the list -- the helper appends it for melee only', () => {
    const modern = arrayLiteral(readFileSync(modernManeuvers, 'utf8'), 'modernTriggerManeuvers');
    assert.ok(
        !modern.includes('maneuversSweepingAttack'),
        'listing it here would offer it on ranged attacks too; 2024 says "with a melee attack roll"'
    );
    assert.ok(
        /getActionType\(workflow\) === 'mwak'\) candidates\.push\('maneuversSweepingAttack'\)/.test(readFileSync(legacyDriver, 'utf8')),
        'the helper should still append Sweeping Attack on mwak'
    );
});

test('the helper copies the trigger list instead of mutating it', () => {
    // The mwak branch pushes Sweeping Attack. Pushing onto a module-level array would grow it once
    // per melee attack for the rest of the session, so the copy is load-bearing, not style.
    const source = readFileSync(legacyDriver, 'utf8');
    assert.ok(
        /let candidates = \[\.\.\.triggerManeuvers\]/.test(source),
        'superiorityHelper must copy the incoming list before pushing to it'
    );
    assert.ok(
        !/triggerManeuvers\.push\(/.test(source),
        'never push directly onto the passed-in trigger list'
    );
});

test('Precision Attack rides midi\'s miss-only optional channel, not the on-hit driver', () => {
    const modern = arrayLiteral(readFileSync(modernManeuvers, 'utf8'), 'modernTriggerManeuvers');
    assert.ok(
        !modern.includes('maneuversPrecisionAttack'),
        '2024 Precision Attack is miss-only -- the on-hit driver would offer it on hits'
    );
    const pack = JSON.parse(readFileSync(
        fileURLToPath(new URL('../../../packData/cpr-class-features-2024/Maneuvers__Precision_Attack_cprMnvPrecis2024.json', import.meta.url)),
        'utf8'
    ));
    const keys = pack.effects.flatMap(e => e.changes.map(c => c.key));
    const offers = keys.filter(k => /optional\.PrecisionAttack\.attack\./.test(k));
    assert.ok(offers.length > 0, 'Precision Attack should still offer through midi optional bonuses');
    for (const key of offers) {
        assert.match(
            key, /optional\.PrecisionAttack\.attack\.fail\./,
            `${key} offers on EVERY attack. 2024 is miss-only: midi's miss-gated channel is ` +
            'attack.fail.<actionType>, evaluated against the AC captured at roll time.'
        );
    }
});
