import {activityUtils, effectUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';

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
        macros: [{type: 'movement', macros: ['witchBoltSource']}],
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

async function early({actor, workflow, config, dialog}) {
    dialog.configure = false;
    let effect = effectUtils.getEffectByIdentifier(actor, 'witchBolt');
    if (!effect) {
        genericUtils.notify('CHRISPREMADES.Macros.WitchBolt.NotActive', 'info');
        return false;
    }
    let targetUuid = effect.flags['chris-premades']?.witchBolt?.targetUuid;
    let targetToken = targetUuid ? (await fromUuid(targetUuid))?.object : undefined;
    if (!targetToken) {
        genericUtils.notify('CHRISPREMADES.Macros.WitchBolt.NoTarget', 'info');
        return false;
    }
    await genericUtils.updateTargets([targetToken]);
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
    }
};

export let witchBoltSource = {
    name: 'Witch Bolt (Caster)',
    version: witchBolt.version,
    rules: witchBolt.rules
};
