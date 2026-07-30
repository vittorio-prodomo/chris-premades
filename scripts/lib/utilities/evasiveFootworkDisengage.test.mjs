import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 slice 5 — Evasive Footwork's DISENGAGE half.
 *
 * 2024: "As a Bonus Action, you can expend one Superiority Die and TAKE THE DISENGAGE ACTION. You
 * also roll the die and add the number rolled to your AC until the start of your next turn."
 *
 * Batch A ported the Bonus Action, the AC bonus and the until-your-next-turn duration, and flagged
 * the Disengage half as needing more than an encoding. It turned out to need only a second effect —
 * but NOT one that could be folded into the first, because the two halves expire at different
 * moments. That asymmetry is what these guards exist for.
 *
 * ⚠️ This is a real mechanical gap, not a cosmetic one: CPR's Disengage action grants
 * `flags.gambits-premades.oaImmunity`, which our GPS fork reads in
 * `automations/genericFeatures/opportunityAttack.js` to suppress the opportunity-attack offer
 * against the moving token (verified in GPS source, 2026-07-30). Contrast Dash, which CPR models as
 * pure animation with zero changes — which is exactly why slice 3 deliberately did NOT automate
 * Lunging Attack's Dash.
 */

const packFile = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/Maneuvers__Evasive_Footwork_cprMnvEvasive024.json', import.meta.url));
const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));

const pack = () => JSON.parse(readFileSync(packFile, 'utf8'));
const soleActivity = (p) => Object.values(p.system.activities)[0];
const effectNamed = (p, re) => (p.effects ?? []).find(e => re.test(e.name));
const specialDuration = (effect) => effect?.flags?.dae?.specialDuration ?? [];

test('Evasive Footwork ships the Disengage half as its own effect', () => {
    const p = pack();
    const disengage = effectNamed(p, /disengage/i);
    assert.ok(disengage, 'the 2024 text says "and take the Disengage action" — nothing granted it');
});

test('the Disengage half grants exactly the flag GPS reads', () => {
    /*
     * GPS checks `token.actor.flags['gambits-premades'].oaImmunity` on the MOVING token and returns
     * before offering the attack. Mode 5 is OVERRIDE, matching CPR's own Disengage action — the flag
     * is a boolean-ish marker, so adding rather than overriding would be meaningless.
     */
    const disengage = effectNamed(pack(), /disengage/i);
    const change = (disengage.changes ?? []).find(c => c.key === 'flags.gambits-premades.oaImmunity');
    assert.ok(change, 'without this exact key GPS still offers the opportunity attack');
    assert.equal(change.mode, 5);
    assert.ok(change.value, 'the flag must be truthy — GPS tests it directly');
});

test('⚠️ the two halves expire at DIFFERENT moments, and must not share an effect', () => {
    /*
     * THE WHOLE REASON THIS IS TWO EFFECTS. RAW gives them different windows:
     *   - AC bonus:     "until the START OF YOUR NEXT TURN"  -> turnStartSource
     *   - Disengage:    "for the rest of the turn"           -> turnEnd
     *
     * Folding the flag into the AC effect would extend opportunity-attack immunity across every
     * other creature's turn until your next one begins. That is not theoretical: you can be moved
     * on someone else's turn by a reaction — Maneuvering Attack, which we shipped, does exactly
     * that — and you would wrongly be immune while it happened.
     */
    const p = pack();
    const ac = effectNamed(p, /evasive footwork/i);
    const disengage = effectNamed(p, /disengage/i);
    assert.deepEqual(specialDuration(ac), ['turnStartSource'], 'AC lasts until the start of your next turn');
    assert.deepEqual(specialDuration(disengage), ['turnEnd'], 'Disengage only lasts the rest of THIS turn');
    assert.notDeepEqual(specialDuration(ac), specialDuration(disengage));
    // ...and the AC effect must not have quietly acquired the flag as well.
    assert.ok(
        !(ac.changes ?? []).some(c => c.key === 'flags.gambits-premades.oaImmunity'),
        'the AC effect outlives your turn; it must never carry the immunity'
    );
});

test('the activity applies BOTH effects', () => {
    // An effect present in `effects[]` but absent from the activity's own list is simply never
    // applied — the item would look correct and do nothing.
    const p = pack();
    const applied = new Set((soleActivity(p).effects ?? []).map(e => e._id));
    for (const effect of p.effects) {
        assert.ok(applied.has(effect._id), `effect "${effect.name}" is never applied by the activity`);
    }
    assert.equal(applied.size, 2);
});

test('Evasive Footwork stays macro-free', () => {
    /*
     * The Disengage half needed no handler in the end — only a second effect. Keeping it macro-free
     * matters because the alternative considered was invoking CPR's own Disengage action item, which
     * would have made the maneuver depend on the actor HAVING that item and dragged in its Sequencer
     * animation (which routes through Crosshairs, unrenderable headless — T72/T91).
     */
    const p = pack();
    assert.equal(p.flags['chris-premades'].macros?.midi, undefined, 'no midi passes should be needed');
    const entry = readFileSync(modernManeuvers, 'utf8')
        .match(/export let maneuversEvasiveFootwork = \{[\s\S]*?\n\};/)?.[0] ?? '';
    assert.ok(entry, 'registry entry not found');
    assert.ok(!/midi:/.test(entry), 'the registry entry should register no midi passes');
    // It DOES keep the §T83 repair passes: it is the one Batch A maneuver with its own consumption
    // target, and that pairing is what Batch A originally got wrong.
    assert.match(entry, /macro: added/);
    assert.ok(pack().flags['chris-premades'].activityIdentifiers?.use);
});

test('it does not stack with the real Disengage action', () => {
    // A player who takes Disengage AND uses Evasive Footwork should end up with one marker, not two.
    // DAE's `noneName` de-dupes by name, so the effect is deliberately called "Disengage" — which
    // also means the player reads what they actually have rather than a maneuver name.
    const disengage = effectNamed(pack(), /disengage/i);
    assert.equal(disengage.name, 'Disengage');
    assert.equal(disengage.flags?.dae?.stackable, 'noneName');
});

test('the registry and packData versions agree', () => {
    // ⚠️ `isUpToDate` reads the registry stamp while the packData carries its own; bumping only one
    // means an already-deployed item never reports out of date.
    const entry = readFileSync(modernManeuvers, 'utf8')
        .match(/export let maneuversEvasiveFootwork = \{[\s\S]*?\n\};/)?.[0] ?? '';
    const registryVersion = entry.match(/version: '([^']+)'/)?.[1];
    assert.equal(registryVersion, pack().flags['chris-premades'].info.version);
    assert.notEqual(registryVersion, '1.0.1', 'shipping the Disengage half is a behaviour change — bump');
});
