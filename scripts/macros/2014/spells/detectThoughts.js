import {activityUtils, compendiumUtils, constants, effectUtils, errors, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';

async function use({workflow}) {
    let concentrationEffect = await effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'probeDeeper', {strict: true});
    if (!feature) {
        if (concentrationEffect) await genericUtils.remove(concentrationEffect);
        return;
    }
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: itemUtils.convertDuration(workflow.item)
    };
    await effectUtils.createEffect(workflow.actor, effectData, {
        concentrationItem: workflow.item, 
        strictlyInterdependent: true, 
        identifier: 'detectThoughts', 
        vae: [{
            type: 'use', 
            name: feature.name, 
            identifier: 'detectThoughts',
            activityIdentifier: 'probeDeeper'
        }],
        unhideActivities: {
            itemUuid: workflow.item.uuid,
            activityIdentifiers: ['probeDeeper'],
            favorite: true
        }
    });
    if (concentrationEffect) await genericUtils.update(concentrationEffect, {duration: effectData.duration});
}
async function late({workflow}) {
    if (workflow.failedSaves.size) return;
    let effect = effectUtils.getConcentrationEffect(workflow.actor, workflow.item.origin);
    if (effect) await genericUtils.remove(effect);
}
async function early({dialog}) {
    dialog.configure = false;
}
/*
 * Named exports so the 2024 port (T123) can reuse these passes by REFERENCE. It must not reach them
 * through `detectThoughts.midi.item[n].macro` or by matching `macro.name`: this module is bundled by
 * webpack and minified, so function names are mangled, and array position is upstream's to change.
 */
export {late as detectThoughtsLate, early as detectThoughtsEarly};
export let detectThoughts = {
    name: 'Detect Thoughts',
    version: '1.2.28',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['detectThoughts']
            },
            {
                pass: 'rollFinished',
                macro: late,
                priority: 50,
                activities: ['probeDeeper']
            },
            {
                pass: 'preTargeting',
                macro: early,
                priority: 50,
                activities: ['probeDeeper']
            }
        ]
    }
};