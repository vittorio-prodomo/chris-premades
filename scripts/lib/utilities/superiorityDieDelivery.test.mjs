import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T93 guard — a superiority die must never be folded into the attack's OWN damage parts.
 *
 * WHY THIS IS A RULE AND NOT A STYLE PREFERENCE:
 * dnd5e composes an activity's damage roll in `_processDamagePart`, and for damage part
 * index 0 ONLY it does `parts.push(actor.system.bonuses[actionType].damage)`; the parts are
 * then flattened by `BasicRoll.fromConfig` with `parts.join(" + ")`. So a die delivered via a
 * `system.bonuses.<actionType>.damage` ActiveEffect lands INSIDE `workflow.damageRolls[0]`
 * and is textually indistinguishable from the weapon's own dice — no term-level provenance
 * survives the join.
 *
 * Savage Attacker rerolls `workflow.damageRolls[i].formula` for i < activity.damage.parts.length
 * (`2024/feats/savageAttacker.js`), so anything folded into part 0 gets rerolled with the
 * weapon's dice. RAW that is wrong: the feat rerolls "the weapon's damage dice", and a
 * superiority die is granted by the maneuver and merely ADDED to the attack's damage roll.
 * Riposte shipped exactly this bug (observed at the table 2026-07-27).
 *
 * The correct delivery is `workflowUtils.bonusDamage`, which APPENDS a separate roll at index
 * >= damage.parts.length — outside Savage Attacker's reroll window, which is why every
 * driver-invoked maneuver was already correct.
 *
 * ⚠️ This guard covers the whole 2024 battleMaster directory on purpose: Parry (T81 Batch B) is
 * the other Reaction maneuver and will be written against the same shape.
 */

const battleMasterDir = fileURLToPath(
    new URL('../../macros/2024/classFeatures/fighter/battleMaster/', import.meta.url)
);
const savageAttackerPath = fileURLToPath(
    new URL('../../macros/2024/feats/savageAttacker.js', import.meta.url)
);

function battleMasterSources() {
    return readdirSync(battleMasterDir)
        .filter(file => file.endsWith('.js'))
        .map(file => ({file, source: readFileSync(battleMasterDir + file, 'utf8')}));
}

/**
 * Strip line and block comments so the guards match real code, not the prose explaining it.
 * Deliberately crude — these sources have no regex literals or strings containing `//`.
 */
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Pull `{pass, priority}` pairs out of a macro registry block. The registry is a plain object
 * literal, so the two keys always appear together and in that order.
 */
function registeredPasses(source) {
    const passes = [];
    const re = /pass:\s*'([^']+)'[\s\S]{0,120}?priority:\s*(\d+)/g;
    for (const match of stripComments(source).matchAll(re)) {
        passes.push({pass: match[1], priority: Number(match[2])});
    }
    return passes;
}

test('no 2024 Battle Master maneuver delivers damage through a system.bonuses damage effect', () => {
    for (const {file, source} of battleMasterSources()) {
        const offenders = [...stripComments(source).matchAll(/system\.bonuses\.[a-z]+\.damage/g)];
        assert.deepEqual(
            offenders.map(m => m[0]),
            [],
            `${file} delivers damage via a global damage-bonus effect. dnd5e folds that into `
            + 'damage part 0, where Savage Attacker rerolls it together with the weapon dice '
            + '(T93). Use workflowUtils.bonusDamage instead, which appends a separate roll.'
        );
    }
});

test('Riposte adds its superiority die as an appended bonus damage roll', () => {
    const source = stripComments(
        readFileSync(battleMasterDir + 'maneuvers.js', 'utf8')
    );
    assert.match(
        source,
        /bonusDamage\(/,
        'Riposte must deliver its superiority die through workflowUtils.bonusDamage so the die '
        + 'lands outside the activity damage parts that Savage Attacker rerolls (T93).'
    );
});

test('the pass that appends the superiority die runs after Savage Attacker rerolls', () => {
    /*
     * CPR sorts triggers ascending (`events/midi.js`: sort((a, b) => a.priority - b.priority)),
     * so a LOWER priority runs FIRST. Savage Attacker's damageRollComplete pass must run before
     * the die is appended, otherwise the appended roll is present in workflow.damageRolls while
     * Savage Attacker is choosing — harmless for the reroll window today, but the ordering is
     * what makes "outside the window" true by construction rather than by accident.
     */
    const savageAttacker = registeredPasses(readFileSync(savageAttackerPath, 'utf8'))
        .find(i => i.pass === 'damageRollComplete');
    assert.ok(savageAttacker, 'Savage Attacker no longer registers a damageRollComplete pass');

    const riposteDamagePasses = registeredPasses(
        readFileSync(battleMasterDir + 'maneuvers.js', 'utf8')
    ).filter(i => i.pass === 'damageRollComplete');
    assert.ok(
        riposteDamagePasses.length,
        'Riposte registers no damageRollComplete pass, so its superiority die is never appended (T93)'
    );

    for (const pass of riposteDamagePasses) {
        assert.ok(
            pass.priority > savageAttacker.priority,
            `a damageRollComplete pass at priority ${pass.priority} runs at or before Savage `
            + `Attacker (${savageAttacker.priority}); the superiority die would be visible to the `
            + 'reroll. Give it a higher number so it runs later.'
        );
    }
});
