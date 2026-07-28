import {itemUtils, tokenUtils, workflowUtils} from '../../../utils.js';
async function use({trigger, workflow}) {
    if (!workflow.failedSaves.size) return;
    let distance = Number(itemUtils.getConfig(workflow.item, 'distance'));
    let upcastDistance = Number(itemUtils.getConfig(workflow.item, 'upcastDistance')) || 0;
    let upcastLevels = Math.max(0, workflowUtils.getCastLevel(workflow) - (workflow.castData?.baseLevel ?? 1));
    distance += upcastDistance * upcastLevels;
    let template = workflow.template;
    await Promise.all(workflow.failedSaves.map(async i => await tokenUtils.pushToken(workflow.token, i, distance, {template})));
}
export let thunderwave = {
    name: 'Thunderwave',
    version: '1.1.10',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50
            }
        ]
    },
    config: [
        {
            value: 'distance',
            label: 'CHRISPREMADES.Generic.Distance',
            type: 'text',
            default: 10,
            homebrew: true,
            category: 'homebrew'
        },
        {
            value: 'upcastDistance',
            label: 'CHRISPREMADES.Macros.Thunderwave.UpcastDistance',
            type: 'text',
            default: 5,
            homebrew: true,
            category: 'homebrew'
        }
    ]
};