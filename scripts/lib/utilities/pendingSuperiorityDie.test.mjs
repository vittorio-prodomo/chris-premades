import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldConsumePendingDie, selectPendingDie } from './pendingSuperiorityDie.mjs';

/*
 * T81 Batch B slice 2 — the "next attack this turn" tracker.
 *
 * Feinting Attack (and Lunging Attack in slice 3) spend their superiority die UP FRONT as a Bonus
 * Action, then pay out on a later qualifying hit. The die is therefore already gone when these
 * predicates run: the only question is whether THIS attack is the one it lands on.
 */

const FEINT = { identifier: 'maneuversFeintingAttack', name: 'Maneuvers: Feinting Attack', die: 'd8', targetId: 'tokenA' };
const LUNGE = { identifier: 'maneuversLungingAttack', name: 'Maneuvers: Lunging Attack', die: 'd8', requiresMelee: true };

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

/* ---- wiring guards: the parts the pure predicate cannot see ---- */

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
