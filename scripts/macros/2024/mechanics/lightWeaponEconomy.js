import {combatUtils} from '../../../lib/utilities/combatUtils.js';
import {genericUtils, workflowUtils} from '../../../utils.js';
import {classifyOffhandAttack, shouldDefaultOffhand} from '../../../lib/utilities/lightWeaponEconomy.mjs';

/*
 * T163 — Nick mastery + the Light-property attack economy (fork-owned mechanic; upstream has
 * automation for 7 of the 8 masteries in masteries.js and nothing for Nick, and nothing anywhere
 * marked the bonus action for an offhand attack: midi keys its tracking on the ACTIVITY's
 * activation type, and a weapon attack activity is 'action' whichever Argon panel launched it).
 *
 * Three layers, decided by Vittorio 2026-08-24:
 *   1. an 'offhand' attack marks the bonus action used (MidiQOL.setBonusActionUsed);
 *   2. the attack mode DEFAULTS to offhand when a different Light weapon already attacked this
 *      turn (dnd5e.preRollAttackV2 — with midi fast-forward the default is the outcome, and
 *      dnd5e's native offhand damage rule rides on the chosen mode);
 *   3. a mastered nick weapon's extra folds into the Attack action — no bonus action spent, once
 *      per turn.
 *
 * Per-turn state lives in the `mastery.*` flag namespace, turn-keyed like masteries.js's own
 * perTurnCheck (stale turns are ignored by comparison; masteries.combatEnd wipes the namespace).
 */
function turnFlag(actor, key) {
    return actor.flags['chris-premades']?.mastery?.[key];
}
function isThisTurn(entry) {
    return combatUtils.inCombat() && entry?.turn === combatUtils.currentTurn();
}
async function setTurnFlag(actor, key, data = {}) {
    await genericUtils.setFlag(actor, 'chris-premades', 'mastery.' + key, {...data, turn: combatUtils.currentTurn()});
}
function actorMastersItem(actor, item) {
    if (actor.type === 'npc') return true; // NPC masteries are the statblock's to declare
    let baseItem = item.system.type?.baseItem;
    if (!baseItem) return false;
    return actor.system.traits?.weaponProf?.mastery?.value?.has(baseItem) ?? false;
}
async function RollComplete(workflow) {
    if (!combatUtils.inCombat()) return;
    if (!workflow.item || !workflow.actor || !workflow.attackRoll) return;
    if (!workflowUtils.isAttackType(workflow, 'weaponAttack')) return;
    let attackMode = workflow.attackRoll.options?.attackMode;
    let isLight = workflow.item.system.properties?.has?.('lgt') ?? false;
    let result = classifyOffhandAttack({
        attackMode,
        weaponMastery: workflow.item.system.mastery,
        actorMasters: actorMastersItem(workflow.actor, workflow.item),
        nickUsedThisTurn: isThisTurn(turnFlag(workflow.actor, 'nickExtra'))
    });
    if (result.kind === 'none') {
        // A main-hand Light attack is what arms the offhand default for the rest of the turn.
        if (isLight) await setTurnFlag(workflow.actor, 'lightMain', {itemId: workflow.item.id});
        return;
    }
    await setTurnFlag(workflow.actor, 'lightExtra');
    if (result.kind === 'nick-extra') {
        await setTurnFlag(workflow.actor, 'nickExtra');
        ui.notifications.info(genericUtils.translate('CHRISPREMADES.Macros.LightWeaponEconomy.NickFold'));
        return;
    }
    if (globalThis.MidiQOL?.hasUsedBonusAction?.(workflow.actor)) {
        ui.notifications.warn(genericUtils.translate('CHRISPREMADES.Macros.LightWeaponEconomy.OffhandNoBonus'));
        return;
    }
    await globalThis.MidiQOL?.setBonusActionUsed?.(workflow.actor);
    ui.notifications.info(genericUtils.translate('CHRISPREMADES.Macros.LightWeaponEconomy.OffhandMarked'));
}
// Layer 2. Registered at module scope (this file loads with the bundle via events/midi.js).
Hooks.on('dnd5e.preRollAttackV2', (rollConfig) => {
    let activity = rollConfig?.subject;
    let item = activity?.item;
    let actor = item?.actor;
    if (!item || !actor || item.type !== 'weapon') return;
    if (!combatUtils.inCombat()) return;
    let lightMain = turnFlag(actor, 'lightMain');
    let apply = shouldDefaultOffhand({
        isLightWeapon: item.system.properties?.has?.('lgt') ?? false,
        hasOffhandMode: (item.system.attackModes ?? []).some(m => m.value === 'offhand'),
        lightMainThisTurn: isThisTurn(lightMain),
        sameItem: lightMain?.itemId === item.id,
        extraUsedThisTurn: isThisTurn(turnFlag(actor, 'lightExtra'))
    });
    if (apply) rollConfig.attackMode = 'offhand';
});
export let lightWeaponEconomy = {
    RollComplete
};
