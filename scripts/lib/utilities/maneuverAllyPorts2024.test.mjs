import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 Batch B slice 4c — the last two maneuvers, and the two that act on an ALLY.
 *
 * Commander's Strike hands your attack to a companion; Bait and Switch swaps places with one. Both
 * therefore prompt the other creature's owner rather than deciding for them, which is the house
 * pattern already set by Maneuvering Attack.
 *
 * Both carry REAL 2024 diffs, and Commander's Strike's legacy handler additionally delivers its die
 * through `system.bonuses.weapon.damage` — the §T93 shape that makes Savage Attacker reroll it.
 * Porting that verbatim would have re-introduced a bug we already paid for once, on a different
 * actor's attack where it would be even harder to spot.
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
// Comments in this module quote the very idioms these guards forbid (slice 4b documents the
// `target[1]` defect verbatim), so a whole-file check has to read CODE, not prose.
const code = () => source().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const soleActivity = (pack) => Object.values(pack.system.activities)[0];
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

test('both slice-4c maneuvers exist in the 2024 pack', () => {
    for (const id of ['maneuversCommandersStrike', 'maneuversBaitAndSwitch']) {
        assert.ok(byIdentifier(id), `${id} missing from cpr-class-features-2024`);
    }
});

test('both spend their die IN THE HANDLER, after every gate -- never via the activity', () => {
    /*
     * ⚠️ FOUND LIVE, and it is the third pattern for spending a superiority die — distinct from both
     * the on-hit riders (driver-spent) and Parry/Rally/Feinting/Lunging (activity-spent).
     *
     * These two are the only maneuvers with gates that can legitimately REFUSE after the use starts:
     * Bait and Switch checks movement and the Incapacitated condition, and both ask the other
     * creature whether they are willing. An activity-level consumption target fires BEFORE the
     * handler, so a refusal cost a die and did nothing — observed live: the movement gate correctly
     * declined and Combat Superiority still went 3 -> 2.
     *
     * Deferring the spend to the end of the handler makes a refusal ZERO-FOOTPRINT, which is the
     * principle already locked for [[informed-reroll-design]]: defer consequences, never
     * apply-then-reverse. A refund would have been the apply-then-reverse shape.
     *
     * Corollary: with no consumption target there is nothing for the §T83 re-pointer to fix, so
     * these two must NOT register the `added` passes — `correctActivityItemConsumption` writes
     * `consumption.targets[0]` unconditionally and throws on an empty array.
     */
    for (const id of ['maneuversCommandersStrike', 'maneuversBaitAndSwitch']) {
        const { file, pack } = byIdentifier(id);
        assert.equal(soleActivity(pack).consumption?.targets?.length, 0,
            `${file} would spend the die before its gates can refuse`);
        assert.ok(!registryEntry(id).includes('macro: added'),
            `${file} has no consumption target, so the re-pointer would throw on an empty array`);
    }
    // ...and the handlers must actually do the spending, or the die is free.
    for (const fn of ['useCommandersStrike', 'useBaitAndSwitch']) {
        assert.match(handler(fn), /system\.uses\.spent/, `${fn} never spends the die`);
    }
});

test('the spend is the LAST thing each handler does', () => {
    // The whole point of deferring: every early return must happen before the die is gone.
    for (const fn of ['useCommandersStrike', 'useBaitAndSwitch']) {
        const body = handler(fn);
        const spendAt = body.indexOf('system.uses.spent');
        const lastReturn = body.lastIndexOf('return;');
        assert.ok(spendAt > 0, `${fn} never spends the die`);
        assert.ok(spendAt > lastReturn, `${fn} can still bail AFTER spending the die`);
    }
});

/* -------------------------------------------------------------- Commander's Strike */

test('Commander\'s Strike REPLACES AN ATTACK -- it is no longer a Bonus Action', () => {
    /*
     * The headline 2024 diff. 2014: "As a bonus action, you can expend one superiority die..."
     * 2024: "When you take the Attack action on your turn, you can REPLACE ONE OF YOUR ATTACKS...".
     * WotC encodes that as no activation cost at all plus a prose condition, which is what the
     * official item does — leaving `bonus` in place would charge the player a Bonus Action they no
     * longer spend.
     */
    const { file, pack } = byIdentifier('maneuversCommandersStrike');
    const act = soleActivity(pack);
    assert.notEqual(act.activation?.type, 'bonus', `${file} still costs a Bonus Action; 2024 replaces an attack`);
    assert.match(
        act.activation?.condition ?? '', /Attack action/i,
        'the replaced-attack rule lives in the activation condition, as on the official item'
    );
});

test('the directed die is APPENDED, never delivered through system.bonuses', () => {
    /*
     * ⚠️ §T93, on someone else's attack. The legacy handler grants
     * `system.bonuses.weapon.damage = <die>`, and dnd5e's `_processDamagePart` folds that into damage
     * part 0 — where `parts.join(' + ')` erases every trace that it was not one of the weapon's own
     * dice. Savage Attacker then rerolls it. `workflowUtils.bonusDamage` appends past
     * `damage.parts.length`, outside every reroll window.
     */
    const fn = handler('commandersStrikeAttackHit');
    assert.match(fn, /workflowUtils\.bonusDamage/);
    assert.ok(
        !/system\.bonuses\.\w+\.damage/.test(code()),
        'the 2024 module must not deliver a superiority die through system.bonuses (T93)'
    );
});

test('the directed die is added ON A HIT only', () => {
    // RAW: "...adding the Superiority Die to the attack's damage roll ON A HIT."
    const fn = handler('commandersStrikeAttackHit');
    assert.match(fn, /hitTargets/, 'a miss must not receive the die');
});

test('the marker must NOT expire on DAE\'s 1Attack -- that races the pass that reads it', () => {
    /*
     * ⚠️ FOUND LIVE, and it is invisible from the code alone. DAE's `1Attack` specialDuration
     * deletes the effect BEFORE midi reaches `damageRollComplete`, so the pass carried BY that
     * effect never runs: the marker vanishes, the Reaction is spent, the die is spent, and no die is
     * appended. Proven as a single-variable A/B in one code state — identical marker, `1Attack` the
     * only difference: with it, damage `1 + 1` and no die; without it, `2d8` appended as its own
     * roll.
     *
     * The handler owns the lifecycle instead (removes the marker on any weapon attack, hit or miss),
     * with turn-end as the outer bound: the ally reacts "immediately", so the offer must not outlive
     * the fighter's turn.
     */
    const fn = handler('useCommandersStrike');
    assert.ok(!/'1Attack'/.test(fn), 'the effect-borne pass cannot read an effect DAE already deleted');
    assert.match(fn, /'turnEndSource'/, 'bound the marker to the fighter\'s turn instead');
    // ...and the macro must then clear it itself, or a hit would leave the marker behind.
    assert.match(handler('commandersStrikeAttackHit'), /genericUtils\.remove\(effect\)/);
});

test('the ally marker is stamped MODERN, or its macro resolves against the legacy registry', () => {
    // The slice-4b landmine, second occurrence: an ActiveEffect's ruleset defaults to 'legacy', and
    // this marker carries its macro by name. Here it would be WORSE than in slice 4b — there is no
    // legacy `commandersStrikeAttack` at all, so the lookup returns undefined and the die silently
    // never lands.
    const fn = handler('useCommandersStrike');
    assert.match(fn, /rules:\s*commandersStrikeAttack\.rules/);
    assert.match(registryEntry('commandersStrikeAttack'), /rules: 'modern'/);
});

test('commandersStrikeAttack is exported from the modern registry', () => {
    assert.match(readFileSync(modernRegistryPath, 'utf8'), /\bcommandersStrikeAttack\b/);
});

test('the companion must be able to SEE OR HEAR you, not just see you', () => {
    // 2024: "choose a willing creature who can see or hear you". `canSense(..., ['all'])` matches on
    // any detection mode the world defines, which with vision-5e installed includes hearing; with it
    // absent this still covers sight, i.e. never worse than the legacy sight-only check.
    const fn = handler('useCommandersStrike');
    assert.match(fn, /canSense\([^)]*\['all'\]\)/);
});

test('the companion spends their own Reaction, and only if they have one', () => {
    const fn = handler('useCommandersStrike');
    assert.match(fn, /hasUsedReaction/, 'an ally who already reacted cannot be directed');
    assert.match(fn, /setReactionUsed/, 'directing an ally costs THEM a Reaction');
});

test('Commander\'s Strike must NOT demand a pre-selected target', () => {
    /*
     * ⚠️ FOUND LIVE. The handler picks its own companion (Argon picker, dialog fallback), but the
     * activity inherited `affects: {type: 'creature', count: '1'}` from the legacy entry — so midi
     * aborts the whole use with "You must target a token before rolling the attack" BEFORE
     * `rollFinished` ever fires. Nothing runs, no card is posted, and the only trace is a warning
     * toast that reads like a player mistake.
     *
     * Maneuvering Attack — the other maneuver that picks an ally in its handler — is the correct
     * shape: no required target. Contrast Bait and Switch, which reads `workflow.targets.first()`
     * and therefore SHOULD declare one.
     */
    const { file, pack } = byIdentifier('maneuversCommandersStrike');
    const affects = soleActivity(pack).target?.affects ?? {};
    assert.equal(affects.type, '', `${file} would abort before the handler runs`);
    assert.equal(affects.count, '');
});

test('Bait and Switch DOES declare its target -- its handler reads workflow.targets', () => {
    const { pack } = byIdentifier('maneuversBaitAndSwitch');
    assert.equal(soleActivity(pack).target?.affects?.type, 'willing');
    assert.match(handler('useBaitAndSwitch'), /workflow\.targets\.first\(\)/);
});

test('the companion\'s owner is asked before their Reaction is spent', () => {
    // Never spend another player's Reaction silently. Same shape as Maneuvering Attack.
    const fn = handler('useCommandersStrike');
    assert.match(fn, /socketUtils\.firstOwner/);
});

/* ----------------------------------------------------------------- Bait and Switch */

test('Bait and Switch requires 5 feet of movement, reusing the Lunging Attack predicate', () => {
    /*
     * REAL 2024 DIFF: "...provided you SPEND AT LEAST 5 FEET OF MOVEMENT...". The legacy handler has
     * no movement test at all. Slice 3 already solved this shape — including the trap that core
     * records movement history ONLY for a combatant in a started combat, so a naive read makes the
     * whole maneuver a dead feature out of combat.
     */
    const fn = handler('useBaitAndSwitch');
    assert.match(fn, /satisfiesMovementRequirement/);
});

test('Bait and Switch excludes an Incapacitated creature', () => {
    // REAL 2024 DIFF: "...and the creature is willing and doesn't have the Incapacitated condition."
    const fn = handler('useBaitAndSwitch');
    assert.match(fn, /checkIncapacitated/);
});

test('the other creature is ASKED -- "willing" is not assumed from disposition', () => {
    // You are moving someone else's character. 2024 states willingness as a condition of the
    // maneuver, and the official item encodes the target type as literally `willing`.
    const fn = handler('useBaitAndSwitch');
    assert.match(fn, /socketUtils\.firstOwner/);
    const { pack } = byIdentifier('maneuversBaitAndSwitch');
    assert.equal(soleActivity(pack).target?.affects?.type, 'willing');
});

test('the AC bonus lasts until the START of your next turn', () => {
    /*
     * REAL 2024 DIFF in the encoding, not the text: "Until the start of your next turn...". The
     * legacy effect is a bare `duration: {rounds: 1}`, which expires on a round boundary rather than
     * on the fighter's own turn — the same correction Evasive Footwork needed.
     */
    const fn = handler('useBaitAndSwitch');
    assert.match(fn, /'turnStartSource'/);
});

test('the AC bonus can go to EITHER party', () => {
    // "you or the other creature (your choice)" — both branches must be reachable.
    const fn = handler('useBaitAndSwitch');
    assert.match(fn, /BaitSwitchAC/, 'the who-gets-it prompt');
    assert.match(fn, /\?\s*targetToken\.actor\s*:\s*workflow\.actor|\?\s*workflow\.actor\s*:\s*targetToken\.actor/);
});

test('the swap does not provoke Opportunity Attacks', () => {
    /*
     * RAW says so outright: "This movement doesn't provoke Opportunity Attacks." Under v13's
     * movement pipeline a plain x/y update is a real move and region/OA watchers see it, so the swap
     * has to be marked as a displacement rather than walked.
     */
    const fn = handler('useBaitAndSwitch');
    assert.match(fn, /action: 'displace'|teleport: true/);
});

test('Bait and Switch reaches only 5 feet', () => {
    // "When you're within 5 FEET of a creature on your turn".
    const { file, pack } = byIdentifier('maneuversBaitAndSwitch');
    const range = soleActivity(pack).range;
    assert.equal(range?.units, 'ft', `${file} should measure its range in feet`);
    assert.equal(String(range?.value), '5');
});

/* ------------------------------------------------------------------------- both ends */

test('both slice-4c maneuvers are exported from the modern registry', () => {
    const registry = readFileSync(modernRegistryPath, 'utf8');
    for (const id of ['maneuversCommandersStrike', 'maneuversBaitAndSwitch']) {
        assert.match(registry, new RegExp(`\\b${id}\\b`), `${id} unexported -- it would never resolve`);
    }
});

test('both packData entries name the handlers the registry actually defines', () => {
    for (const id of ['maneuversCommandersStrike', 'maneuversBaitAndSwitch']) {
        const { file, pack } = byIdentifier(id);
        assert.deepEqual(pack.flags['chris-premades'].macros?.midi?.item, [id],
            `${file} must declare its own midi.item macro, or the handler never runs`);
    }
});

test('neither ally pick is gated on the "skip dead and unconscious" checkbox', () => {
    // The upstream defect fixed in slice 4b, third occurrence: `selectTargetDialog` returns
    // `[result, skip]` and `skip` is a checkbox, not a confirmation.
    const whole = code();
    assert.ok(!/!selected\[1\]/.test(whole), 'selected[1] is the skip checkbox, not a confirmation');
    assert.ok(!/!target\[1\]/.test(whole), 'target[1] is the skip checkbox, not a confirmation');
});

test('T81 IS COMPLETE: all 20 maneuvers are exported from the modern registry', () => {
    /*
     * The closing tripwire for the whole item. An unported maneuver fails SILENTLY — it simply never
     * appears in the driver's prompt, which is how all 23 went unnoticed for months. This asserts the
     * full 2024 inventory rather than counting, so a regression names the missing one.
     */
    const ALL = [
        'maneuversAmbush', 'maneuversBaitAndSwitch', 'maneuversCommandersStrike',
        'maneuversCommandingPresence', 'maneuversDisarmingAttack', 'maneuversDistractingStrike',
        'maneuversEvasiveFootwork', 'maneuversFeintingAttack', 'maneuversGoadingAttack',
        'maneuversLungingAttack', 'maneuversManeuveringAttack', 'maneuversMenacingAttack',
        'maneuversParry', 'maneuversPrecisionAttack', 'maneuversPushingAttack', 'maneuversRally',
        'maneuversRiposte', 'maneuversSweepingAttack', 'maneuversTacticalAssessment',
        'maneuversTripAttack'
    ];
    const registry = readFileSync(modernRegistryPath, 'utf8');
    const missing = ALL.filter(id => !new RegExp(`\\b${id}\\b`).test(registry));
    assert.deepEqual(missing, [], 'these 2024 maneuvers are not registered and would fail silently');
    assert.equal(ALL.length, 20);
});
