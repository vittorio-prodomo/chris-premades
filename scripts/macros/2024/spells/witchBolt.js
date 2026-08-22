import {activityUtils, actorUtils, dialogUtils, effectUtils, genericUtils, itemUtils, socketUtils, tokenUtils, workflowUtils} from '../../../utils.js';
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
                    // ⚠️ The effect's own `origin` is NOT this item — `effectUtils.createEffect` overwrites
                    // it with the concentration effect's uuid whenever `concentrationItem` is passed
                    // (`effectUtils.js:37`), and Witch Bolt always concentrates. Stash the real item uuid
                    // here so `offerSustain` can resolve the sustain activity without going through `origin`.
                    itemUuid: workflow.item.uuid,
                    targetUuid: target.document.uuid,
                    // ⚠️ Stashed at cast time, the way Warding Bond stores `bondUuid`. Re-deriving the
                    // caster's token with `actor.getActiveTokens()[0]` measures from an arbitrary token
                    // whenever a linked actor has several on the scene, which silently ends the spell
                    // (or fails to) against the wrong position.
                    casterTokenUuid: workflow.token?.document.uuid,
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
    await bindTargetEffect(workflow, target);
}

/**
 * Make sure the target carries `Sustained Lightning`, and that it dies with the caster's concentration.
 *
 * ⚠️ Two separate gaps, both invisible on the happy path.
 *
 * 1. midi applies an attack activity's effects to `hitTargets` ONLY, but Witch Bolt's sustain works
 *    "even if the first attack missed". After a miss the spell was half-wired: the caster effect, the
 *    concentration link, the VAE button and the per-turn offer all existed, but the target had no
 *    effect at all — so none of the target-side watchers were live, and a target that walked out of
 *    range or gained Total Cover was only noticed when the CASTER moved or at her next turn start.
 *    It also showed no visible link at the table, which reads as "the spell didn't work".
 *
 * 2. Nothing in this stack makes an activity-applied effect a dependent of the caster's concentration.
 *    DAE's `doActivityEffects` sets `origin` only, and midi's `dependentOn` wiring sits in the
 *    Convenient-Effects branch, which is OFF in this world. dnd5e's `getDependents()` is
 *    `dependentOn`-driven (the legacy `dependents` flag plus `dnd5e.registry.dependents`, which is
 *    populated from `flags.dnd5e.dependentOn` at prepareData), so without an explicit link a
 *    concentration-SIDE end — a failed concentration save, the caster dropping to 0 HP, another
 *    concentration spell, a long rest, a manual end — orphans the target's effect. Same conclusion and
 *    same fix as GPS's `entangle2024.js`.
 */
async function bindTargetEffect(workflow, target) {
    if (!target?.actor) return;
    let applied = effectUtils.getEffectByIdentifier(target.actor, 'witchBoltTarget');
    if (applied) {
        // The hit path: midi/DAE already applied it, so only the concentration link is missing.
        await MidiQOL.addConcentrationDependent(workflow.actor, applied, workflow.item);
        return;
    }
    // The miss path. Build from the item's OWN effect so the packData flags come along untouched —
    // `rules: 'modern'` and `macros.movement`/`macros.effect` = ['witchBoltTarget'] are what make the
    // target-side watchers live, and `getRules` defaults to 'legacy' for an effect that omits them.
    let attack = activityUtils.getActivityByIdentifier(workflow.item, 'witchBolt');
    let template = attack?.applicableEffects?.[0] ?? workflow.item.effects.get('witchBoltEff0000');
    if (!template) return;
    let targetEffectData = template.toObject();
    delete targetEffectData._id;
    delete targetEffectData._stats;
    // `concentrationItem` gives the same shape the hit path produces — `origin` stamped with the
    // concentration effect — and registers the dependency in the same call. NOT strictlyInterdependent:
    // that would repoint the concentration's own `dependentOn` away from the caster effect.
    await effectUtils.createEffect(target.actor, targetEffectData, {concentrationItem: workflow.item});
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

/**
 * The token the spell was cast FROM.
 *
 * ⚠️ `actor.getActiveTokens()[0]` is only a last resort. A linked actor can have several tokens on the
 * scene, and "the first one" is whichever the collection happens to yield — so every range measurement
 * would silently be taken from the wrong body. Prefer the token the dispatcher handed us, then the uuid
 * stashed at cast time.
 */
async function resolveCasterToken(sourceEffect, data, preferredToken) {
    if (preferredToken) return preferredToken;
    let stashed = data?.casterTokenUuid ? await fromUuid(data.casterTokenUuid) : undefined;
    return stashed?.object ?? sourceEffect.parent?.getActiveTokens?.()[0];
}

async function resolveState(sourceEffect, preferredToken) {
    let data = sourceEffect?.flags['chris-premades']?.witchBolt;
    if (!data) return;
    let casterToken = await resolveCasterToken(sourceEffect, data, preferredToken);
    let targetDoc = await fromUuid(data.targetUuid);
    let targetToken = targetDoc?.object;
    return {data, casterToken, targetToken};
}

async function endIfConditionMet(sourceEffect, preferredToken) {
    let state = await resolveState(sourceEffect, preferredToken);
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
    let casterToken = trigger.token;
    // End conditions win over the offer — re-check before asking.
    await endIfConditionMet(sourceEffect, casterToken);
    if (!actor.effects.get(sourceEffect.id)) return;

    let bonusActionUsed = actorUtils.hasUsedBonusAction(actor);
    if (!shouldOfferSustain({effectPresent: true, bonusActionUsed, endReason: null})) return;

    // ⚠️ Do NOT resolve the item from `sourceEffect.origin` — `createEffect` overwrote that with the
    // concentration effect's uuid (see the comment in `use`), so `fromUuid` would return an ActiveEffect
    // and `getActivityByIdentifier`'s unguarded `item.system.activities.find(...)` would throw. Use the
    // item uuid stashed on the effect's own flags at cast time instead.
    let item = await fromUuid(sourceEffect.flags['chris-premades']?.witchBolt?.itemUuid);
    let sustain = item ? activityUtils.getActivityByIdentifier(item, 'witchBoltSustain', {strict: true}) : undefined;
    if (!sustain) return;

    casterToken ??= await resolveCasterToken(sourceEffect, sourceEffect.flags['chris-premades']?.witchBolt);
    if (!casterToken) return;
    // `firstOwner` already falls back to the active GM internally, so there is nothing left to coalesce.
    let userId = socketUtils.firstOwner(actor, true);
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
 *
 * ⚠️ GPS is NOT a declared dependency of this module, and `game.gps?.socket?.executeAsUser(...)`
 * resolves to `undefined` when it is absent or has not reached its own `ready` yet — which this
 * function would then read as a decline, indistinguishable from the player saying no. So the GPS
 * branch is optional: without it we fall back to CPR's own `dialogUtils.confirm`, which already
 * routes to a remote user, and we say so out loud. `ambushInitiative.js` takes the same shape (resolve
 * the GPS helper at CALL time, fall back locally), and Warding Bond uses this very dialog.
 * The only thing lost on the fallback is the countdown chrome — the offer itself still appears,
 * and a missing offer is now diagnosable rather than silent.
 */
async function askSustain({title, casterToken, userId, seconds}) {
    let gpsSocket = game.gps?.socket;
    if (!gpsSocket?.executeAsUser) {
        genericUtils.log('dev', 'Witch Bolt: gambits-premades is unavailable, falling back to the plain confirm dialog (no countdown).');
        console.warn('chris-premades | Witch Bolt: gambits-premades socket unavailable — the sustain offer is being raised without the countdown chrome.');
        let selection = await dialogUtils.confirm(title, 'CHRISPREMADES.Macros.WitchBolt.Sustain', {userId});
        return !!selection;
    }
    let content = `<p>${game.i18n.localize('CHRISPREMADES.Macros.WitchBolt.Sustain')}</p>`;
    let result = await gpsSocket.executeAsUser('process3rdPartyReactionDialog', userId, {
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
    version: '1.1.0',
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
