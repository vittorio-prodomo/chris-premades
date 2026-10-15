/*
 * T249 — Plunging Attack (homebrew table rule, notes/table-rules/plunging-attack.md): the chosen
 * melee weapon's own attack after the drop, with the fall dice added outside the weapon's dice.
 * ⚠️ midi-qol.DamageRollComplete is awaited (callMidiHooks → asyncHooksCallAll) and fires after the
 * damage rolls exist and before they are displayed/applied; midiOptions.workflowOptions reaches
 * workflow.workflowOptions — both read in our midi source 2026-10-15.
 */
import {dialogUtils, effectUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';
import {plungeSplit} from '../../../lib/utilities/dropRules.mjs';
import {chooseLandingSquare, pickSingleTarget, resolveDropHeight, rollFallDice, stampCard} from './dropShared.js';
import {flyTo} from './jumpFlight.js';
const P = 'CHRISPREMADES.Macros.PlungingAttack.';
function meleeWeapons(actor) {
    let weapons = actor.items.filter(i => i.type === 'weapon' && i.system.attackType === 'melee');
    return weapons.sort((a, b) => Number(!!b.system.equipped) - Number(!!a.system.equipped));
}
async function use({trigger, workflow}) {
    let token = workflow.token;
    if (!token) return;
    let weapons = meleeWeapons(workflow.actor);
    if (!weapons.length) {
        genericUtils.notify(P + 'NoWeapon', 'warn');
        return;
    }
    let target = await pickSingleTarget(token, 'CHRISPREMADES.Macros.DropAttack.PickStrike');
    if (!target) return;
    let weapon = weapons.length === 1 ? weapons[0] : await dialogUtils.selectDocumentDialog(workflow.item.name, P + 'PickWeapon', weapons);
    if (!weapon) return;
    let height = await resolveDropHeight(token, target, workflow.item.name);
    if (!height) return;
    if (height <= 10) {
        genericUtils.notify(P + 'TooLow', 'warn');
        return;
    }
    let landing = await chooseLandingSquare({token, target, item: workflow.item});
    if (!landing) return;
    let sounds = {runUp: null, takeoff: itemUtils.getConfig(workflow.item, 'takeoffSound'), landing: itemUtils.getConfig(workflow.item, 'landingSound')};
    await flyTo({token, position: landing.position, destination: landing.destination, distance: landing.feet, cost: landing.verdict.cost, sounds, playRunUp: false, playAnimation: itemUtils.getConfig(workflow.item, 'playAnimation')});
    let fall = await rollFallDice(height, workflow.actor);
    let split = plungeSplit(height, fall.total);
    let damageType = [...(weapon.system.damage?.base?.types ?? [])][0] ?? 'bludgeoning';
    let nonce = foundry.utils.randomID();
    // The fall share joins the weapon's damage as a FLAT number outside its dice: a crit cannot
    // double it, and Savage Attacker's reroll window (the weapon's own parts) never reaches it (T93).
    let hookId = Hooks.on('midi-qol.DamageRollComplete', async attackWorkflow => {
        if (attackWorkflow.workflowOptions?.cprPlunge !== nonce) return;
        if (split.target) await workflowUtils.bonusDamage(attackWorkflow, String(split.target), {ignoreCrit: true, damageType});
    });
    let attack;
    try {
        attack = await workflowUtils.completeItemUse(weapon, {}, {targetUuids: [target.document.uuid], workflowOptions: {cprPlunge: nonce}});
    } finally {
        Hooks.off('midi-qol.DamageRollComplete', hookId);
    }
    let hit = !!attack?.hitTargets?.size;
    let lines = [genericUtils.format(P + 'Summary', {height, dice: fall.total})];
    if (hit) {
        if (split.faller) await workflowUtils.applyDamage([token], split.faller, 'bludgeoning');
        lines.push(genericUtils.format(P + 'Hit', {target: target.name, targetDamage: split.target, fallerDamage: split.faller}));
    } else {
        await workflowUtils.applyDamage([token], fall.total, 'bludgeoning');
        await effectUtils.applyConditions(workflow.actor, ['prone']);
        lines.push(genericUtils.format(P + 'Miss', {damage: fall.total}));
    }
    await stampCard(workflow, lines);
}
export let plungingAttack = {
    name: 'Plunging Attack',
    version: '1.5.46',
    rules: 'modern',
    midi: {item: [{pass: 'rollFinished', macro: use, priority: 50}]},
    config: [
        {value: 'playAnimation', label: 'CHRISPREMADES.Config.PlayAnimation', type: 'checkbox', default: true, category: 'animation'},
        {value: 'takeoffSound', label: 'CHRISPREMADES.Macros.Jump.Config.TakeoffSound', type: 'file', default: 'modules/animated-spell-effects-cartoon/sound-fx/swoosh/sfx_swoosh_fast_01.ogg', category: 'sound'},
        {value: 'landingSound', label: 'CHRISPREMADES.Macros.Jump.Config.LandingSound', type: 'file', default: 'modules/psfx-patreon/library/creature/movement/flight/landing/landing-impact-small-001.ogg', category: 'sound'}
    ]
};
