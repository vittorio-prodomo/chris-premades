import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Guard — the 2024 Battle Master maneuver save DC is "8 + PB + your Strength OR
 * Dexterity modifier (your choice)", so it must NOT be pinned to one ability.
 *
 * Every 2024 maneuver shipped before 2026-07-29 encoded dc.calculation = 'str',
 * which silently computed a Dex-based Battle Master's DC off Strength (Goading
 * Attack from T56, plus Disarming and Menacing Attack from T81 Batch A). The
 * defect was invisible at the table only because the one live Battle Master is
 * Strength-based.
 *
 * dnd5e falls through to an arbitrary roll formula whenever dc.calculation is
 * EMPTY (SaveActivityData#prepareFinalData: `if (calculation) ability = this.ability;
 * else dc.value = simplifyBonus(dc.formula, rollData)`), and Foundry's roll parser
 * exposes every Math function (FunctionTerm: `CONFIG.Dice.functions[fn] ?? Math[fn]`)
 * evaluated synchronously for deterministic terms. So "the better of the two" is
 * expressible statically -- no macro, no prompt -- via max().
 *
 * These tests exist mainly for T81 Batch B: Pushing Attack and Trip Attack are the
 * only remaining save-bearing maneuvers, and copying the 2014 encoding forward would
 * re-introduce exactly this bug.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/', import.meta.url));

const EXPECTED_FORMULA = '8 + @prof + max(@abilities.str.mod, @abilities.dex.mod)';

function maneuverItems() {
    return readdirSync(packDir)
        .filter(file => file.startsWith('Maneuvers__') && file.endsWith('.json'))
        .map(file => ({file, data: JSON.parse(readFileSync(packDir + file, 'utf8'))}));
}

function saveActivities({data}) {
    return Object.entries(data.system?.activities ?? {})
        .filter(([, activity]) => activity?.save)
        .map(([id, activity]) => ({id, save: activity.save}));
}

test('the 2024 maneuver pack actually contains maneuvers with saves', () => {
    const items = maneuverItems();
    assert.ok(items.length > 0, 'no Maneuvers__* entries found -- did the pack move?');
    const withSaves = items.filter(item => saveActivities(item).length > 0);
    assert.ok(withSaves.length > 0, 'no save-bearing maneuver found -- this guard would pass vacuously');
});

test('no 2024 maneuver pins its save DC to a single ability', () => {
    for (const item of maneuverItems()) {
        for (const {id, save} of saveActivities(item)) {
            assert.equal(
                save.dc?.calculation, '',
                `${item.file} [${id}] pins the maneuver DC to '${save.dc?.calculation}'. ` +
                'The 2024 DC is Str OR Dex (your choice) -- leave calculation empty and use the formula.'
            );
        }
    }
});

test('every 2024 maneuver save DC takes the better of Strength and Dexterity', () => {
    for (const item of maneuverItems()) {
        for (const {id, save} of saveActivities(item)) {
            assert.equal(
                save.dc?.formula, EXPECTED_FORMULA,
                `${item.file} [${id}] has an unexpected maneuver DC formula.`
            );
        }
    }
});

test('the DC formula is deterministic -- no dice terms, or dnd5e silently resolves it to 0', () => {
    // simplifyBonus() returns 0 unless roll.isDeterministic, and dc.value is then
    // set to 0 rather than falling back, so a stray die would ship a DC of 0.
    assert.ok(!/\dd\d/i.test(EXPECTED_FORMULA), 'formula must not contain a dice term');
});

test('the DC formula only references roll data dnd5e actually provides', () => {
    // @prof comes from ActorData#getRollData (new Proficiency(prof, 1)); ability mods
    // from @abilities.<id>.mod. A typo here fails silently as a 0 contribution.
    const references = [...EXPECTED_FORMULA.matchAll(/@([\w.]+)/g)].map(match => match[1]);
    assert.deepEqual(
        references.sort(),
        ['abilities.dex.mod', 'abilities.str.mod', 'prof']
    );
});
