import {Summons} from '../../../lib/summons.js';
import {activityUtils, animationUtils, compendiumUtils, constants, crosshairUtils, dialogUtils, effectUtils, genericUtils, itemUtils, tokenUtils, workflowUtils} from '../../../utils.js';

// T152: consumption is DEFERRED for Flaming Sphere casts (magicMissile.js / faerieFire.js pattern):
// the slot used to be spent before rollFinished, so cancelling the summon's crosshair placement
// (Esc / right-click) burned it with nothing to show. Deferring the spend to use() means a
// cancelled placement just removes the cast card and concentration — nothing was ever consumed.
const pendingCasts = new Map();

function isFlamingSphere(item) {
    return item?.flags?.['chris-premades']?.info?.identifier === 'flamingSphere';
}

// Runs inside Activity#consume AFTER the usage dialog, so the chosen upcast level is already
// fixed on the usage card. Scoped to the item's MAIN cast activity — the Move activity must not
// create pending entries. The macro's own deferred consume() call passes back through here via
// the marker.
Hooks.on('dnd5e.preActivityConsumption', (activity, usageConfig) => {
    if (usageConfig?.chrisPremades?.flamingSphereDeferred) return;
    if (!isFlamingSphere(activity.item)) return;
    if (activityUtils.getIdentifier(activity) !== 'flamingSphere') return;
    pendingCasts.set(activity.item.uuid, {ts: Date.now()});
    usageConfig.consume = false;
});
// Re-cast prompt (T19): with a sphere already up the spell has two visible activities (Cast + Move),
// so clicking Cast would drop the current sphere silently. Gate on dnd5e.preUseActivity (fires before
// the card / consumption / concentration — see potionOfHealing.js / primalCompanion.js) and offer a
// contextual choice instead: Move (bonus action, the safe default) / Re-cast (drops the current sphere)
// / Cancel. No sphere up → normal cast proceeds untouched.
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    if (activityUtils.getIdentifier(activity) !== 'flamingSphere') return;
    if (usageConfig?.chrisPremades?.flamingSphereRecastConfirmed) return;
    let actor = activity.item?.actor;
    if (!actor) return;
    let effect = effectUtils.getEffectByIdentifier(actor, 'flamingSphere');
    if (!effect) return; // no active sphere: cast normally
    (async () => {
        let choice = await dialogUtils.buttonDialog(activity.item.name, 'CHRISPREMADES.Macros.FlamingSphere.RecastPrompt', [
            ['CHRISPREMADES.Macros.FlamingSphere.RecastMove', 'move'],
            ['CHRISPREMADES.Macros.FlamingSphere.RecastRecast', 'recast'],
            ['CHRISPREMADES.Macros.FlamingSphere.RecastCancel', 'cancel']
        ]);
        if (!choice || choice === 'cancel') return; // clean abort, nothing spent
        if (choice === 'move') {
            let moveActivity = activityUtils.getActivityByIdentifier(activity.item, 'flamingSphereMove', {strict: true});
            if (moveActivity) await moveActivity.use({}, {}, {});
            return;
        }
        // Re-cast: drop the current sphere (token + summon effect + concentration), then re-cast.
        await Summons.dismiss({trigger: {entity: effect}});
        await genericUtils.remove(effect);
        let concentration = effectUtils.getConcentrationEffect(actor, activity.item);
        if (concentration) await genericUtils.remove(concentration);
        await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {flamingSphereRecastConfirmed: true}}, {inplace: false}), {configure: false}, {});
    })();
    return false;
});
async function use({trigger, workflow}) {
    let pending = pendingCasts.get(workflow.item.uuid);
    pendingCasts.delete(workflow.item.uuid);
    if (pending && Date.now() - pending.ts > 60000) pending = undefined;
    let message = workflow.itemCardUuid ? await fromUuid(workflow.itemCardUuid) : undefined;
    let concentration = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    let removeConcentration = async () => {if (concentration) await genericUtils.remove(concentration);};
    // Any pre-spawn bail is a cancelled cast: with the spend deferred nothing was consumed, so
    // dropping the card + concentration leaves zero footprint (a toast still says what happened).
    let cancelCast = async () => {
        await removeConcentration();
        if (!pending) return;
        if (message) await message.delete().catch(() => {});
        genericUtils.notify(genericUtils.format('CHRISPREMADES.Macros.FlamingSphere.Cancelled', {name: workflow.item.name}), 'info', {localize: false});
    };
    if (pending) {
        // With the spend deferred, dnd5e no longer aborts the use on an empty slot — run its own
        // affordability check before doing any summon work.
        let dryRun = await workflow.activity._prepareUsageUpdates({consume: true, scaling: message?.system?.scaling ?? 0}, {returnErrors: true});
        if (foundry.utils.getType(dryRun) !== 'Object') {
            dryRun?.forEach?.(err => ui.notifications.warn(err.message));
            await cancelCast();
            return;
        }
    }
    let avatarImg = itemUtils.getConfig(workflow.item, 'avatar');
    let tokenImg = itemUtils.getConfig(workflow.item, 'token');
    let color = itemUtils.getConfig(workflow.item, 'color');
    let name = itemUtils.getConfig(workflow.item, 'name');
    let scale = Number(itemUtils.getConfig(workflow.item, 'scale'));
    if (isNaN(scale)) scale = 1;
    if (!name || name === '') name = workflow.item.name;
    let hasFallbackImg = animationUtils.sequencerCheck() && animationUtils.jb2aCheck() !== false;
    if (!tokenImg || tokenImg === '') tokenImg = hasFallbackImg ? Sequencer.Database.getEntry('jb2a.flaming_sphere.400px.' + color + '.02').file : '';
    let damageUpdates = {
        flags: {
            'chris-premades': {
                flamingSphere: {
                    actorUuid: workflow.actor.uuid
                }
            }
        }
    };
    let damageFeature = await Summons.getSummonItem('Flaming Sphere: End Turn', damageUpdates, workflow.item, {flatDC: itemUtils.getSaveDC(workflow.item), damageFlat: workflowUtils.getCastLevel(workflow) + 'd6[fire]', translate: 'CHRISPREMADES.Macros.FlamingSphere.EndTurn'});
    if (!damageFeature) return await cancelCast();
    let ramFeature = await Summons.getSummonItem('Flaming Sphere: Ram', damageUpdates, workflow.item,{flatDC: itemUtils.getSaveDC(workflow.item), damageFlat: workflowUtils.getCastLevel(workflow) + 'd6[fire]', translate: 'CHRISPREMADES.Macros.FlamingSphere.RamItem'});
    if (!ramFeature) return await cancelCast();
    // Explicit-ram model (T19 revision): the sphere's Ram is a normal Argon action that uses the usual
    // targeting flow (the world's clear-and-pick target mode). Give the Ram activity a 5-ft range so
    // midi's own range machinery flags/blocks an out-of-range pick live in the target step; the bound
    // preItemRoll macro re-checks the same 5 ft (deterministic backstop, same distance fn as midi) and
    // spends the CASTER's bonus action — the actorUuid to find the caster is already on the item.
    genericUtils.setProperty(ramFeature, 'flags.chris-premades.macros.midi.item', ['flamingSphereRam']);
    for (let ramActivity of Object.values(ramFeature.system?.activities ?? {})) {
        ramActivity.range = {override: true, units: 'ft', value: 5};
    }
    let updates = {
        actor: {
            name,
            prototypeToken: {
                name,
                texture: {
                    src: tokenImg,
                    scaleX: scale,
                    scaleY: scale
                }
            },
            items: [
                damageFeature,
                ramFeature
            ]
        },
        token: {
            name,
            texture: {
                src: tokenImg,
                scaleX: scale,
                scaleY: scale
            }
        }
    };
    if (avatarImg) genericUtils.setProperty(updates, 'actor.img', avatarImg);
    let animation = itemUtils.getConfig(workflow.item, 'animation');
    let actor = await compendiumUtils.getActorFromCompendium(constants.packs.summons, 'CPR - Flaming Sphere');
    if (!actor) return await cancelCast();
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'flamingSphereMove', {strict: true});
    if (!feature) return await cancelCast();
    let token = await Summons.spawn(actor, updates, workflow.item, workflow.token, {
        duration: itemUtils.convertDuration(workflow.item).seconds, 
        range: 60, 
        animation, 
        initiativeType: 'none', 
        additionalVaeButtons: [{
            type: 'use', 
            name: feature.name, 
            identifier: 'flamingSphere',
            activityIdentifier: 'flamingSphereMove'
        }],
        unhideActivities: {
            itemUuid: workflow.item.uuid,
            activityIdentifiers: ['flamingSphereMove'],
            favorite: true
        }
    });
    if (!token) return await cancelCast();
    token = token[0];
    if (pending) {
        // Placement confirmed: perform the deferred consumption now. Mirrors the chat card's own
        // "Consume Resource" handler so the card's Refund button keeps working.
        let messageConfig = {};
        let usageConfig = {consume: true, scaling: message?.system?.scaling ?? 0, workflow, chrisPremades: {flamingSphereDeferred: true}};
        let cause = message?.system?.cause;
        let linkedActivity = cause ? workflow.activity.getLinkedActivity?.(cause) : undefined;
        if (linkedActivity) usageConfig.cause = {activity: linkedActivity.relativeUUID, resources: linkedActivity.consumption.targets.length > 0};
        await workflow.activity.consume(usageConfig, messageConfig);
        if (message && !foundry.utils.isEmpty(messageConfig.data)) await message.update(messageConfig.data);
    }
    let effect = effectUtils.getEffectByIdentifier(workflow.actor, 'flamingSphere');
    if (!effect) return await removeConcentration();
    await genericUtils.update(effect, {
        'flags.chris-premades.flamingSphere.tokenUuid': token.uuid
    });
}
async function move({workflow}) {
    let effect = effectUtils.getEffectByIdentifier(workflow.actor, 'flamingSphere');
    if (!effect) return;
    let tokenUuid = effect.flags['chris-premades']?.flamingSphere?.tokenUuid;
    if (!tokenUuid) return;
    let token = await fromUuid(tokenUuid);
    if (!token) return;
    await workflow.actor.sheet.minimize();
    let position = await crosshairUtils.aimCrosshair({
        token: token.object, 
        maxRange: 30, 
        centerpoint: token.object.center, 
        drawBoundries: true, 
        trackDistance: true, 
        fudgeDistance: token.width * canvas.dimensions.distance / 2,
        crosshairsConfig: {
            size: canvas.grid.distance * token.width / 2,
            icon: token.texture.src,
            resolution: (token.width % 2) ? 1 : -1
        }
    });
    await workflow.actor.sheet.maximize();
    if (position.cancelled) {
        // Cancel = free: moving never costs a bonus action (only the explicit Ram does), and the Move
        // activity posts a bare utility card — clear it so a cancelled move leaves nothing behind.
        let card = game.messages.get(workflow.itemCardId);
        if (card) await genericUtils.remove(card);
        return;
    }
    let xOffset = token.width * canvas.grid.size / 2;
    let yOffset = token.height * canvas.grid.size / 2;
    // Just reposition the sphere — moving no longer rams or costs a bonus action (T19 revision: the
    // ram is now an explicit Argon action). A manual GM drag does the same thing: a plain move.
    await genericUtils.update(token, {x: (position.x ?? token.center.x) - xOffset, y: (position.y ?? token.center.y) - yOffset});
    await token.object.movementAnimationPromise;
}
// Explicit Ram (preItemRoll — runs AFTER the normal target pick): enforce the 5-ft range on the chosen
// target and spend the caster's bonus action. Because it runs post-targeting, it composes with the
// world's usual clear-and-pick target flow (no pre-selection needed) instead of fighting it.
async function ram({workflow}) {
    let sphereToken = workflow.token;
    let targets = [...(workflow.targets ?? [])];
    let outOfRange = !sphereToken || !targets.length || targets.some(t => tokenUtils.getDistance(sphereToken, t) > 5);
    if (outOfRange) {
        let card = workflow.itemCardId ? game.messages.get(workflow.itemCardId) : null;
        if (card) await genericUtils.remove(card);
        genericUtils.notify('CHRISPREMADES.Macros.FlamingSphere.RamOutOfRange', 'warn');
        return false;
    }
    let actorUuid = workflow.item?.flags['chris-premades']?.flamingSphere?.actorUuid;
    let caster = actorUuid ? await fromUuid(actorUuid) : null;
    if (caster?.inCombat) {
        if (MidiQOL.hasUsedBonusAction(caster)) genericUtils.notify('CHRISPREMADES.Macros.FlamingSphere.BonusActionUsed', 'warn');
        else await MidiQOL.setBonusActionUsed(caster);
    }
}
async function endTurn({trigger}) {
    let actorUuid = trigger.entity.flags['chris-premades']?.flamingSphere?.actorUuid;
    if (!actorUuid) return;
    let actor = await fromUuid(actorUuid);
    if (!actor) return;
    let featureData = genericUtils.duplicate(trigger.entity.toObject());
    await workflowUtils.syntheticItemDataRoll(featureData, trigger.entity.actor, [trigger.target]);
}
async function early({dialog, config}) {
    dialog.configure = false;
    // Moving the sphere costs no bonus action (T19 revision: only the explicit Ram does) — suppress
    // midi's bonus-action marking for the bonus-typed Move activity so a move stays economy-free.
    genericUtils.setProperty(config, 'midiOptions.workflowOptions.notBonusAction', true);
}
export let flamingSphere = {
    name: 'Flaming Sphere',
    version: '1.2.28',
    hasAnimation: true,
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['flamingSphere']
            },
            {
                pass: 'rollFinished',
                macro: move,
                priority: 50,
                activities: ['flamingSphereMove']
            },
            {
                pass: 'preTargeting',
                macro: early,
                priority: 50,
                activities: ['flamingSphereMove']
            }
        ]
    },
    config: [
        {
            value: 'animation',
            label: 'CHRISPREMADES.Config.Animation',
            type: 'select',
            default: 'fire',
            category: 'animation',
            options: constants.summonAnimationOptions
        },
        {
            value: 'token',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.FlamingSphere',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'avatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.FlamingSphere',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'name',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.FlamingSphere',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'color',
            label: 'CHRISPREMADES.Config.Color',
            type: 'select',
            default: 'orange',
            category: 'animation',
            options: [
                {
                    value: 'orange',
                    label: 'CHRISPREMADES.Config.Colors.Orange'
                },
                {
                    value: 'purple',
                    label: 'CHRISPREMADES.Config.Colors.Purple',
                    requiredModules: ['jb2a_patreon']
                }
            ]
        },
        {
            value: 'scale',
            label: 'CHRISPREMADES.Config.Scale',
            type: 'text',
            default: 2,
            category: 'summons'
        }
    ]
};
export let flamingSphereEndTurn = {
    name: 'Flaming Sphere: End Turn',
    version: '1.0.25',
    combat: [
        {
            pass: 'turnEndNear',
            macro: endTurn,
            priority: 50,
            distance: 5
        }
    ]
};
export let flamingSphereRam = {
    name: 'Flaming Sphere: Ram',
    version: '1.0.25',
    midi: {
        item: [
            {
                pass: 'preItemRoll',
                macro: ram,
                priority: 50
            }
        ]
    }
};

// The T19 re-cast gate above owns the same-spell recast moment; tell
// dnd5e-lowest-slot-cast so its generic concentration warning stands down here
// by contract instead of by hook-ordering luck.
Hooks.once('ready', () => {
    game.modules.get('dnd5e-lowest-slot-cast')?.api?.claimSameSpellRecast('flaming-sphere');
});

