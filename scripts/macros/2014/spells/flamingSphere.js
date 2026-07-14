import {Summons} from '../../../lib/summons.js';
import {activityUtils, animationUtils, compendiumUtils, constants, crosshairUtils, dialogUtils, effectUtils, genericUtils, itemUtils, tokenUtils, workflowUtils} from '../../../utils.js';
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
    let concentration = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    let removeConcentration = async () => {if (concentration) await genericUtils.remove(concentration);};
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
    if (!damageFeature) return await removeConcentration();
    let ramFeature = await Summons.getSummonItem('Flaming Sphere: Ram', damageUpdates, workflow.item,{flatDC: itemUtils.getSaveDC(workflow.item), damageFlat: workflowUtils.getCastLevel(workflow) + 'd6[fire]', translate: 'CHRISPREMADES.Macros.FlamingSphere.RamItem'});
    if (!ramFeature) return await removeConcentration();
    // Bind the moved-pass ram macro to the sphere's Ram item so every move path (manual GM drag,
    // crosshair, bridge move) triggers a single space-entry ram + the caster's bonus-action economy.
    genericUtils.setProperty(ramFeature, 'flags.chris-premades.macros.movement', ['flamingSphereMoved']);
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
    if (!actor) return await removeConcentration();
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'flamingSphereMove', {strict: true});
    if (!feature) return await removeConcentration();
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
    if (!token) return await removeConcentration();
    token = token[0];
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
        // Cancel = free (T19): the bonus action is deferred to the moved pass (which only fires on an
        // actual move) and the Move activity posts a bare utility card — clear it so nothing lingers.
        let card = game.messages.get(workflow.itemCardId);
        if (card) await genericUtils.remove(card);
        return;
    }
    let xOffset = token.width * canvas.grid.size / 2;
    let yOffset = token.height * canvas.grid.size / 2;
    // The reposition fires the v13 moveToken hook → CPR's moved pass → flamingSphereMoved, which
    // handles the ram (space-entry) and the caster's bonus action. Same path as a manual drag, so
    // there is exactly one ram trigger (no double-offer).
    await genericUtils.update(token, {x: (position.x ?? token.center.x) - xOffset, y: (position.y ?? token.center.y) - yOffset});
    await token.object.movementAnimationPromise;
}
// 2024 RAM (space-entry): the single creature the sphere was moved into. Foundry won't reliably let
// the sphere share a square with a creature (a drag onto one snaps it up against the target), so
// "moved into a creature's space" resolves to the creature the sphere ended on top of OR right up
// against — the nearest creature within 5 ft of the destination. One ram (nearest), never all nearby;
// confirm-first guards an incidental reposition near a bystander.
function findEnteredCreature(sphereToken) {
    let nearby = tokenUtils.findNearby(sphereToken, 5, 'all', {includeIncapacitated: true});
    if (!nearby.length) return null;
    let sc = sphereToken.center;
    nearby.sort((a, b) => Math.hypot(a.center.x - sc.x, a.center.y - sc.y) - Math.hypot(b.center.x - sc.x, b.center.y - sc.y));
    return nearby[0];
}
async function moved({trigger}) {
    let sphereToken = trigger.token;
    let ramItem = trigger.entity;
    if (!sphereToken || !ramItem) return;
    let actorUuid = ramItem.flags['chris-premades']?.flamingSphere?.actorUuid;
    let caster = actorUuid ? await fromUuid(actorUuid) : null;
    // Bonus-action economy (warn-and-allow): moving the sphere in combat costs the caster's bonus
    // action. Already spent → warn but let the move stand (GM-override). Out of combat: free.
    if (caster?.inCombat) {
        if (MidiQOL.hasUsedBonusAction(caster)) {
            genericUtils.notify('CHRISPREMADES.Macros.FlamingSphere.BonusActionUsed', 'warn');
        } else {
            await MidiQOL.setBonusActionUsed(caster);
        }
    }
    // Ram: only when the sphere was moved into a creature's space (confirm-first, guards accidental drags).
    let entered = findEnteredCreature(sphereToken);
    if (!entered) return;
    let confirmed = await dialogUtils.confirm(ramItem.parent.name, genericUtils.format('CHRISPREMADES.Macros.FlamingSphere.RamConfirm', {name: entered.document.name}));
    if (!confirmed) return;
    let featureData = genericUtils.duplicate(ramItem.toObject());
    await workflowUtils.syntheticItemDataRoll(featureData, sphereToken.actor, [entered]);
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
    // The bonus action is marked by the moved pass (unifies drag + crosshair and stays cancel-free),
    // so don't let midi also mark it for the Move activity here — that would double-spend it.
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
    version: '1.0.25'
};
export let flamingSphereMoved = {
    name: 'Flaming Sphere: Moved',
    version: '1.0.25',
    movement: [
        {
            pass: 'moved',
            macro: moved,
            priority: 50
        }
    ]
};