import {dialogUtils, genericUtils, itemUtils, rollUtils, workflowUtils} from '../../../../utils.js';
async function check({trigger: {entity: item, roll, actor, options}}) {
    let targetValue = roll.options.target;
    if (targetValue && roll.total >= targetValue) return;
    let secondWind = itemUtils.getItemByIdentifier(actor, 'secondWind');
    if (!secondWind?.system?.uses?.value) return;
    let classIdentifier = itemUtils.getConfig(item, 'classIdentifier');
    let classLevels = actor.classes[classIdentifier]?.system?.levels;
    if (!classLevels) return;
    // ⚠️ FORK PATCH (queue T145 follow-up, Vittorio 2026-08-26): the prompt states the roll,
    // its formula and (when a DC is known) that it failed; 30s auto-expiry = don't use it;
    // narrower dialog. The added bonus is FLAVORED so the expanded breakdown shows it as its
    // own labeled part instead of merging into the modifier ("+5").
    let promptKey = roll.options.target ? 'CHRISPREMADES.Macros.TacticalMind.PromptFailed' : 'CHRISPREMADES.Macros.TacticalMind.Prompt';
    let selection = await dialogUtils.confirm(item.name, genericUtils.format(promptKey, {rollTotal: roll.total, rollFormula: roll.formula, itemName: item.name, bonus: '1d10 + ' + classLevels}), {width: 320, timeout: 30});
    if (!selection) return;
    let workflow = await workflowUtils.syntheticItemRoll(item, []);
    genericUtils.setProperty(options, 'chris-premades.tacticalMind', true);
    return await rollUtils.addToRoll(roll, workflow.utilityRolls[0].total + '[' + item.name + ']');
}
async function checkLate({trigger: {entity: item, roll, actor, options}}) {
    if (!options?.['chris-premades']?.tacticalMind) return;
    let targetValue = roll.options.target;
    if (targetValue) {
        if (roll.total < targetValue) return;
    } else {
        // ⚠️ FORK PATCH (queue T145 follow-up): the DC-less consume prompt says what a "No"
        // means, and 30s auto-expiry counts as "the check failed" (no Second Wind spent).
        let selection = await dialogUtils.confirm(item.name, 'CHRISPREMADES.Macros.TacticalMind.ConsumeConfirm', {buttons: 'yesNo', width: 320, timeout: 30});
        if (!selection) return;
    }
    let secondWind = itemUtils.getItemByIdentifier(actor, 'secondWind');
    if (!secondWind) return;
    await genericUtils.update(secondWind, {'system.uses.spent': secondWind.system.uses.spent + 1});
}
export let tacticalMind = {
    name: 'Tactical Mind',
    version: '1.5.34',
    rules: 'modern',
    skill: [
        {
            pass: 'bonus',
            macro: check,
            priority: 50
        },
        {
            pass: 'post',
            macro: checkLate,
            priority: 50
        }
    ],
    check: [
        {
            pass: 'bonus',
            macro: check,
            priority: 50
        },
        {
            pass: 'post',
            macro: checkLate,
            priority: 50
        }
    ],
    toolCheck: [
        {
            pass: 'bonus',
            macro: check,
            priority: 50
        },
        {
            pass: 'post',
            macro: checkLate,
            priority: 50
        }
    ],
    config: [
        {
            value: 'classIdentifier',
            label: 'CHRISPREMADES.Config.ClassIdentifier',
            type: 'text',
            default: 'fighter',
            category: 'homebrew',
            homebrew: true
        }
    ]
};