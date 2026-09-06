import {dialogUtils, genericUtils, itemUtils, rollUtils, workflowUtils} from '../../../../utils.js';
import {remainingUses} from '../../../../lib/utilities/resourceSpend.mjs';
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
    // ⚠️ i18n.format does NOT escape its substitutions and this string is rendered as dialog
    // HTML, so an item/feature renamed to '<img onerror=…>' would inject — escape the names,
    // not the template (same guard as announceSpend below). rollFormula/rollTotal are system-built.
    let esc = foundry.utils.escapeHTML;
    let selection = await dialogUtils.confirm(item.name, genericUtils.format(promptKey, {rollTotal: roll.total, rollFormula: esc(roll.formula ?? ''), itemName: esc(item.name ?? ''), bonus: '1d10 + ' + classLevels, resourceName: esc(secondWind.name ?? '')}), {width: 320, timeout: 30});
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
    // ⚠️ FORK PATCH (queue T183, Vittorio 2026-08-27): spending Second Wind was completely
    // silent — the resource just went down with nothing in chat to explain why. Say so.
    await announceSpend(actor, item, secondWind);
}
/**
 * Tell the table that a resource was spent to power a feature.
 * Its own chat card because a skill check has no midi workflow card to annotate.
 */
async function announceSpend(actor, item, resource) {
    try {
        let left = remainingUses(resource.system?.uses);
        // ⚠️ i18n.format does NOT escape its substitutions and these strings carry markup,
        // so an item renamed to '<img onerror=...>' would land in a STORED chat card that
        // re-renders for every client. Escape the names, not the template.
        let itemName = foundry.utils.escapeHTML(item.name ?? '');
        let resourceName = foundry.utils.escapeHTML(resource.name ?? '');
        let content = left === null
            ? genericUtils.format('CHRISPREMADES.Macros.TacticalMind.SpentUnknown', {itemName, resourceName})
            : genericUtils.format('CHRISPREMADES.Macros.TacticalMind.Spent', {itemName, resourceName, remaining: left});
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor}),
            content: '<p>' + content + '</p>'
        });
    } catch (error) {
        genericUtils.log('warn', 'Failed to announce the Second Wind spend: ' + (error?.message ?? error));
    }
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