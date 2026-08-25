import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyOffhandAttack, shouldDefaultOffhand } from './lightWeaponEconomy.mjs';

/*
 * T163 — Nick mastery + the Light-property attack economy, three layers:
 *   1. an offhand-mode attack marks the bonus action used (nothing did — midi keys its tracking
 *      on the ACTIVITY's activation type, and a weapon attack is 'action' whatever Argon panel
 *      launched it);
 *   2. the attack mode defaults to offhand when the actor already attacked with a DIFFERENT Light
 *      weapon this turn (midi's fast-forward makes the default the outcome);
 *   3. Nick itself — the one mastery of eight nothing implemented: a mastered nick weapon's extra
 *      attack folds into the Attack action, leaving the bonus action free. Once per turn.
 */

test('T163: an offhand attack with a mastered nick weapon folds into the Attack action', () => {
    assert.deepEqual(
        classifyOffhandAttack({attackMode: 'offhand', weaponMastery: 'nick', actorMasters: true, nickUsedThisTurn: false}),
        {kind: 'nick-extra'});
});

test('T163: nick folds only once per turn — the second offhand attack is a bonus-action extra', () => {
    assert.deepEqual(
        classifyOffhandAttack({attackMode: 'offhand', weaponMastery: 'nick', actorMasters: true, nickUsedThisTurn: true}),
        {kind: 'bonus-extra'});
});

test('T163: without mastery (or with another mastery) the offhand extra costs the bonus action', () => {
    // Warpey's exact case: scimitar carries nick as its AVAILABLE mastery, but he masters
    // [longbow, shortsword] — the actor mastery is what activates it, not the weapon label.
    assert.deepEqual(
        classifyOffhandAttack({attackMode: 'offhand', weaponMastery: 'nick', actorMasters: false, nickUsedThisTurn: false}),
        {kind: 'bonus-extra'});
    assert.deepEqual(
        classifyOffhandAttack({attackMode: 'offhand', weaponMastery: 'vex', actorMasters: true, nickUsedThisTurn: false}),
        {kind: 'bonus-extra'});
});

test('T163: a non-offhand attack is no extra at all', () => {
    assert.deepEqual(
        classifyOffhandAttack({attackMode: 'oneHanded', weaponMastery: 'nick', actorMasters: true, nickUsedThisTurn: false}),
        {kind: 'none'});
    assert.deepEqual(
        classifyOffhandAttack({attackMode: undefined, weaponMastery: 'nick', actorMasters: true, nickUsedThisTurn: false}),
        {kind: 'none'});
});

test('T163: the mode defaults to offhand after a different Light weapon attacked this turn', () => {
    assert.equal(shouldDefaultOffhand({isLightWeapon: true, hasOffhandMode: true, lightMainThisTurn: true, sameItem: false, extraUsedThisTurn: false}), true);
});

test('T163: the offhand default never fires for the same weapon, a used extra, or outside the setup', () => {
    const base = {isLightWeapon: true, hasOffhandMode: true, lightMainThisTurn: true, sameItem: false, extraUsedThisTurn: false};
    assert.equal(shouldDefaultOffhand({...base, sameItem: true}), false, 'the SAME weapon again is not the Light extra');
    assert.equal(shouldDefaultOffhand({...base, extraUsedThisTurn: true}), false, 'the extra happens once per turn');
    assert.equal(shouldDefaultOffhand({...base, lightMainThisTurn: false}), false, 'no Light attack yet this turn');
    assert.equal(shouldDefaultOffhand({...base, isLightWeapon: false}), false);
    assert.equal(shouldDefaultOffhand({...base, hasOffhandMode: false}), false);
});

test('T163: the impure wrapper is wired — rollFinished economy + the preRollAttackV2 default', () => {
    const mech = readFileSync(fileURLToPath(new URL('../../macros/2024/mechanics/lightWeaponEconomy.js', import.meta.url)), 'utf8');
    assert.match(mech, /MidiQOL\?\.setBonusActionUsed\?\.\(/);
    assert.match(mech, /MidiQOL\?\.hasUsedBonusAction\?\.\(/);
    assert.match(mech, /dnd5e\.preRollAttackV2/);
    assert.match(mech, /attackMode = 'offhand'/);
    // per-turn state lives in the masteries flag namespace so combatEnd cleans it with the rest
    assert.match(mech, /'chris-premades', 'mastery\./);
    const midi = readFileSync(fileURLToPath(new URL('../../events/midi.js', import.meta.url)), 'utf8');
    assert.match(midi, /lightWeaponEconomy\.RollComplete\(workflow\)/);
});

test('T163: the table feedback strings exist, en and it', () => {
    const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../../lang/en.json', import.meta.url)), 'utf8'));
    const it = JSON.parse(readFileSync(fileURLToPath(new URL('../../../lang/it.json', import.meta.url)), 'utf8'));
    for (const lang of [en, it]) {
        const keys = lang.CHRISPREMADES.Macros.LightWeaponEconomy ?? {};
        for (const k of ['NickFold', 'OffhandMarked', 'OffhandNoBonus']) assert.ok(keys[k], k + ' missing');
    }
});
