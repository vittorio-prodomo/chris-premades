import {activityUtils, effectUtils, genericUtils, itemUtils, socketUtils, tokenUtils, workflowUtils} from '../../../utils.js';
import {evaluateEndCondition, shouldOfferSustain} from '../../../lib/utilities/witchBoltRules.mjs';

async function use({workflow}) {
    let target = workflow.targets.first();
    if (!target) return;
    let sustain = activityUtils.getActivityByIdentifier(workflow.item, 'witchBoltSustain', {strict: true});
    if (!sustain) return;
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: itemUtils.convertDuration(workflow.item),
        flags: {
            'chris-premades': {
                witchBolt: {
                    targetUuid: target.document.uuid,
                    castLevel: workflowUtils.getCastLevel(workflow),
                    maxDistance: itemUtils.getConfig(workflow.item, 'maxDistance') ?? 60
                }
            }
        }
    };
    await effectUtils.createEffect(workflow.actor, effectData, {
        concentrationItem: workflow.item,
        strictlyInterdependent: true,
        identifier: 'witchBolt',
        // ⚠️ getRules defaults to 'legacy' for effects — a 2024 macro must say so explicitly.
        rules: 'modern',
        macros: [
            {type: 'movement', macros: ['witchBoltSource']},
            {type: 'combat', macros: ['witchBoltSource']}
        ],
        vae: [{
            type: 'use',
            name: sustain.name,
            identifier: 'witchBolt',
            activityIdentifier: 'witchBoltSustain'
        }],
        unhideActivities: {
            itemUuid: workflow.item.uuid,
            activityIdentifiers: ['witchBoltSustain'],
            favorite: true
        }
    });
}

async function early({actor, dialog}) {
    dialog.configure = false;
    let effect = effectUtils.getEffectByIdentifier(actor, 'witchBolt');
    // ⚠️ CPR's preTargeting dispatcher cancels on a TRUTHY return (events/midi.js:233: 'if (result) return false;').
    // Returning false here would notify and then let the use proceed anyway. Same polarity as callLightning.js:43.
    if (!effect) {
        genericUtils.notify('CHRISPREMADES.Macros.WitchBolt.NotActive', 'info');
        return true;
    }
    let targetUuid = effect.flags['chris-premades']?.witchBolt?.targetUuid;
    let targetToken = targetUuid ? (await fromUuid(targetUuid))?.object : undefined;
    if (!targetToken) {
        genericUtils.notify('CHRISPREMADES.Macros.WitchBolt.NoTarget', 'info');
        return true;
    }
    await genericUtils.updateTargets([targetToken]);
}

/**
 * The caster effect is the spell's anchor: it is strictly interdependent with concentration, so
 * removing it ends the spell and takes the target's Sustained Lightning with it.
 */
function getSourceEffect(actor) {
    return effectUtils.getEffectByIdentifier(actor, 'witchBolt');
}

async function resolveState(sourceEffect) {
    let data = sourceEffect?.flags['chris-premades']?.witchBolt;
    if (!data) return;
    let casterToken = sourceEffect.parent?.getActiveTokens?.()[0];
    let targetDoc = await fromUuid(data.targetUuid);
    let targetToken = targetDoc?.object;
    return {data, casterToken, targetToken};
}

async function endIfConditionMet(sourceEffect) {
    let state = await resolveState(sourceEffect);
    if (!state) return;
    let {data, casterToken, targetToken} = state;
    let distance = (casterToken && targetToken) ? tokenUtils.getDistance(casterToken, targetToken) : -1;
    let reason = evaluateEndCondition({
        distance,
        maxRange: data.maxDistance,
        targetStatuses: targetToken?.actor?.statuses ?? [],
        targetPresent: !!targetToken
    });
    if (!reason) return;
    await genericUtils.remove(sourceEffect);
}

/** Either token moved: re-measure. Fired from the caster effect. */
async function movedSource({trigger}) {
    await endIfConditionMet(trigger.entity);
}

/**
 * Resolve the caster's spell-state effect starting from the TARGET's Sustained Lightning.
 *
 * ⚠️ Do NOT reach for `flags['chris-premades'].concentrationEffectUuid` here. That flag is written by
 * `effectUtils.createEffect`, so it exists only on the CASTER's effect; the target's effect is applied
 * by dnd5e/midi and never passes through `createEffect`, so the lookup would always bail and this
 * watcher would be silently dead. Midi stamps an applied effect's `origin` with the caster's
 * CONCENTRATION effect (`Actor.<id>.ActiveEffect.<concId>`) — not the item — so resolve that and walk
 * to its parent actor. `flags.dnd5e.dependentOn` is the fallback.
 */
async function resolveCasterEffect(effect) {
    let originUuid = effect?.origin ?? effect?.flags?.dnd5e?.dependentOn;
    let origin = originUuid ? await fromUuid(originUuid) : undefined;
    if (!origin) return;
    let actor = origin.parent instanceof Actor ? origin.parent : origin.actor;
    if (!actor) return;
    return getSourceEffect(actor);
}

/** Either token moved: re-measure. Fired from the target's Sustained Lightning. */
async function movedTarget({trigger}) {
    await endIfConditionMet(await resolveCasterEffect(trigger.entity));
}

/**
 * A new effect landed on the target. dnd5e's own coverTotal and dead statuses are the two we care
 * about — the GM toggles cover by hand, which is exactly the contract we want.
 */
async function conditionApplied({trigger}) {
    await movedTarget({trigger});
}

async function offerSustain({trigger}) {
    let sourceEffect = trigger.entity;
    let actor = sourceEffect.parent;
    // End conditions win over the offer — re-check before asking.
    await endIfConditionMet(sourceEffect);
    if (!actor.effects.get(sourceEffect.id)) return;

    let bonusActionUsed = !!actor.effects.find(i => i.id === 'dnd5ebonusaction');
    if (!shouldOfferSustain({effectPresent: true, bonusActionUsed, endReason: null})) return;

    let item = await fromUuid(sourceEffect.origin);
    let sustain = item ? activityUtils.getActivityByIdentifier(item, 'witchBoltSustain', {strict: true}) : undefined;
    if (!sustain) return;

    let casterToken = actor.getActiveTokens()[0];
    if (!casterToken) return;
    let userId = socketUtils.firstOwner(actor, true) ?? socketUtils.gmID();
    let selection = await askSustain({title: item.name, casterToken, userId, seconds: SUSTAIN_TIMEOUT});
    // ⚠️ The chrome expires a dialog by closing it, and a closed dialog is a DECLINED one. RAW,
    // declining does NOT end the spell — it just skips this turn's bonus action.
    if (!selection) return;
    await workflowUtils.completeActivityUse(sustain);
}

const SUSTAIN_TIMEOUT = 30;

/**
 * Ask the caster's owner whether to sustain, wearing the GPS countdown.
 *
 * ⚠️ Why not `dialogUtils.confirm({userId})`: `attachCountdownChrome` mutates a dialog INSTANCE
 * (it prepends a progress bar into `dialog.element` and installs timers on the object), so only the
 * client that BUILDS the dialog can dress it. CPR's socket dialog constructs a `DialogApp` on the
 * recipient's client and returns just the answer — no handle ever reaches us, so there is nothing
 * to dress. GPS avoids this by shipping the whole dialog FUNCTION across the socket instead:
 * `process3rdPartyReactionDialog` is registered as a socketlib op (`gambits-premades/scripts/module.js:70`),
 * so it runs on the recipient's client and attaches the chrome there. Same reason a player already
 * sees a countdown on GPS reaction offers.
 *
 * ⚠️ The name is misleading — it is a general timed Yes/No. It builds its own localized buttons, takes
 * `dialogContent` as arbitrary HTML, and every reaction-specific hook inside (item select, weapon
 * image, enemy-token checkboxes, damage list) is a null-guarded lookup that simply does not wire when
 * the content has no such elements.
 *
 * ⚠️ Pass `type: 'singleDialog'`. `'multiDialog'` makes it coordinate closing a paired GM dialog we
 * are not opening, via `closeDialogById` round-trips.
 *
 * ⚠️ Returns `{userDecision, programmaticallyClosed, ...}`. A timeout, an X, or No all give a falsy
 * `userDecision` — which is exactly the decline semantics we want, since RAW declining does not end
 * the spell.
 */
async function askSustain({title, casterToken, userId, seconds}) {
    let content = `<p>${game.i18n.localize('CHRISPREMADES.Macros.WitchBolt.Sustain')}</p>`;
    let result = await game.gps?.socket?.executeAsUser('process3rdPartyReactionDialog', userId, {
        dialogTitle: title,
        dialogContent: content,
        dialogId: `witch-bolt-${casterToken.id}`,
        initialTimeLeft: seconds,
        validTokenPrimaryUuid: casterToken.document.uuid,
        source: 'user',
        type: 'singleDialog'
    });
    return !!result?.userDecision;
}

export let witchBolt = {
    name: 'Witch Bolt',
    version: '1.0.0',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['witchBolt']
            },
            {
                pass: 'preTargeting',
                macro: early,
                priority: 50,
                activities: ['witchBoltSustain']
            }
        ]
    },
    config: [
        {
            value: 'maxDistance',
            label: 'CHRISPREMADES.Macros.WitchBolt.MaxDistance',
            type: 'text',
            default: 60,
            category: 'homebrew',
            homebrew: true
        }
    ]
};

export let witchBoltSource = {
    name: 'Witch Bolt (Caster)',
    version: witchBolt.version,
    rules: witchBolt.rules,
    movement: [
        {
            pass: 'moved',
            macro: movedSource,
            priority: 50
        }
    ],
    combat: [
        {
            pass: 'turnStart',
            macro: offerSustain,
            priority: 50
        }
    ]
};

export let witchBoltTarget = {
    name: 'Witch Bolt (Target)',
    version: witchBolt.version,
    rules: witchBolt.rules,
    movement: [
        {
            pass: 'moved',
            macro: movedTarget,
            priority: 50
        }
    ],
    effect: [
        {
            pass: 'actorCreated',
            macro: conditionApplied,
            priority: 50
        }
    ]
};
