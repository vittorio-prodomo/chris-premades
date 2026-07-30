import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 Batch B slice 4b — guards on the two ports that need a HANDLER, not just an encoding.
 *
 * Distracting Strike and Sweeping Attack are both "shape-stable" between editions (checked against
 * `dnd-players-handbook.classes` on 2026-07-30), so unlike slice 4a nothing about the RAW changed.
 * What makes them Batch B is that the official 2024 items do not automate the interesting half:
 * Distracting Strike ships a `Distracted` marker with ZERO changes and says so in its Foundry Note,
 * and Sweeping Attack ships only a Damage activity — no second attack roll at all. CPR's legacy
 * handlers do model both, so the port carries them forward.
 *
 * These read source text rather than importing the macro modules, matching the sibling suites — the
 * macro files import Foundry globals that do not exist under node.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/', import.meta.url));
const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
const modernRegistryPath = fileURLToPath(new URL('../../macros.js', import.meta.url));

function byIdentifier(identifier) {
    for (const file of readdirSync(packDir).filter(f => f.startsWith('Maneuvers__') && f.endsWith('.json'))) {
        const pack = JSON.parse(readFileSync(packDir + file, 'utf8'));
        if (pack.flags['chris-premades']?.info?.identifier === identifier) return { file, pack };
    }
    return null;
}
const source = () => readFileSync(modernManeuvers, 'utf8');
function registryEntry(identifier) {
    const entry = source().match(new RegExp(`export let ${identifier} = \\{[\\s\\S]*?\\n\\};`))?.[0];
    assert.ok(entry, `${identifier} has no modern registry entry`);
    return entry;
}
function handler(name) {
    const fn = source().match(new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}`))?.[0];
    assert.ok(fn, `handler ${name} not found in the modern maneuvers module`);
    return fn;
}

test('both slice-4b maneuvers exist in the 2024 pack', () => {
    for (const id of ['maneuversDistractingStrike', 'maneuversSweepingAttack']) {
        assert.ok(byIdentifier(id), `${id} missing from cpr-class-features-2024`);
    }
});

test('both are spent by the DRIVER, so neither declares a consumption target', () => {
    // The §T83 distinction: an on-hit rider's die is decremented by superiorityHelper itself. An
    // item-level target here would spend a second die on every use.
    for (const id of ['maneuversDistractingStrike', 'maneuversSweepingAttack']) {
        const { file, pack } = byIdentifier(id);
        for (const [key, activity] of Object.entries(pack.system.activities)) {
            assert.equal(
                (activity.consumption?.targets ?? []).length, 0,
                `${file} activity ${key} would double-spend: the driver already decrements the die`
            );
        }
    }
});

/* ---------------------------------------------------------------- Distracting Strike */

test('Distracting Strike grants advantage to attackers OTHER THAN the fighter', () => {
    /*
     * RAW: "The next attack roll against the target by an attacker other than you has Advantage."
     * The exclusion rides midi's condition, and the frame is INVERTED for a `grants.*` flag —
     * midi builds the condition data with `actor: grantsActor` (the defender, who holds the flag)
     * and `target: tokenForActor(actor)` (the ATTACKER), so `targetActorUuid` is the attacker's.
     * Verified in midi 13.0.63: RollModifierTracker.ts grantsConditionData.
     */
    const fn = handler('useDistractingStrike');
    assert.match(fn, /flags\.midi-qol\.grants\.advantage\.attack\.all/);
    assert.match(
        fn, /targetActorUuid !== /,
        'without the exclusion the fighter would gain advantage from their own maneuver'
    );
});

test('the Distracted marker expires at the START of the fighter\'s next turn', () => {
    // RAW: "...if the attack is made before the start of your next turn." `turnEndSource` would cut
    // it a whole turn short; a plain rounds:1 duration would not track the SOURCE's turn at all.
    const fn = handler('useDistractingStrike');
    assert.match(fn, /specialDuration/);
    assert.match(fn, /'turnStartSource'/);
});

test('the Distracted marker is stamped MODERN, or its macro resolves against the LEGACY registry', () => {
    /*
     * ⚠️ THE TRAP THIS SLICE FOUND. `genericUtils.getRules(entity)` reads
     * `entity.flags['chris-premades'].rules` for an ActiveEffect and DEFAULTS TO 'legacy' — only
     * Items infer their ruleset from `system.source.rules`. `custom.getMacro(name, rules)` then
     * resolves `rules === 'modern' ? macros[name] : legacyMacros[name]`.
     *
     * So an unstamped effect created by a 2024 maneuver silently runs the 2014 handler. Here that
     * would even "work" (the consume-on-first-attack logic is edition-stable), which is exactly what
     * makes it dangerous: the coupling is invisible until someone tunes the legacy side.
     */
    const fn = handler('useDistractingStrike');
    assert.match(
        fn, /rules:\s*distractingStrikeEffect\.rules/,
        'pass the registry entry\'s own rules to createEffect — an unstamped effect defaults to legacy'
    );
    assert.match(registryEntry('distractingStrikeEffect'), /rules: 'modern'/);
});

test('the Distracted marker is consumed by the first attack from someone else', () => {
    // "The NEXT attack roll" — one attack, then gone. The gate must exclude the fighter's own
    // attacks, or their next swing would burn the marker they just paid a die for.
    const fn = handler('distractingStrikeEffectHit');
    assert.match(fn, /genericUtils\.remove\(effect\)/);
    assert.match(fn, /originItem\??\.actor === workflow\.actor/, 'the fighter\'s own attack must not consume it');
});

test('distractingStrikeEffect is exported from the modern registry', () => {
    // The effect carries the macro by NAME. Unexported, getMacro returns undefined and the marker
    // never clears — it would sit there granting advantage until its duration lapsed.
    assert.match(readFileSync(modernRegistryPath, 'utf8'), /\bdistractingStrikeEffect\b/);
});

/* ------------------------------------------------------------------- Sweeping Attack */

test('Sweeping Attack ships BOTH activities: the maneuver and its hidden second attack', () => {
    const { file, pack } = byIdentifier('maneuversSweepingAttack');
    const types = Object.values(pack.system.activities).map(a => a.type).sort();
    assert.deepEqual(types, ['attack', 'utility'], `${file} needs the second-target attack activity`);
});

test('Sweeping Attack maps BOTH activity identifiers, or the second attack cannot be found', () => {
    /*
     * `activityUtils.getActivityByIdentifier` reads ONLY `flags.chris-premades.activityIdentifiers`.
     * The handler looks the attack up with `{strict: true}`, so a missing map is a warning toast and
     * a silent no-op — the same failure shape that left Batch A's Evasive Footwork broken.
     */
    const { file, pack } = byIdentifier('maneuversSweepingAttack');
    const map = pack.flags['chris-premades']?.activityIdentifiers ?? {};
    assert.ok(map.maneuversSweepingAttack, `${file} must map its own use activity`);
    assert.ok(map.sweepingAttackAttack, `${file} must map sweepingAttackAttack`);
    for (const [identifier, id] of Object.entries(map)) {
        assert.ok(pack.system.activities[id], `${file} maps ${identifier} to a nonexistent activity ${id}`);
    }
});

test('the second attack activity is hidden from the sheet', () => {
    // It is machinery, not a thing to click: it replays an attack roll that has already happened.
    const { file, pack } = byIdentifier('maneuversSweepingAttack');
    assert.ok(
        (pack.flags['chris-premades']?.hiddenActivities ?? []).includes('sweepingAttackAttack'),
        `${file} would show a raw "Sweeping Attack: Attack" button on the sheet`
    );
});

test('the 2024 pack carries no leaked runtime sweepingAttack state', () => {
    /*
     * ⚠️ The LEGACY packData has real combat state committed into it —
     * `"sweepingAttack": {"currAttackRoll": 17, "currDamageType": "slashing", "currRange": 5}` —
     * captured from whichever session built that pack. Copying the file forward would ship a stale
     * attack roll to every 2024 Battle Master, and `useSweepingAttack` bails on a MISSING flag, so a
     * pre-filled one is worse than none: it would fire with someone else's 17.
     */
    const { file, pack } = byIdentifier('maneuversSweepingAttack');
    assert.equal(
        pack.flags['chris-premades'].sweepingAttack, undefined,
        `${file} ships runtime state; the driver writes this flag at use time`
    );
});

test('the second attack reuses the ORIGINAL attack roll and cannot crit on the replay', () => {
    /*
     * RAW: "If the original attack roll would hit the second creature..." — it is the same roll
     * re-checked against a different AC, not a new one. `criticalSuccess: Infinity` stops the
     * replayed total from being re-read as a natural 20.
     */
    const fn = handler('sweepingAttackAttack');
    assert.match(fn, /currAttackRoll/);
    assert.match(fn, /criticalSuccess: Infinity/);
    assert.match(fn, /setAttackRoll/);
});

test('the Distracted marker survives an origin item that no longer resolves', () => {
    /*
     * `effect.origin` points at the fighter's maneuver item. A DDB re-import deletes and recreates
     * items ([[reimport-clobber-open-problem]]), so a marker outliving its origin is reachable — and
     * the legacy handler dereferences `originItem.actor` unguarded, which throws inside a midi pass
     * and takes the rest of that pass's macros with it.
     */
    const fn = handler('distractingStrikeEffectHit');
    assert.match(fn, /originItem\?\.|!originItem/, 'guard the origin lookup: fromUuid can return null');
});

test('the sweeping target pick is not gated on the "skip dead and unconscious" checkbox', () => {
    /*
     * ⚠️ UPSTREAM BUG, not ported. `selectTargetDialog` returns `[result, skip]` — `skip` is the
     * SkipDeadAndUnconscious checkbox (default checked), NOT a confirmation. The legacy handler
     * reads `if (!target?.length || !target[1]) return;`, so a player who unchecks that box gets a
     * Sweeping Attack that silently does nothing after the die is already committed.
     * Cancel is still caught: the dialog returns `false`, whose `?.length` is undefined.
     */
    const fn = handler('useSweepingAttack');
    assert.ok(!/!target\[1\]/.test(fn), 'target[1] is the skip checkbox, not a confirmation');
});

test('both target branches hand the synthetic roll the same type', () => {
    // findNearby returns Tokens; the dialog branch returned `target[0].document` (a TokenDocument)
    // while the single-candidate branch returned a raw Token. Tokens are the house convention
    // (cf. useRiposte, useManeuveringAttack), so normalise on those.
    const fn = handler('useSweepingAttack');
    assert.ok(!/\[0\]\.document/.test(fn), 'the two branches must not differ in type');
});

test('Sweeping Attack picks a creature near the target AND within the fighter\'s reach', () => {
    // Both halves are RAW ("within 5 feet of the original target and within your reach") and the
    // reach half is the one a naive port drops — findNearby around the target alone would let you
    // sweep something across the room from you.
    const fn = handler('useSweepingAttack');
    assert.match(fn, /findNearby\(workflow\.targets\.first\(\), 5, 'ally'\)/);
    assert.match(fn, /findNearby\(workflow\.token, currRange, 'enemy'\)/);
});

test('both handlers are scoped to their own activities', () => {
    // The item has two activities and two passes on the same `rollFinished`/`postAttackRoll` cycle.
    // Without the `activities` scoping each pass would also fire on the other activity's workflow.
    const entry = registryEntry('maneuversSweepingAttack');
    assert.match(entry, /macro: useSweepingAttack[\s\S]*?activities: \['maneuversSweepingAttack'\]/);
    assert.match(entry, /macro: sweepingAttackAttack[\s\S]*?activities: \['sweepingAttackAttack'\]/);
});

test('the driver never offers a maneuver on the sweeping second attack', () => {
    // RAW caps it at one maneuver per attack, and the second attack already IS one. The modern
    // driver inherits this from superiorityHelper, so the guard lives on the shared helper.
    const legacyDriver = fileURLToPath(new URL('../../macros/2014/classFeatures/fighter/battleMaster/superiorityDice.js', import.meta.url));
    assert.match(
        readFileSync(legacyDriver, 'utf8'),
        /getIdentifier\(workflow\.activity\) === 'sweepingAttackAttack'\) return;/
    );
});

/* ------------------------------------------------------------------------- both ends */

test('both slice-4b maneuvers are exported from the modern registry', () => {
    const registry = readFileSync(modernRegistryPath, 'utf8');
    for (const id of ['maneuversDistractingStrike', 'maneuversSweepingAttack']) {
        assert.match(registry, new RegExp(`\\b${id}\\b`), `${id} unexported -- it would never resolve`);
    }
});

test('both packData entries name the handlers the registry actually defines', () => {
    for (const id of ['maneuversDistractingStrike', 'maneuversSweepingAttack']) {
        const { file, pack } = byIdentifier(id);
        assert.deepEqual(
            pack.flags['chris-premades'].macros?.midi?.item, [id],
            `${file} must declare its own midi.item macro, or the handler never runs`
        );
    }
});
