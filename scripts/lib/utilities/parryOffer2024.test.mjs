import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 — Parry's OFFER, and the damage model it forced us to correct.
 *
 * Parry shipped in slice 4a as a macro-free reaction that had to be clicked off the sheet: nothing
 * watched for you being hit. Riposte already offers itself on a miss, so the two reactions behaved
 * inconsistently. This adds the missing half.
 *
 * ⚠️ AND IT CHANGES THE DAMAGE MODEL, deliberately. 2024 RAW: "…you can take a Reaction and expend
 * one Superiority Die to REDUCE THE DAMAGE by the number you roll…". Slice 4a modelled that as
 * retroactive HEALING because that is what the official PHB item does — but the official item does it
 * only because a static encoding cannot reduce damage. With a handler we can, and the difference is
 * not cosmetic:
 *
 *   Xender at 4 HP takes 9 damage and parries for 7.
 *     reduce -> takes 2, ends at 2 HP, still standing.
 *     heal   -> drops to -5, which applies 0 HP / Unconscious / dying and can trigger the whole
 *               death cluster, THEN heals back up.
 *
 * So reduction is not a preference; healing was a fidelity compromise we no longer need.
 */

const packFile = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/Maneuvers__Parry_cprMnvParry02024.json', import.meta.url));
const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));

const pack = () => JSON.parse(readFileSync(packFile, 'utf8'));
const soleActivity = (p) => Object.values(p.system.activities)[0];
const source = () => readFileSync(modernManeuvers, 'utf8');
function handler(name) {
    const fn = source().match(new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}`))?.[0];
    assert.ok(fn, `handler ${name} not found`);
    return fn;
}
// The handler documents the very helper it must not call, so negative assertions have to read CODE.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function registryEntry(identifier) {
    const entry = source().match(new RegExp(`export let ${identifier} = \\{[\\s\\S]*?\\n\\};`))?.[0];
    assert.ok(entry, `${identifier} has no registry entry`);
    return entry;
}

test('Parry is offered when you are hit, from the target side', () => {
    // `targetApplyDamage` is the only pass where the damage item can still be changed before it
    // lands — which is what "reduce the damage" requires. It is also where upstream's legacy entry
    // registers, and where Riposte's sibling gate was built to be shared.
    const entry = registryEntry('maneuversParry');
    assert.match(entry, /actor: \[/, 'the offer has to watch attacks made AGAINST this actor');
    assert.match(entry, /pass: 'targetApplyDamage'/);
    assert.match(entry, /macro: offerParry/);
});

test('Parry REDUCES the damage rather than healing it back', () => {
    /*
     * The correction. `modifyDamageAppliedFlat` also clamps at `-hpDamage - tempDamage`, so a big
     * roll can never turn into accidental healing.
     */
    const fn = handler('offerParry');
    assert.match(fn, /modifyDamageAppliedFlat\(ditem, -/, 'RAW says reduce, and reducing keeps you standing');
    assert.ok(!/healing/i.test(fn), 'the heal model is what this replaces');
});

test('the activity rolls the reduction instead of applying healing', () => {
    // Both paths must agree: an offer that reduces while the sheet button heals would be two
    // different maneuvers wearing one name.
    const act = soleActivity(pack());
    assert.equal(act.type, 'utility', 'a heal activity would apply healing on the sheet path');
    assert.equal(act.activation?.type, 'reaction');
    assert.equal(act.healing, undefined);
});

test('the reduction is die + the BETTER of Str/Dex', () => {
    /*
     * ⚠️ The legacy handler pins this to DEXTERITY (`superiorityDie + ' + @abilities.dex.mod'`).
     * Porting it verbatim would have silently undone Vittorio's max() call — this is its FOURTH site
     * after the save DC, Parry's own encoding, and the 2024 PHB items.
     */
    const formula = soleActivity(pack()).roll?.formula ?? '';
    assert.match(formula, /max\(/);
    assert.match(formula, /@abilities\.str\.mod/);
    assert.match(formula, /@abilities\.dex\.mod/);
    const fn = handler('offerParry');
    assert.ok(!/@abilities\.dex\.mod['"\s]*\)?\s*$/m.test(fn) || /max\(/.test(fn),
        'the handler must not fall back to a Dex-only formula');
});

test('Parry only triggers on a HIT, and only on melee', () => {
    // "When another creature DAMAGES you with a melee attack roll." A miss is Riposte's trigger, not
    // Parry's — the two must never both fire on one attack.
    const fn = handler('offerParry');
    assert.match(fn, /ditem\.isHit/);
    assert.match(fn, /canReactWithManeuver/, 'reuse the shared gate: melee + a die + an unused Reaction');
});

test('Parry and Riposte are mutually exclusive by trigger', () => {
    // Riposte fires when the attacker MISSES you; Parry when they hit. Same shared gate, opposite
    // outcome checks — so a single attack can only ever raise one of them.
    assert.match(handler('offerRiposte'), /if \(workflow\.hitTargets\?\.has\(trigger\.token\)\) return;/);
    assert.match(handler('offerParry'), /if \(!ditem\.isHit\) return;/);
});

test('the prompt is routed to whoever owns the character', () => {
    // Never answer another player's reaction for them; same routing as Riposte and Maneuvering Attack.
    assert.match(handler('offerParry'), /socketUtils\.firstOwner\(item\.parent, true\)/);
});

test('declining costs nothing, and accepting spends exactly one die', () => {
    /*
     * The slice-4c lesson: a gate that can refuse must not have already spent the resource. Here the
     * confirmation happens BEFORE the activity is invoked, so a decline never reaches consumption —
     * and because the activity still carries its own consumption target, accepting spends the die
     * exactly once. The handler must therefore NOT decrement by hand as well.
     */
    const fn = handler('offerParry');
    const confirmAt = fn.indexOf('confirmUseItem');
    const invokeAt = fn.indexOf('syntheticActivityDataRoll');
    assert.ok(confirmAt > 0 && invokeAt > confirmAt, 'ask before spending anything');
    assert.ok(!/system\.uses\.spent/.test(fn), 'the activity consumes the die; a manual spend double-charges');
    assert.equal(soleActivity(pack()).consumption?.targets?.length, 1);
    assert.ok(pack().flags['chris-premades'].activityIdentifiers?.use, 'the §T83 re-pointer needs the map');
    assert.match(registryEntry('maneuversParry'), /macro: added/);
});

test('the roll goes through a helper that actually honours consumeResources', () => {
    /*
     * ⚠️ TRAP, caught before shipping. `syntheticItemDataRoll(itemData, actor, targets, {options,
     * config, killAnim})` accepts NO `consumeResources` — passing one is silently dropped and the die
     * is never spent. That is exactly why upstream's legacy handler decrements by hand after calling
     * it. `syntheticActivityDataRoll` does take the option and forwards it, so consumption stays the
     * activity's job and there is one spend, in one place.
     */
    const fn = handler('offerParry');
    assert.match(fn, /syntheticActivityDataRoll\([\s\S]*?consumeResources: true/);
    assert.ok(
        !/syntheticItemDataRoll/.test(stripComments(fn)),
        'syntheticItemDataRoll drops consumeResources on the floor — the die would never be spent'
    );
});

test('the registry and packData versions agree, and both moved', () => {
    const registryVersion = registryEntry('maneuversParry').match(/version: '([^']+)'/)?.[1];
    assert.equal(registryVersion, pack().flags['chris-premades'].info.version);
    assert.notEqual(registryVersion, '1.0.0', 'the offer plus the damage-model change is a behaviour change');
});
