import {activityUtils, actorUtils, animationUtils, dialogUtils, effectUtils, errors, genericUtils, itemUtils, socketUtils, workflowUtils} from '../../../utils.js';
async function use({workflow}) {
    if (!workflow.targets.size) return;
    let maxMissiles = 2 + workflowUtils.getCastLevel(workflow);
    let selection;
    if (workflow.targets.size === maxMissiles) {
        // As many targets as missiles: fire one bolt at each and skip the distribution dialog.
        selection = [...workflow.targets].map(token => ({document: token, value: 1}));
    } else {
        let result = await dialogUtils.selectTargetDialog(workflow.item.name, genericUtils.format('CHRISPREMADES.Macros.MagicMissile.Select', {maxMissiles}), workflow.targets, {
            type: 'selectAmount',
            maxAmount: maxMissiles
        });
        selection = result ? result[0] : undefined;
        if (!selection || !selection.length) {
            // Distribution dialog was cancelled or nothing was allotted. The spell slot is
            // already spent (this macro runs on rollFinished), so refund it and post a short
            // "cancelled" card (the usage card was already posted at cast time).
            let refunded = await refundSpellSlot(workflow);
            await ChatMessage.create({
                speaker: ChatMessage.implementation.getSpeaker({token: workflow.token}),
                content: `<em>${workflow.item.name} cancelled${refunded ? ' — spell slot refunded' : ''}.</em>`
            });
            return;
        }
    }
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'magicMissileBolt');
    let featureFlat = activityUtils.getActivityByIdentifier(workflow.item, 'magicMissileFlat');
    if (!feature && rollEach) {
        errors.missingActivity('magicMissileBolt');
        return;
    } else if (!featureFlat && !rollEach) {
        errors.missingActivity('magicMissileFlat');
        return;
    }
    let rollEach = itemUtils.getConfig(workflow.item, 'rollEach');
    let damageFormula = feature.damage.parts[0].formula;
    let damageType = feature.damage.parts[0].types.first();
    let activityData;
    if (!rollEach) {
        let damageRoll = await new CONFIG.Dice.DamageRoll(damageFormula, workflow.activity.getRollData(), {type: damageType}).evaluate();
        await MidiQOL.displayDSNForRoll(damageRoll);
        activityData = activityUtils.withChangedDamage(featureFlat, damageRoll.total.toString(), [damageType]);
    }
    let shieldedFeatureData = feature.clone({'damage.parts': []}, {keepId: true}).toObject();
    let playAnimation = itemUtils.getConfig(workflow.item, 'playAnimation') && animationUtils.jb2aCheck();
    let colors = [ 'grey', 'dark_red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    let lastColor = Math.floor((Math.random() * colors.length));
    let colorSelection = itemUtils.getConfig(workflow.item, 'color');
    let sound = itemUtils.getConfig(workflow.item, 'sound');
    if (playAnimation && colorSelection === 'random' || colorSelection === 'cycle') await animationUtils.preloadAnimations('jb2a.magic_missile');
    for (let {document: targetToken, value: numBolts} of selection) {
        if (isNaN(numBolts) || numBolts == 0) continue;
        let isShielded = false;
        let shieldItems = itemUtils.getAllItemsByIdentifier(targetToken.actor, 'shield').filter(i => !i.system.hasLimitedUses || i.system.uses.value);
        if (effectUtils.getEffectByIdentifier(targetToken.actor, 'shield')) {
            isShielded = true;
        } else if (!actorUtils.hasUsedReaction(targetToken.actor) && shieldItems.length) {
            shieldItems = shieldItems.filter(i => i.system.method !== 'spell' || i.system.prepared);
            shieldItems = shieldItems.filter(i => i.system.method !== 'pact' || targetToken.actor.system.spells.pact.value);
            shieldItems = shieldItems.filter(i => i.system.hasLimitedUses || !i.system.level || (
                actorUtils.hasSpellSlots(targetToken.actor, i.system.level)
            ) || ['atwill', 'innate'].includes(i.system.method));
            let selectedSpell = await dialogUtils.selectDocumentDialog(workflow.item.name, 'CHRISPREMADES.Macros.MagicMissile.Shield', shieldItems, {userId: socketUtils.firstOwner(targetToken.actor, true), addNoneDocument: true});
            if (selectedSpell) {
                await socketUtils.remoteRollItem(selectedSpell, {}, {targetUuids: [targetToken.document.uuid]}, socketUtils.firstOwner(targetToken, true));
                if (effectUtils.getEffectByIdentifier(targetToken.actor, 'shield')) isShielded = true;
            }
        }
        for (let i = 0; i < numBolts; i++) {
            if (playAnimation) {
                let path = 'jb2a.magic_missile.';
                if (colorSelection === 'random') {
                    path += colors[Math.floor(Math.random() * colors.length)];
                } else if (colorSelection === 'cycle') {
                    path += colors[lastColor];
                    lastColor++;
                    if (lastColor >= colors.length) lastColor = 0;
                } else {
                    path += colorSelection;
                }
                new Sequence()
                    .effect()
                    .file(path)
                    .atLocation(workflow.token)
                    .stretchTo(targetToken)
                    .randomizeMirrorY()
                    .missed(isShielded)
                    
                    .sound()
                    .playIf(sound)
                    .file(sound)
                    
                    .play();
            }
            if (isShielded) {
                await workflowUtils.syntheticActivityDataRoll(shieldedFeatureData, workflow.item, workflow.actor, [targetToken], {options: {workflowOptions: {targetConfirmation: 'none', skipHeroicInspiration: true}}});
            } else if (rollEach) {
                await workflowUtils.syntheticActivityRoll(feature, [targetToken], {options: {workflowOptions: {targetConfirmation: 'none', skipHeroicInspiration: true}}});
            } else {
                await workflowUtils.syntheticActivityDataRoll(activityData, workflow.item, workflow.actor, [targetToken], {options: {workflowOptions: {targetConfirmation: 'none', skipHeroicInspiration: true}}});
            }
        }
    }
}
async function refundSpellSlot(workflow) {
    // Only leveled ('spell') and pact casting actually consume a slot; at-will/innate/ritual do not.
    let method = workflow.item?.system?.method;
    if (method !== 'spell' && method !== 'pact') return false;
    let slotKey = method === 'pact' ? 'pact' : actorUtils.getEquivalentSpellSlotName(workflow.actor, workflowUtils.getCastLevel(workflow));
    let slot = slotKey ? workflow.actor.system.spells[slotKey] : undefined;
    if (!slot) return false;
    await genericUtils.update(workflow.actor, {['system.spells.' + slotKey + '.value']: Math.min(slot.value + 1, slot.max)});
    return true;
}
export let magicMissile = {
    name: 'Magic Missile',
    version: '1.2.28',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['magicMissile']
            }
        ]
    },
    config: [
        {
            value: 'rollEach',
            label: 'CHRISPREMADES.Macros.MagicMissile.RollEach',
            type: 'checkbox',
            default: false,
            category: 'homebrew',
            homebrew: true
        },
        {
            value: 'playAnimation',
            label: 'CHRISPREMADES.Config.PlayAnimation',
            type: 'checkbox',
            default: true,
            category: 'animation'
        },
        {
            value: 'color',
            label: 'CHRISPREMADES.Config.Color',
            type: 'select',
            default: 'purple',
            category: 'animation',
            options: [
                {
                    value: 'blue',
                    label: 'CHRISPREMADES.Config.Colors.Blue',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'green',
                    label: 'CHRISPREMADES.Config.Colors.Green',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'purple',
                    label: 'CHRISPREMADES.Config.Colors.Purple'
                },
                {
                    value: 'yellow',
                    label: 'CHRISPREMADES.Config.Colors.Yellow',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'dark_red',
                    label: 'CHRISPREMADES.Config.Colors.DarkRed',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'orange',
                    label: 'CHRISPREMADES.Config.Colors.Orange',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'grey',
                    label: 'CHRISPREMADES.Config.Colors.Grey',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'random',
                    label: 'CHRISPREMADES.Config.Colors.Random',
                    requiredModules: ['jb2a_patreon']
                },
                {
                    value: 'cycle',
                    label: 'CHRISPREMADES.Config.Colors.Cycle',
                    requiredModules: ['jb2a_patreon']
                }
            ]
        },
        {
            value: 'sound',
            label: 'CHRISPREMADES.Config.Sound',
            type: 'file',
            default: '',
            category: 'sound'
        }
    ]
};