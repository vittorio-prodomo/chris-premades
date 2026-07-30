import {genericUtils, itemUtils} from '../utils.js';
import {determineSuperiorityDie} from '../macros/2014/classFeatures/fighter/battleMaster/superiorityDice.js';
import {
    applyAmbushDie,
    isEligibleForAmbushOffer,
    normaliseOfferTimeout,
    selectAmbushPrompter,
    superiorityDieFormula
} from '../lib/utilities/ambushInitiative.mjs';

/**
 * Ambush's initiative half — the offer, the die, and the reveal hold that makes the timing honest.
 * Rules reasoning, and why this cannot ride midi's `optional` channel, live in
 * `lib/utilities/ambushInitiative.mjs`.
 *
 * ⚠️ FORK-LOCAL. Upstream has no initiative automation of any kind; this is ours, so keep it in its
 * own file rather than threading it through the premade macro registry. Ambush is a macro-free
 * premade (its Stealth half is pure effect data) and stays that way — nothing here is a midi pass,
 * because no midi workflow exists for an initiative roll.
 *
 * ⚠️ NOT registered as a `d20` pass either, even though CPR's `events/d20.js` channel DOES fire on
 * initiative rolls (its `Roll.prototype.evaluate` wrapper is registered unconditionally at ready, and
 * DAE stamps the `actorUuid` its gate needs onto every actor roll data). It fires — but the roll it
 * hands back is thrown away by core's `Combat#rollInitiative`, so a bonus returned there would vanish.
 */

const POOL_IDENTIFIERS = ['superiorityDice', 'martialAdept', 'fightingStyleSuperiorTechnique'];

// `${combatId}:${combatantId}` — one offer per combatant per combat, reserved SYNCHRONOUSLY so a
// second initiative write (our own, or a reroll landing in the same tick) cannot double-prompt.
const offered = new Set();

function getAmbushItem(actor) {
    return itemUtils.getItemByIdentifier(actor, 'maneuversAmbush');
}

/** Uses left across every pool `determineSuperiorityDie` is willing to spend from. */
function superiorityDiceRemaining(actor) {
    return POOL_IDENTIFIERS.reduce((total, identifier) => {
        const item = itemUtils.getItemByIdentifier(actor, identifier);
        const value = item?.system?.uses?.value;
        return total + (Number.isFinite(value) ? value : 0);
    }, 0);
}

function isIncapacitated(actor) {
    // The same definition DAE's `disableIncapacitated` uses to suppress the Stealth half, so both
    // halves of one maneuver cannot disagree about whether it is available.
    if (globalThis.MidiQOL?.checkIncapacitated) return !!globalThis.MidiQOL.checkIncapacitated(actor, false, false);
    return !!actor?.statuses?.has?.('incapacitated');
}

function offerTimeoutSeconds() {
    return normaliseOfferTimeout(genericUtils.getCPRSetting('ambushInitiativeTimeout'));
}

const cctApi = () => game.modules.get('combat-tracker-dock')?.api;

/**
 * Ask the owner, with a countdown that declines for them.
 *
 * Always LOCAL: the responsible client is the one that got here, so no socket round-trip and no
 * remote dialog to close on timeout. Built on DialogV2 rather than CPR's `DialogApp` because that
 * has no countdown, and adding one would widen the upstream diff for a fork-local feature.
 */
async function promptAmbushOffer({name, initiative, die, seconds}) {
    const DialogV2 = foundry.applications.api.DialogV2;
    let countdownTimer = null;
    let closeTimer = null;
    const label = (key, data) => game.i18n.format(`CHRISPREMADES.Macros.Maneuvers.Ambush${key}`, data ?? {});
    const content = `
        <p>${label('Body', {name, initiative: String(initiative), die})}</p>
        <p class="cpr-ambush-timer">${label('Timer', {seconds: `<span class="cpr-ambush-countdown">${seconds}</span>`})}</p>`;
    const choice = await DialogV2.wait({
        window: {title: label('Title', {name})},
        content,
        buttons: [
            {action: 'spend', label: label('Spend', {die}), icon: 'fa-solid fa-dice-d20', default: true, callback: () => 'spend'},
            {action: 'decline', label: label('Decline'), icon: 'fa-solid fa-xmark', callback: () => 'decline'}
        ],
        render: (event, dialog) => {
            let remaining = seconds;
            const readout = dialog.element.querySelector('.cpr-ambush-countdown');
            countdownTimer = setInterval(() => {
                remaining -= 1;
                if (readout) readout.textContent = String(Math.max(0, remaining));
            }, 1000);
            closeTimer = setTimeout(() => dialog.close(), seconds * 1000);
        },
        rejectClose: false
    }).catch(() => null);
    clearInterval(countdownTimer);
    clearTimeout(closeTimer);
    // A closed dialog (timeout, Escape, the X) is a decline — never a spend.
    return choice === 'spend';
}

async function resolveOffer(combatant, actor, ambushItem) {
    const seconds = offerTimeoutSeconds();
    try {
        const initiative = combatant.initiative;
        const spend = await promptAmbushOffer({
            name: combatant.token?.name ?? actor.name,
            initiative,
            die: actor.system.scale?.['battle-master']?.['combat-superiority-die']?.die ?? 'd8',
            seconds
        });
        if (!spend) return;
        // Which pool pays is asked only now: `determineSuperiorityDie` may raise its own choice
        // dialog (Battle Master die vs a d6 from Martial Adept / Superior Technique), and asking
        // that before the yes/no would make declining cost two clicks.
        const [itemToUse, superiorityDie] = await determineSuperiorityDie(actor);
        if (!itemToUse) return;
        const formula = superiorityDieFormula(superiorityDie);
        if (!formula) return;
        const roll = await new Roll(formula, actor.getRollData()).evaluate();
        // ⚠️ Re-read the initiative rather than trusting the value captured before the dialog: the
        // GM can edit it inline (CCT) while the offer is open, and writing back a stale number
        // would silently revert their edit.
        const before = combatant.initiative;
        const updated = applyAmbushDie(before, roll.total);
        if (updated === null) return;
        await combatant.update({initiative: updated});
        await genericUtils.update(itemToUse, {'system.uses.spent': itemToUse.system.uses.spent + 1});
        await roll.toMessage({
            speaker: ChatMessage.implementation.getSpeaker({actor, token: combatant.token}),
            flavor: game.i18n.format('CHRISPREMADES.Macros.Maneuvers.AmbushFlavor', {
                name: ambushItem.name,
                from: String(before),
                to: String(updated)
            })
        });
    } finally {
        // Every exit releases: decline, timeout, no pool, a throw. The hold carries its own expiry
        // as a backstop, but leaning on that would blank the carousel for the full timer each time.
        cctApi()?.releaseInitiativeReveal(combatant.id);
    }
}

/**
 * ⚠️ Synchronous down to the `resolveOffer` call, on purpose. The reveal hold has to be taken in
 * the same tick as the initiative write — CCT's own settle timer starts here too, and an `await`
 * before the hold would race it and leak the turn order to the very player being asked.
 */
function onUpdateCombatant(combatant, changes) {
    if (changes?.initiative === null || changes?.initiative === undefined) return;
    const actor = combatant.actor;
    if (!actor) return;
    const ambushItem = getAmbushItem(actor);
    const key = `${combatant.parent?.id}:${combatant.id}`;
    if (!isEligibleForAmbushOffer({
        hasAmbush: !!ambushItem,
        isIncapacitated: isIncapacitated(actor),
        superiorityDiceRemaining: superiorityDiceRemaining(actor),
        initiative: combatant.initiative,
        alreadyOffered: offered.has(key)
    })) return;
    const prompter = selectAmbushPrompter(
        game.users.contents.map(user => ({
            id: user.id,
            isGM: user.isGM,
            active: user.active,
            isOwner: actor.testUserPermission(user, 'OWNER')
        })),
        {activeGMId: game.users.activeGM?.id}
    );
    if (prompter !== game.user.id) return;
    offered.add(key);
    cctApi()?.holdInitiativeReveal(combatant.id, {timeoutMs: (offerTimeoutSeconds() + 5) * 1000});
    resolveOffer(combatant, actor, ambushItem);
}

function onDeleteCombat(combat) {
    for (const key of [...offered]) if (key.startsWith(`${combat.id}:`)) offered.delete(key);
}

function ready() {
    Hooks.on('updateCombatant', onUpdateCombatant);
    Hooks.on('deleteCombat', onDeleteCombat);
}

export let ambushInitiative = {
    ready
};
