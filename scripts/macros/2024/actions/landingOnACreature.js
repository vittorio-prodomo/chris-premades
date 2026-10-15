/*
 * T249 — Landing on a Creature (homebrew table rule, notes/table-rules/landing-on-a-creature.md).
 * Aim (Acrobatics vs the height DC), the target's reaction dodge through GPS, split damage, Prone.
 */
import {actorUtils, effectUtils, genericUtils, itemUtils, rollUtils, workflowUtils} from '../../../utils.js';
import {aimMode, heightDC, knockedProne, landingMissDamage, landingOutcome, landingSplit} from '../../../lib/utilities/dropRules.mjs';
import {chooseLandingSquare, pickSingleTarget, resolveDropHeight, rollFallDice, stampCard} from './dropShared.js';
import {flyTo} from './jumpFlight.js';
const L = 'CHRISPREMADES.Macros.LandingOnACreature.';
async function use({trigger, workflow}) {
    let token = workflow.token;
    if (!token) return;
    let target = await pickSingleTarget(token, 'CHRISPREMADES.Macros.DropAttack.PickLand');
    if (!target) return;
    let height = await resolveDropHeight(token, target, workflow.item.name);
    if (!height) return;
    let landing = await chooseLandingSquare({token, target, item: workflow.item});
    if (!landing) return;
    let dc = heightDC(height);
    let mode = aimMode(actorUtils.getSize(workflow.actor, true), actorUtils.getSize(target.actor, true));
    let aim = await rollUtils.requestRoll(token, 'skill', 'acr', {target: dc, advantage: mode === 'advantage', disadvantage: mode === 'disadvantage'});
    // requestRoll comes back through midi's socket as an ARRAY of rolls (grapple.js reads [0]).
    let aimTotal = Number((Array.isArray(aim) ? aim[0] : aim)?.total);
    if (!Number.isFinite(aimTotal)) return;
    let undetected = workflow.actor.statuses.has('invisible') || workflow.actor.statuses.has('hiding');
    let dodge = {offered: false, accepted: false, total: null};
    if (aimTotal >= dc && !undetected && game.gps?.offerReactionSave) {
        dodge = await game.gps.offerReactionSave({
            targetTokenUuid: target.document.uuid, ability: 'dex', dc: aimTotal,
            title: workflow.item.name,
            text: genericUtils.format(L + 'DodgePrompt', {faller: token.name, dc: aimTotal})
        });
    }
    let outcome = landingOutcome({aimTotal, dc, undetected, dodgeSave: dodge.accepted ? dodge.total : null});
    let sounds = {runUp: null, takeoff: itemUtils.getConfig(workflow.item, 'takeoffSound'), landing: itemUtils.getConfig(workflow.item, 'landingSound')};
    let distance3d = token.document.measureMovementPath([{x: token.document.x, y: token.document.y, elevation: token.document.elevation}, {x: landing.destination.x, y: landing.destination.y, elevation: landing.destination.elevation}]).distance;
    await flyTo({token, position: landing.position, destination: landing.destination, distance: distance3d, cost: landing.verdict.cost, sounds, playRunUp: false, playAnimation: itemUtils.getConfig(workflow.item, 'playAnimation')});
    let fall = await rollFallDice(height, workflow.actor);
    let lines = [genericUtils.format(L + 'Summary', {height, dc, aim: aimTotal})];
    lines.push(genericUtils.translate(undetected ? L + 'Undetected' : L + 'Aware'));
    if (dodge.accepted) lines.push(genericUtils.format(L + 'DodgeRoll', {total: dodge.total}));
    else if (!undetected && aimTotal >= dc && !dodge.offered) lines.push(genericUtils.translate(L + 'NoReaction'));
    if (outcome === 'hit') {
        let split = landingSplit(height, fall.total);
        if (split.target) await workflowUtils.applyDamage([target], split.target, 'bludgeoning');
        if (split.faller) await workflowUtils.applyDamage([token], split.faller, 'bludgeoning');
        let prone = knockedProne(actorUtils.getSize(workflow.actor, true), actorUtils.getSize(target.actor, true));
        if (prone) await effectUtils.applyConditions(target.actor, ['prone']);
        lines.push(genericUtils.format(L + 'Hit', {target: target.name, targetDamage: split.target, fallerDamage: split.faller}));
        lines.push(genericUtils.translate(prone ? L + 'TargetProne' : L + 'TooBig'));
    } else {
        let damage = landingMissDamage(height, fall.total);
        if (damage) await workflowUtils.applyDamage([token], damage, 'bludgeoning');
        await effectUtils.applyConditions(workflow.actor, ['prone']);
        lines.push(genericUtils.format(outcome === 'dodged' ? L + 'Dodged' : L + 'Missed', {target: target.name, damage}));
    }
    await stampCard(workflow, lines);
}
export let landingOnACreature = {
    name: 'Landing on a Creature',
    version: '1.5.46',
    rules: 'modern',
    midi: {item: [{pass: 'rollFinished', macro: use, priority: 50}]},
    config: [
        {value: 'playAnimation', label: 'CHRISPREMADES.Config.PlayAnimation', type: 'checkbox', default: true, category: 'animation'},
        {value: 'takeoffSound', label: 'CHRISPREMADES.Macros.Jump.Config.TakeoffSound', type: 'file', default: 'modules/animated-spell-effects-cartoon/sound-fx/swoosh/sfx_swoosh_fast_01.ogg', category: 'sound'},
        {value: 'landingSound', label: 'CHRISPREMADES.Macros.Jump.Config.LandingSound', type: 'file', default: 'modules/psfx-patreon/library/creature/movement/flight/landing/landing-impact-small-001.ogg', category: 'sound'}
    ]
};
