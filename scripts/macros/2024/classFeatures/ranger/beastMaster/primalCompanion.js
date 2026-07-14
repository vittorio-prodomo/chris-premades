import {Summons} from '../../../../../lib/summons.js';
import {activityUtils, actorUtils, combatUtils, compendiumUtils, constants, dialogUtils, effectUtils, errors, genericUtils, itemUtils, workflowUtils} from '../../../../../utils.js';

// Locate the tokens tracked by the caster's Primal Companion summon effect (living or a lingering
// corpse). The effect keeps its summoned token ids/scenes in flags.chris-premades.summons.
function getBeastTokens(actor) {
    let effect = effectUtils.getEffectByIdentifier(actor, 'primalCompanion');
    if (!effect) return [];
    let ids = effect.flags['chris-premades']?.summons?.ids ?? {};
    let scenes = effect.flags['chris-premades']?.summons?.scenes ?? {};
    let tokens = [];
    for (let [name, tokenIds] of Object.entries(ids)) {
        let sceneIds = scenes[name] ?? [];
        tokenIds.forEach((tid, idx) => {
            let scene = game.scenes.get(sceneIds[idx]) ?? canvas.scene;
            let tok = scene?.tokens.get(tid);
            if (tok) tokens.push(tok);
        });
    }
    return tokens;
}
function findDeadBeast(actor) {
    return getBeastTokens(actor).find(t => t.actor && t.actor.system.attributes.hp.value <= 0);
}
async function dismissBeast(actor) {
    let effect = effectUtils.getEffectByIdentifier(actor, 'primalCompanion');
    if (!effect) return;
    // Remove the summoned tokens/combatants, then the caster summon effect. Deleting the effect
    // also re-hides Command/Dismiss/Restore (CPR's rehideActivities on deleteActiveEffect).
    await Summons.dismiss({trigger: {entity: effect}});
    await genericUtils.remove(effect);
}
// Re-summoning while a beast (living OR a lingering corpse) already exists must not stack a second
// beast — the summons lib appends token ids to the existing effect. RAW: the old beast vanishes when
// the new one appears. Gate on dnd5e.preUseActivity (fires before the card / action-economy / any
// consumption — see potionOfHealing.js): confirm, then dismiss-and-replace, else abort clean.
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    if (!['primalCompanionLand', 'primalCompanionSea', 'primalCompanionSky'].includes(activityUtils.getIdentifier(activity))) return;
    if (usageConfig?.chrisPremades?.primalReplaceConfirmed) return;
    let actor = activity.item?.actor;
    if (!actor) return;
    if (!effectUtils.getEffectByIdentifier(actor, 'primalCompanion')) return; // no beast yet: proceed
    (async () => {
        let confirmed = await dialogUtils.confirm(activity.item.name, 'CHRISPREMADES.Macros.PrimalCompanion.ReplaceBeast');
        if (!confirmed) return; // cancel: clean abort, nothing spent
        await dismissBeast(actor);
        await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {primalReplaceConfirmed: true}}, {inplace: false}), {configure: false}, {});
    })();
    return false;
});
// Restore is a Magic action that expends a spell slot to return a beast that has died within the
// last hour (GM adjudicates the hour). Gate on preUseActivity so a use with no fallen beast aborts
// BEFORE the spell slot is consumed; the heal itself runs in the rollFinished macro below.
Hooks.on('dnd5e.preUseActivity', (activity) => {
    if (activityUtils.getIdentifier(activity) !== 'primalCompanionRestore') return;
    let actor = activity.item?.actor;
    if (!actor) return;
    if (findDeadBeast(actor)) return; // a fallen beast exists: proceed (slot consumed, macro heals)
    ui.notifications.warn(genericUtils.translate('CHRISPREMADES.Macros.PrimalCompanion.NoDeadBeast'));
    return false;
});
async function use({workflow}) {
    let activityIdentifier = activityUtils.getIdentifier(workflow.activity);
    let sourceActor = await compendiumUtils.getActorFromCompendium(constants.packs.summons, 'CPR - Primal Companion');
    if (!sourceActor) return;
    let classLevel = workflow.actor.classes?.ranger?.system?.levels;
    if (!classLevel) return;
    let primalBondFeatureData = await Summons.getSummonItem('Primal Bond', {}, workflow.item, {translate: 'CHRISPREMADES.Macros.PrimalCompanion.PrimalBond', identifier: 'primalCompanionPrimalBond'});
    let dashData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Dash', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Dash', identifier: 'primalCompanionDash'});
    let disengageData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Disengage', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Disengage', identifier: 'primalCompanionDisengage'});
    let dodgeData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Dodge', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Dodge', identifier: 'primalCompanionDodge'});
    let helpData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Help', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Help', identifier: 'primalCompanionHelp'});
    if (!primalBondFeatureData || !dashData || !disengageData || !dodgeData || !helpData) {
        errors.missingPackItem();
        return;
    }
    let itemsToAdd = [primalBondFeatureData];
    let commandFeature = activityUtils.getActivityByIdentifier(workflow.item, 'primalCompanionCommand', {strict: true});
    if (!commandFeature) return;
    let exceptionalTraining = itemUtils.getItemByIdentifier(workflow.actor, 'exceptionalTraining');
    if (exceptionalTraining) {
        let genericActions = [dashData, disengageData, dodgeData, helpData];
        genericActions.forEach(i => {
            let genericActivity = Object.entries(i.system.activities)[0][1];
            genericActivity.activation.type = 'bonus';
            itemsToAdd.push(i);
        });
    }
    else {
        itemsToAdd.push(dodgeData);
    }
    let creatureType = activityIdentifier.slice(15).toLowerCase();
    let hpValue = 5 + (classLevel * 5);
    let name = itemUtils.getConfig(workflow.item, creatureType + 'Name');
    // Only did this weird add so we don't get a false positive for a missing translation
    if (!name?.length) name = genericUtils.translate('CHRISPREMADES.Summons.CreatureNames.' + 'BeastOfThe' + creatureType.capitalize());
    let updates = {
        actor: {
            name,
            system: {
                details: {
                    cr: actorUtils.getCRFromProf(workflow.actor.system.attributes.prof)
                },
                attributes: {
                    hp: {
                        formula: hpValue,
                        max: hpValue,
                        value: hpValue
                    },
                    ac: {
                        flat: 13 + workflow.actor.system.abilities.wis.mod
                    }
                }
            },
            prototypeToken: {
                name,
                disposition: workflow.token.document.disposition
            },
            items: itemsToAdd
        },
        token: {
            name,
            disposition: workflow.token.document.disposition
        }
    };
    let avatarImg = itemUtils.getConfig(workflow.item, creatureType + 'Avatar');
    let tokenImg = itemUtils.getConfig(workflow.item, creatureType + 'Token');
    if (avatarImg) updates.actor.img = avatarImg;
    if (tokenImg) {
        genericUtils.setProperty(updates, 'actor.prototypeToken.texture.src', tokenImg);
        genericUtils.setProperty(updates, 'token.texture.src', tokenImg);
    }
    if (creatureType === 'land') {
        let beastsStrikeData = await Summons.getSummonItem('Beast\'s Strike (Land)', {}, workflow.item, {flatAttack: true, translate: 'CHRISPREMADES.Macros.PrimalCompanion.BeastsStrike', identifier: 'primalCompanionLandBeastsStrike', rules: 'modern'});
        if (!beastsStrikeData) {
            errors.missingPackItem();
            return;
        }
        let selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Dialog.DamageType', [
            ['DND5E.DamageBludgeoning', 'bludgeoning'],
            ['DND5E.DamagePiercing', 'piercing'],
            ['DND5E.DamageSlashing', 'slashing']
        ]);
        if (!selection) selection = 'slashing';
        let types = [selection];
        if (exceptionalTraining) {
            types.push('force');
        }
        let attackActivity = Object.entries(beastsStrikeData.system.activities).map(a => a[1]).find(a => a.type === 'attack');
        attackActivity.damage.parts[0].types = new Set(types);
        addCommandedStrikeMacro(beastsStrikeData);
        updates.actor.items.push(beastsStrikeData);
        genericUtils.setProperty(updates, 'actor.system.attributes.movement', {walk: 40, climb: 40});
    } else if (creatureType === 'sea') {
        let beastsStrikeData = await Summons.getSummonItem('Beast\'s Strike (Sea)', {}, workflow.item, {flatAttack: true, translate: 'CHRISPREMADES.Macros.PrimalCompanion.BeastsStrike', identifier: 'primalCompanionSeaBeastsStrike', rules: 'modern'});
        let amphibiousData = await Summons.getSummonItem('Amphibious', {}, workflow.item, {translate: 'CHRISPREMADES.CommonFeatures.Amphibious', identifier: 'primalCompanionAmphibious', rules: 'modern'});
        if (!beastsStrikeData || !amphibiousData) {
            errors.missingPackItem();
            return;
        }
        let selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Dialog.DamageType', [
            ['DND5E.DamageBludgeoning', 'bludgeoning'],
            ['DND5E.DamagePiercing', 'piercing']
        ]);
        if (!selection) selection = 'bludgeoning';
        let types = [selection];
        if (exceptionalTraining) {
            types.push('force');
        }
        let attackActivity = Object.entries(beastsStrikeData.system.activities).map(a => a[1]).find(a => a.type === 'attack');
        attackActivity.damage.parts[0].types = new Set(types);
        beastsStrikeData.flags['chris-premades'].config.generic.autoGrapple.dc = workflow.actor.system.attributes.spell.dc;
        addCommandedStrikeMacro(beastsStrikeData);
        updates.actor.items.push(amphibiousData, beastsStrikeData);
        genericUtils.setProperty(updates, 'actor.system.attributes.movement', {walk: 5, swim: 60});
    } else {
        hpValue = 4 + 4 * classLevel;
        let beastsStrikeData = await Summons.getSummonItem('Beast\'s Strike (Sky)', {}, workflow.item, {flatAttack: true, translate: 'CHRISPREMADES.Macros.PrimalCompanion.BeastsStrike', identifier: 'primalCompanionSkyBeastsStrike', rules: 'modern'});
        let flybyData = await Summons.getSummonItem('Flyby', {}, workflow.item, {translate: 'CHRISPREMADES.CommonFeatures.Flyby', identifier: 'primalCompanionFlyby', rules: 'modern'});
        if (!flybyData || !beastsStrikeData) {
            errors.missingPackItem();
            return;
        }
        let types = ['slashing'];
        if (exceptionalTraining) {
            types.push('force');
        }
        let attackActivity = Object.entries(beastsStrikeData.system.activities).map(a => a[1]).find(a => a.type === 'attack');
        attackActivity.damage.parts[0].types = new Set(types);
        addCommandedStrikeMacro(beastsStrikeData);
        updates.actor.items.push(beastsStrikeData, flybyData);
        genericUtils.mergeObject(updates, {
            actor: {
                system: {
                    abilities: {
                        str: {
                            value: 6
                        },
                        dex: {
                            value: 16
                        },
                        con: {
                            value: 13
                        }
                    },
                    attributes: {
                        hp: {
                            formula: hpValue,
                            max: hpValue,
                            value: hpValue
                        },
                        movement: {
                            walk: 10,
                            fly: 60
                        }
                    },
                    traits: {
                        size: 'sm'
                    }
                },
                prototypeToken: {
                    texture: {
                        scaleX: 0.8,
                        scaleY: 0.8
                    }
                }
            },
            token: {
                texture: {
                    scaleX: 0.8,
                    scaleY: 0.8
                }
            }
        });
    }
    let animation = itemUtils.getConfig(workflow.item, creatureType + 'Animation') ?? 'none';
    let identifiersToVae = ['primalCompanionDodge', 'primalCompanionBeastsStrikeLand', 'primalCompanionBeastsStrikeSea', 'primalCompanionBeastsStrikeSky'];
    // Dismiss (special) exposed via the summons-lib dismissActivity option → lands in Argon's Special
    // panel + reroutes the caster effect's VAE button to it. Restore + Dismiss are unhidden alongside
    // Command (they live in hiddenActivities); re-hidden when the beast is dismissed. Guarded so an
    // item that predates these activities still summons (falls back to the default VAE dismiss).
    let dismissActivity = activityUtils.getActivityByIdentifier(workflow.item, 'primalCompanionDismiss');
    let secondaryUnhide = ['primalCompanionRestore', 'primalCompanionDismiss'].filter(id => activityUtils.getActivityByIdentifier(workflow.item, id));
    await Summons.spawn(sourceActor, updates, workflow.item, workflow.token, {
        range: 10,
        animation,
        initiativeType: 'follows',
        dontDismissOnDefeat: true,
        ...(dismissActivity ? {dismissActivity} : {}),
        additionalSummonVaeButtons:
            updates.actor.items
                .filter(i => identifiersToVae.includes(i.flags['chris-premades'].info.identifier))
                .map(i => ({type: 'use', name: i.name, identifier: i.flags['chris-premades'].info.identifier})),
        additionalVaeButtons: [{
            type: 'use',
            name: commandFeature.name,
            identifier: 'primalCompanion',
            activityIdentifier: 'primalCompanionCommand'
        }],
        unhideActivities: [
            {itemUuid: workflow.item.uuid, activityIdentifiers: ['primalCompanionCommand'], favorite: true},
            ...(secondaryUnhide.length ? [{itemUuid: workflow.item.uuid, activityIdentifiers: secondaryUnhide, favorite: false}] : [])
        ]
    });
}
async function dismiss({workflow}) {
    await dismissBeast(workflow.actor);
}
async function restore({workflow}) {
    // The spell slot is consumed by the activity's own consumption config; this returns the fallen
    // beast to life at full HP and clears its death/knockout states + combatant defeated flag.
    let deadBeast = findDeadBeast(workflow.actor);
    if (!deadBeast) return; // gated at preUseActivity, but guard against a race
    let maxHp = deadBeast.actor.system.attributes.hp.max;
    await genericUtils.update(deadBeast.actor, {'system.attributes.hp.value': maxHp});
    // Restoring HP triggers dnd5e's own automation, which asynchronously clears Unconscious +
    // Incapacitated (but leaves Dead and Prone). Let that settle first, then clear the survivors
    // on a now-stable actor — clearing them mid-automation races dnd5e's rider re-sync and fails.
    await genericUtils.sleep(500);
    for (let statusId of ['dead', 'unconscious', 'incapacitated', 'prone']) {
        if (deadBeast.actor.statuses?.has(statusId)) await deadBeast.actor.toggleStatusEffect(statusId, {active: false});
    }
    let combatant = game.combat?.combatants.find(c => c.tokenId === deadBeast.id);
    if (combatant?.isDefeated) await genericUtils.update(combatant, {defeated: false});
}
function addCommandedStrikeMacro(strikeData) {
    let macroList = strikeData.flags['chris-premades'].macros?.midi?.item ?? [];
    if (!macroList.includes('primalCompanionStrike')) genericUtils.setProperty(strikeData, 'flags.chris-premades.macros.midi.item', macroList.concat('primalCompanionStrike'));
}
async function strikePreTargeting({config}) {
    // A commanded strike is not an opportunity attack: with recordAOO active, midi flags any attack
    // made outside the beast's own combat turn as an AoO, which skips the out-of-range workflow abort
    // (warns but still applies damage) and wrongly consumes the beast's reaction.
    genericUtils.setProperty(config, 'midiOptions.workflowOptions.notReaction', true);
}
async function damage({workflow}) {
    let ownerActor = await fromUuid(workflow.actor.flags['chris-premades'].summons.control.actor);
    let bestialFury = itemUtils.getItemByIdentifier(ownerActor, 'bestialFury');
    if (!bestialFury) return;
    if (workflow.hitTargets.size !== 1) return;
    if (!workflowUtils.isAttackType(workflow, 'attack')) return;
    let effect = effectUtils.getEffectByIdentifier(ownerActor, 'huntersMark');
    if (!effect) return;
    let {targets: validTargetUuids, formula, damageType} = effect.flags['chris-premades'].huntersMark;
    if (!validTargetUuids.includes(workflow.hitTargets.first().document.uuid)) return;
    let item = workflow.item;
    if (!combatUtils.perTurnCheck(item, 'bestialFury', false, workflow.token.id)) return;
    await workflowUtils.bonusDamage(workflow, formula, {damageType});
    await combatUtils.setTurnCheck(item, 'bestialFury');
}
export let primalCompanion = {
    name: 'Primal Companion',
    version: '1.3.79',
    rules: 'modern',
    hasAnimation: true,
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['primalCompanionLand', 'primalCompanionSea', 'primalCompanionSky']
            },
            {
                pass: 'rollFinished',
                macro: dismiss,
                priority: 50,
                activities: ['primalCompanionDismiss']
            },
            {
                pass: 'rollFinished',
                macro: restore,
                priority: 50,
                activities: ['primalCompanionRestore']
            }
        ]
    },
    config: [
        {
            value: 'landName',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'seaName',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'skyName',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'landToken',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'seaToken',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'skyToken',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'landAvatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'seaAvatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'skyAvatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'landAnimation',
            label: 'CHRISPREMADES.Config.SpecificAnimation',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'select',
            default: 'earth',
            category: 'animation',
            options: constants.summonAnimationOptions
        },
        {
            value: 'seaAnimation',
            label: 'CHRISPREMADES.Config.SpecificAnimation',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'select',
            default: 'water',
            category: 'animation',
            options: constants.summonAnimationOptions
        },
        {
            value: 'skyAnimation',
            label: 'CHRISPREMADES.Config.SpecificAnimation',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'select',
            default: 'air',
            category: 'animation',
            options: constants.summonAnimationOptions
        }
    ]
};
export let bestialFury = {
    name: 'Bestial Fury',
    version: primalCompanion.version,
    rules: primalCompanion.rules,
    midi: {
        item: [
            {
                pass: 'damageRollComplete',
                macro: damage,
                priority: 250
            }
        ]
    }
};
export let primalCompanionStrike = {
    name: 'Beast\'s Strike',
    version: primalCompanion.version,
    rules: primalCompanion.rules,
    midi: {
        item: [
            {
                pass: 'preTargeting',
                macro: strikePreTargeting,
                priority: 50
            }
        ]
    }
};