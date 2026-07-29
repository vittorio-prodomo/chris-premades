import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldConsumePendingDie, selectPendingDie, movedFarEnough, satisfiesMovementRequirement } from './pendingSuperiorityDie.mjs';

/*
 * T81 Batch B slice 2 — the "next attack this turn" tracker.
 *
 * Feinting Attack (and Lunging Attack in slice 3) spend their superiority die UP FRONT as a Bonus
 * Action, then pay out on a later qualifying hit. The die is therefore already gone when these
 * predicates run: the only question is whether THIS attack is the one it lands on.
 */

const FEINT = { identifier: 'maneuversFeintingAttack', name: 'Maneuvers: Feinting Attack', die: 'd8', targetId: 'tokenA' };
const LUNGE = { identifier: 'maneuversLungingAttack', name: 'Maneuvers: Lunging Attack', die: 'd8', requiresMelee: true };
// Slice 3 adds the movement clause; most tests below predate it and pass movedThisTurn implicitly.
const LUNGE3 = { ...LUNGE, requiresMovement: true };

test('a hit on the feinted target consumes the die', () => {
    assert.equal(shouldConsumePendingDie(FEINT, { actionType: 'mwak', hitTargetIds: ['tokenA'] }), true);
});

test('a hit on someone else does NOT consume a reserved die', () => {
    // The feint is still live for a later attack against the creature you feinted.
    assert.equal(shouldConsumePendingDie(FEINT, { actionType: 'mwak', hitTargetIds: ['tokenB'] }), false);
});

test('a MISS never consumes the die', () => {
    // "If that attack hits" -- a miss must not burn a reservation that is still usable this turn.
    assert.equal(shouldConsumePendingDie(FEINT, { actionType: 'mwak', hitTargetIds: [] }), false);
    assert.equal(shouldConsumePendingDie(LUNGE, { actionType: 'mwak', hitTargetIds: [] }), false);
});

test('an unrestricted die is consumed by a hit on anyone', () => {
    const anyTarget = { ...FEINT, targetId: undefined };
    assert.equal(shouldConsumePendingDie(anyTarget, { actionType: 'rwak', hitTargetIds: ['whoever'] }), true);
});

test('a melee-only die ignores a ranged hit', () => {
    assert.equal(shouldConsumePendingDie(LUNGE, { actionType: 'rwak', hitTargetIds: ['tokenA'] }), false);
    assert.equal(shouldConsumePendingDie(LUNGE, { actionType: 'mwak', hitTargetIds: ['tokenA'] }), true);
});

test('a malformed entry fails CLOSED rather than appending a bogus formula', () => {
    const attack = { actionType: 'mwak', hitTargetIds: ['tokenA'] };
    for (const die of [undefined, null, '', '2d8', 'd', 'eight', 8]) {
        assert.equal(shouldConsumePendingDie({ ...FEINT, die }, attack), false, `die=${String(die)}`);
    }
    assert.equal(shouldConsumePendingDie(null, attack), false);
    assert.equal(shouldConsumePendingDie(undefined, attack), false);
});

test('missing or odd attack shapes do not throw', () => {
    assert.equal(shouldConsumePendingDie(FEINT, undefined), false);
    assert.equal(shouldConsumePendingDie(FEINT, {}), false);
    assert.equal(shouldConsumePendingDie(FEINT, { hitTargetIds: 'tokenA' }), false);
});

test('only ONE die is selected when two are banked -- RAW allows one maneuver per attack', () => {
    const chosen = selectPendingDie([LUNGE, FEINT], { actionType: 'mwak', hitTargetIds: ['tokenA'] });
    assert.equal(chosen, FEINT, 'the reserved die should win over the unrestricted one');
});

test('the reserved die wins regardless of banking order', () => {
    const chosen = selectPendingDie([FEINT, LUNGE], { actionType: 'mwak', hitTargetIds: ['tokenA'] });
    assert.equal(chosen, FEINT);
});

test('an unrestricted die is still used when the reserved one does not apply', () => {
    // Feinted tokenA, but hit tokenB in melee: the Lunging die is the one that pays out.
    const chosen = selectPendingDie([FEINT, LUNGE], { actionType: 'mwak', hitTargetIds: ['tokenB'] });
    assert.equal(chosen, LUNGE);
});

test('selectPendingDie returns null when nothing qualifies', () => {
    assert.equal(selectPendingDie([FEINT, LUNGE], { actionType: 'rwak', hitTargetIds: ['tokenB'] }), null);
    assert.equal(selectPendingDie([], { actionType: 'mwak', hitTargetIds: ['tokenA'] }), null);
    assert.equal(selectPendingDie(undefined, { actionType: 'mwak', hitTargetIds: ['tokenA'] }), null);
});

/* ---- slice 3: Lunging Attack's movement clause ---- */

test('a movement-gated die needs the attacker to have moved', () => {
    const moved = { actionType: 'mwak', hitTargetIds: ['tokenA'], movedThisTurn: true };
    const still = { actionType: 'mwak', hitTargetIds: ['tokenA'], movedThisTurn: false };
    assert.equal(shouldConsumePendingDie(LUNGE3, moved), true);
    assert.equal(shouldConsumePendingDie(LUNGE3, still), false);
});

test('a missing movedThisTurn is treated as "did not move", not as unknown', () => {
    // Fail closed: a die that quietly pays out without the movement would be plain wrong RAW.
    assert.equal(shouldConsumePendingDie(LUNGE3, { actionType: 'mwak', hitTargetIds: ['tokenA'] }), false);
});

test('the movement clause does not affect maneuvers that do not declare it', () => {
    // Feinting has no movement requirement -- standing still must not block it.
    assert.equal(shouldConsumePendingDie(FEINT, { actionType: 'mwak', hitTargetIds: ['tokenA'], movedThisTurn: false }), true);
});

test('movedFarEnough sums waypoint costs against the grid distance', () => {
    assert.equal(movedFarEnough([{ cost: 5 }], 5), true, 'one square is exactly the threshold');
    assert.equal(movedFarEnough([{ cost: 5 }, { cost: 5 }], 5), true);
    assert.equal(movedFarEnough([], 5), false, 'no movement recorded');
    assert.equal(movedFarEnough([{ cost: 0 }], 5), false, 'a zero-cost waypoint is not movement');
    assert.equal(movedFarEnough([{ cost: 2.5 }], 5), false, 'a sub-threshold gridless leg');
});

test('movedFarEnough ignores the Infinity core seeds for unpriceable waypoints', () => {
    // token.mjs does `waypoint.cost ??= Infinity`; that must neither count as movement nor poison
    // the sum into passing.
    assert.equal(movedFarEnough([{ cost: Infinity }], 5), false);
    assert.equal(movedFarEnough([{ cost: Infinity }, { cost: 5 }], 5), true);
    assert.equal(movedFarEnough([{ cost: NaN }, { cost: null }], 5), false);
});

test('movedFarEnough tolerates junk input', () => {
    assert.equal(movedFarEnough(undefined, 5), false);
    assert.equal(movedFarEnough(null, 5), false);
    assert.equal(movedFarEnough('nope', 5), false);
    assert.equal(movedFarEnough([{}], 5), false);
    // A missing/odd grid distance must not turn into "nothing ever qualifies".
    assert.equal(movedFarEnough([{ cost: 5 }], undefined), true);
});

/* ---- wiring guards: the parts the pure predicate cannot see ---- */

test('outside a started combat the movement requirement is WAIVED, not failed', () => {
    /*
     * Core records movement history only for a combatant in a started combat
     * (TokenDocument#_shouldRecordMovementHistory). Proven live on 2026-07-29: a real walk out of
     * combat left movementHistory empty. Reading it there would mean Lunging NEVER pays out --
     * the die spent for nothing -- so the requirement is waived instead.
     */
    assert.equal(satisfiesMovementRequirement({ historyRecorded: false, movementHistory: [], minimumDistance: 5 }), true);
    assert.equal(satisfiesMovementRequirement({ historyRecorded: false, movementHistory: undefined, minimumDistance: 5 }), true);
});

test('inside a started combat the movement requirement is actually enforced', () => {
    assert.equal(satisfiesMovementRequirement({ historyRecorded: true, movementHistory: [], minimumDistance: 5 }), false);
    assert.equal(satisfiesMovementRequirement({ historyRecorded: true, movementHistory: [{ cost: 5 }], minimumDistance: 5 }), true);
});

test('the driver mirrors core\'s own recording gate rather than reading a maybe-empty array', () => {
    const source = readFileSync(modernManeuvers, 'utf8');
    assert.match(source, /historyRecorded: !!combatant && combatant\.parent\?\.started === true/,
        "must mirror TokenDocument#_shouldRecordMovementHistory (no combatant -> false; else combat.started)");
    assert.match(source, /movementHistory: workflow\.token\?\.document\?\.movementHistory/);
});

test('Lunging Attack does NOT wire CPR\'s Dash macro', () => {
    /*
     * Deliberate: CPR's dash grants no mechanics (its packData effect has zero changes) and its
     * macro is a Crosshairs animation -- and Crosshairs cannot render headless (T72/T91), so wiring
     * it would make this maneuver permanently un-verifiable solo for no mechanical gain.
     */
    const source = readFileSync(modernManeuvers, 'utf8');
    const entry = source.match(/export let maneuversLungingAttack = \{[\s\S]*?\n\};/)?.[0] ?? '';
    assert.ok(entry, 'maneuversLungingAttack entry not found');
    assert.ok(!/dash/i.test(entry), 'Lunging Attack must not route through the Dash macro');
});

test('Lunging Attack reserves no target -- any qualifying melee hit pays out', () => {
    const source = readFileSync(modernManeuvers, 'utf8');
    const fn = source.match(/async function useLungingAttack[\s\S]*?\n\}/)?.[0] ?? '';
    assert.ok(fn, 'useLungingAttack not found');
    assert.ok(!/targetToken/.test(fn), '2024 Lunging pays out on any melee hit, not a chosen target');
    assert.match(fn, /requiresMelee: true/);
    assert.match(fn, /requiresMovement: true/);
});

const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));

test('a consumed die suppresses the driver offer -- one maneuver per attack', () => {
    const source = readFileSync(modernManeuvers, 'utf8');
    assert.match(
        source, /if \(await consumePendingSuperiorityDie\(workflow\)\) return;/,
        'modernHit must return after consuming a banked die, or the attack gets two maneuvers'
    );
});

test('the tracker effect expires with the turn that created it', () => {
    // "this turn". Evasive Footwork uses turnStartSource because its wording is "until the START of
    // your next turn" -- picking the wrong one here would leave the die live into the next round.
    const source = readFileSync(modernManeuvers, 'utf8');
    assert.match(source, /specialDuration: \['turnEndSource', 'combatEnd'\]/);
});

test('Feinting Attack declares its midi item macro in packData, or the pass never runs', () => {
    // The registry entry alone is inert: events/midi.js reads the ITEM's
    // flags['chris-premades'].macros.midi.item to decide what to collect. Cost two rebuilds on T83.
    const pack = JSON.parse(readFileSync(
        fileURLToPath(new URL('../../../packData/cpr-class-features-2024/Maneuvers__Feinting_Attack_cprMnvFeintng024.json', import.meta.url)),
        'utf8'
    ));
    assert.deepEqual(pack.flags['chris-premades'].macros?.midi?.item, ['maneuversFeintingAttack']);
    assert.equal(pack.flags['chris-premades'].info.identifier, 'maneuversFeintingAttack');
    assert.equal(pack._id, 'cprMnvFeintng024');
    assert.equal(pack._key, '!items!cprMnvFeintng024');
});

test('Feinting Attack is exported from the modern registry', () => {
    const source = readFileSync(fileURLToPath(new URL('../../macros.js', import.meta.url)), 'utf8');
    assert.match(source, /\bmaneuversFeintingAttack\b/, 'an unexported maneuver never resolves, silently');
});

test('every 2024 maneuver that re-points its consumption declares activityIdentifiers', () => {
    /*
     * `correctActivityItemConsumption(item, ['use'], …)` resolves 'use' ONLY through
     * `flags.chris-premades.activityIdentifiers`, so a maneuver that registers the `added` passes
     * without that map silently fails to re-point -- leaving consumption aimed at the COMPENDIUM
     * Superiority Dice item ("0 of 1 usage" while Combat Superiority sits at 4/4) and popping an
     * "Activity not found" toast on every add.
     *
     * Batch A shipped Evasive Footwork in exactly that state; found 2026-07-29 and fixed. This guard
     * exists so Batch B cannot repeat it -- Bait and Switch, Commander's Strike, Rally and Parry all
     * spend their own die and will each need the same pairing.
     */
    const source = readFileSync(modernManeuvers, 'utf8');
    const packDir = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/', import.meta.url));
    const files = readdirSync(packDir).filter(f => f.startsWith('Maneuvers__') && f.endsWith('.json'));

    for (const file of files) {
        const pack = JSON.parse(readFileSync(packDir + file, 'utf8'));
        const identifier = pack.flags['chris-premades']?.info?.identifier;
        if (!identifier) continue;
        // Does this maneuver's registry entry wire up the `added` repair passes?
        const entry = source.match(new RegExp(`export let ${identifier} = \\{[\\s\\S]*?\\n\\};`))?.[0];
        if (!entry || !/macro: added/.test(entry)) continue;
        assert.ok(
            pack.flags['chris-premades']?.activityIdentifiers?.use,
            `${file} registers the 'added' consumption re-pointer but declares no ` +
            "activityIdentifiers.use -- the re-point will silently do nothing"
        );
    }
});
