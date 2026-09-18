import {dialogUtils, genericUtils, rollUtils} from '../../../utils.js';
// ⚠️ FORK PATCH (queue T141): the offer's body was the generic "Use Heroic Inspiration?" over an
// unexplained die list. All three passes now use HeroicInspiration.SelectDiePrompt (en+it), which
// says what is spent, what to select, and that the new roll is kept even if lower (2024 RAW).
/**
 * The reroll's own chat card (Vittorio, 2026-09-18): it used to be a bare "Heroic Inspiration · 1d20 ·
 * 18" spoken by the USER, in whatever roll mode the client happened to be in. Spending Heroic
 * Inspiration is a table event, so the card is always public, speaks as the character, and says
 * who rerolled which die of what, and what it showed before.
 * ⚠️ Names are escaped — they are player-editable and `format` does not escape.
 */
function card(actor, token, what, faces, before) {
    let esc = foundry.utils.escapeHTML;
    return {
        mode: 'publicroll',
        speaker: ChatMessage.implementation.getSpeaker({actor, token: token?.document ?? token}),
        flavor: genericUtils.format('CHRISPREMADES.HeroicInspiration.Card', {
            name: esc(token?.name ?? actor.name),
            faces,
            what: esc(what),
            before
        })
    };
}
async function attack(workflow) {
    if (workflow.workflowOptions?.skipHeroicInspiration || !workflow.attackRoll || !workflow.actor.system.attributes.inspiration) return;
    let selection = await dialogUtils.selectDie([workflow.attackRoll], 'CHRISPREMADES.HeroicInspiration.Name', genericUtils.translate('CHRISPREMADES.HeroicInspiration.SelectDiePrompt'), {buttons: 'yesNo', width: 320, timeout: 30, contexts: [workflow.item?.name]});
    if (!selection) return;
    let positions = selection[0].split('-').map(i => Number(i));
    let term = workflow.attackRoll.terms[positions[1]];
    let what = genericUtils.format('CHRISPREMADES.HeroicInspiration.WhatAttack', {item: workflow.item?.name ?? ''});
    let roll = await rollUtils.rollDice('1d' + term.faces, {chatMessage: true, ...card(workflow.actor, workflow.token, what, term.faces, term.results[positions[2]].result)});
    let newRoll = rollUtils.updateDieResult(workflow.attackRoll, positions[1], positions[2], roll.roll.total);
    await workflow.setAttackRoll(newRoll);
    await genericUtils.update(workflow.actor, {'system.attributes.inspiration': false});
}
async function damage(workflow) {
    if (workflow.workflowOptions?.skipHeroicInspiration || !workflow.damageRolls || !workflow.actor.system.attributes.inspiration) return;
    let selection = await dialogUtils.selectDie(workflow.damageRolls, 'CHRISPREMADES.HeroicInspiration.Name', genericUtils.translate('CHRISPREMADES.HeroicInspiration.SelectDiePrompt'), {buttons: 'yesNo', width: 320, timeout: 30, contexts: workflow.damageRolls.map(() => workflow.item?.name)});
    if (!selection) return;
    let positions = selection[0].split('-').map(i => Number(i));
    let previousDieValue = workflow.damageRolls[positions[0]].terms[positions[1]].results[positions[2]].result;
    let faces = workflow.damageRolls[positions[0]].terms[positions[1]].faces;
    let what = genericUtils.format('CHRISPREMADES.HeroicInspiration.WhatDamage', {item: workflow.item?.name ?? ''});
    let roll = await rollUtils.rollDice('1d' + faces, {chatMessage: true, ...card(workflow.actor, workflow.token, what, faces, previousDieValue)});
    let newRoll = rollUtils.updateDieResult(workflow.damageRolls[positions[0]], positions[1], positions[2], roll.roll.total);
    workflow.damageRolls[[positions[0]]] = newRoll;
    await workflow.setDamageRolls(workflow.damageRolls);
    await genericUtils.update(workflow.actor, {'system.attributes.inspiration': false});
    await rollUtils.postRerollNote(workflow, {
        source: genericUtils.translate('CHRISPREMADES.HeroicInspiration.Name'),
        before: previousDieValue,
        after: roll.roll.total,
        forced: true
    });
}
async function saveSkillCheck(roll, actor, mode, context) {
    if (!actor.system.attributes.inspiration) return;
    let selection = await dialogUtils.selectDie([roll], 'CHRISPREMADES.HeroicInspiration.Name', genericUtils.translate('CHRISPREMADES.HeroicInspiration.SelectDiePrompt'), {buttons: 'yesNo', width: 320, timeout: 30, contexts: [context]});
    if (!selection) return;
    let positions = selection[0].split('-').map(i => Number(i));
    let term = roll.terms[positions[1]];
    let what = genericUtils.format('CHRISPREMADES.HeroicInspiration.WhatTest', {test: context ?? ''});
    let rolled = await rollUtils.rollDice('1d' + term.faces, {chatMessage: true, ...card(actor, actor.getActiveTokens()[0], what, term.faces, term.results[positions[2]].result)});
    let newRoll = rollUtils.updateDieResult(roll, positions[1], positions[2], rolled.roll.total);
    await genericUtils.update(actor, {'system.attributes.inspiration': false});
    return newRoll;
}
export let heroicInspiration = {
    attack,
    damage,
    saveSkillCheck
};