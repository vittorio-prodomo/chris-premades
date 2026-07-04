import {actorUtils, combatUtils, constants, dialogUtils, effectUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';

// Fork addition: shared "ranger after-hit" offer (Ensnaring Strike + Hail of Thorns).
// Mirrors divineSmite's actor hook; hailOfThorns reuses this exact midi.actor array,
// and the shared `unique` key makes CPR register it once per actor.
async function afterHit({trigger, workflow}) {
    if (!workflow.hitTargets.size) return;
    if (workflow.item?.type !== 'weapon') return;
    let actionType = workflowUtils.getActionType(workflow);
    if (!['mwak', 'rwak'].includes(actionType)) return;
    if (workflow.actor.concentration?.effects?.size) return; // table rule: never offer while concentrating
    if (actorUtils.hasUsedBonusAction(workflow.actor)) return;
    if (!combatUtils.isOwnTurn(workflow.token)) return; // true outside combat; id-based, no sceneId dependency
    let identifiers = ['ensnaringStrike'];
    if (actionType === 'rwak') identifiers.push('hailOfThorns');
    let spells = actorUtils.getCastableSpells(workflow.actor)
        .filter(i => identifiers.includes(genericUtils.getIdentifier(i)))
        .sort((a, b) => a.system.level - b.system.level);
    if (!spells.length) return;
    let selection = await dialogUtils.selectDocumentDialog('After-Hit Spell', 'Cast a spell on the creature you just hit? (Bonus Action)', spells, {addNoneDocument: true});
    if (!selection) return;
    let target = workflow.hitTargets.first();
    await workflowUtils.completeItemUse(selection, undefined, {targetUuids: [target.document.uuid]});
}
// RAW: a Large or larger creature has Advantage on the save. Transient midi flag,
// self-expiring the moment the target rolls its STR save (DAE specialDuration).
async function early({trigger, workflow}) {
    let largeSizes = ['lg', 'huge', 'grg'];
    await Promise.all(Array.from(workflow.targets)
        .filter(t => largeSizes.includes(t.actor?.system.traits.size))
        .map(async token => {
            let effectData = {
                name: workflow.item.name + ': Large Creature',
                img: workflow.item.img,
                origin: workflow.item.uuid,
                duration: {seconds: 60},
                changes: [{key: 'flags.midi-qol.advantage.ability.save.str', mode: 0, value: '1', priority: 20}],
                flags: {dae: {specialDuration: ['isSave.str']}}
            };
            await effectUtils.createEffect(token.actor, effectData, {});
        }));
}
async function use({trigger, workflow}) {
    let concentration = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    if (!workflow.failedSaves.size) {
        // RAW: on a successful save the vines shrivel away and the spell ends.
        if (concentration) await genericUtils.remove(concentration);
        return;
    }
    let castLevel = workflowUtils.getCastLevel(workflow);
    let baseLevel = workflow.castData.baseLevel ?? workflow.item.system.level;
    let diceNumber = itemUtils.getConfig(workflow.item, 'baseDiceNumber') + (castLevel - baseLevel);
    let diceSize = itemUtils.getConfig(workflow.item, 'diceSize');
    let damageType = itemUtils.getConfig(workflow.item, 'damageType');
    let dc = itemUtils.getSaveDC(workflow.item);
    let effectData = {
        name: 'Ensnared',
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: {seconds: 60},
        description: '<p>Restrained by thorny vines. Takes ' + diceNumber + diceSize + ' ' + damageType
            + ' damage at the start of each of its turns.</p><p><strong>Escape:</strong> the target or a creature '
            + 'within reach can take an action to make a Strength (Athletics) check vs DC ' + dc
            + '; on a success, the spell ends (delete this effect).</p>',
        changes: [{
            key: 'flags.midi-qol.OverTime',
            mode: 0,
            value: 'turn=start, damageRoll=' + diceNumber + diceSize + ', damageType=' + damageType + ', allowIncapacitated=true, label=Ensnaring Strike',
            priority: 20
        }]
    };
    await Promise.all(workflow.failedSaves.map(async token => {
        if (actorUtils.checkTrait(token.actor, 'ci', 'restrained')) return;
        await effectUtils.createEffect(token.actor, effectData, {identifier: 'ensnaredEffect', concentrationItem: workflow.item, conditions: ['restrained']});
    }));
}
export let ensnaringStrike = {
    name: 'Ensnaring Strike',
    version: '1.0.0',
    rules: 'modern',
    midi: {
        actor: [
            {
                pass: 'damageRollComplete',
                macro: afterHit,
                priority: 250,
                unique: 'rangerAfterHit'
            }
        ],
        item: [
            {
                pass: 'preItemRoll',
                macro: early,
                priority: 50
            },
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50
            }
        ]
    },
    config: [
        {
            value: 'damageType',
            label: 'CHRISPREMADES.Config.DamageType',
            type: 'select',
            default: 'piercing',
            category: 'homebrew',
            homebrew: true,
            options: constants.damageTypeOptions
        },
        {
            value: 'diceSize',
            label: 'CHRISPREMADES.Config.DiceSize',
            type: 'select',
            default: 'd6',
            category: 'homebrew',
            homebrew: true,
            options: constants.diceSizeOptions
        },
        {
            value: 'baseDiceNumber',
            label: 'CHRISPREMADES.Config.BaseDiceNumber',
            type: 'number',
            default: 1,
            category: 'homebrew',
            homebrew: true
        }
    ],
    ddbi: {
        correctedItems: {
            'Ensnaring Strike': {
                system: {
                    range: {units: 'spec', special: 'The creature you just hit with a weapon attack', value: null}
                }
            }
        }
    }
};
