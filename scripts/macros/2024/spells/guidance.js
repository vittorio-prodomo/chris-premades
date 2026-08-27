import {activityUtils, combatUtils, dialogUtils, effectUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';
function flavoredBonus(formula, item) {
    let flavor = genericUtils.format('CHRISPREMADES.Macros.Guidance.Flavor', {item: item.name}).replace(/[[\]]/g, '');
    return '+ ' + formula + '[' + flavor + ']';
}
// ⚠️ FORK PATCH (queue T144a): shared by the targeted cast and the skill-check offer, so both
// paths apply the SAME chosen-skill effect (upstream had this inline in use() only).
async function applyGuidanceEffect(item, activity, skillId, actors) {
    let sourceEffect = item.effects.contents?.[0];
    if (!sourceEffect) return;
    let skillCfg = CONFIG.DND5E.skills[skillId];
    let effectData = genericUtils.duplicate(sourceEffect.toObject());
    effectData.changes[0].key = effectData.changes[0].key.replaceAll('acr', skillId);
    effectData.origin = sourceEffect.uuid;
    effectData.duration = itemUtils.convertDuration(activity);
    let formula = itemUtils.getConfig(item, 'formula');
    effectData.changes[0].value = flavoredBonus(formula, item);
    effectData.img = skillCfg?.icon ?? sourceEffect.img;
    effectData.description = (effectData.description ?? '') + '<p><em>' + genericUtils.format('CHRISPREMADES.Macros.Guidance.ChosenSkill', {skill: skillCfg?.label ?? skillId}) + '</em></p>';
    await Promise.all(actors.map(async effectActor => {
        await effectUtils.createEffect(effectActor, effectData, {concentrationItem: item});
    }));
}
async function use({trigger, workflow}) {
    if (!workflow.targets.size || !workflow.activity) return;
    let options = Object.entries(CONFIG.DND5E.skills).map(([key, value]) => ({
        name: value.label,
        id: key,
        img: value.icon
    }));
    let selection = await dialogUtils.selectDocumentDialog(workflow.item.name, 'CHRISPREMADES.Generic.SelectASkill', options);
    if (!selection) return;
    await applyGuidanceEffect(workflow.item, workflow.activity, selection.id, Array.from(workflow.targets).map(token => token.actor));
}
// ⚠️ FORK PATCH (queue T144a, re-shaped per Vittorio 2026-08-26): the offer now fires on the
// SITUATIONAL pass — BEFORE the d20 is rolled (RAW: you cast Guidance before the check, never
// after seeing the die). Accepting is a REAL cast: the selfUse activity carries an EXPLICIT
// 1-minute concentration duration in packData (it is a RIDER — riders never inherit the item
// duration, so override:false is silently dead for it), and the chosen-skill effect lands on
// the caster BEFORE the roll — its `+ 1d4[from Guidance]` bonus then joins the roll naturally
// through system.skills.X.bonuses.check, no addToRoll needed.
async function skillCheck({trigger: {actor, entity: item, token, skillId}}) {
    let prompt = itemUtils.getConfig(item, 'promptToUse');
    if (prompt === 'never') return;
    if (combatUtils.inCombat()) return;
    let effect = effectUtils.getEffectByIdentifier(actor, 'guidanceEffect');
    // An active Guidance already covering THIS skill makes the offer pointless — the bonus
    // will apply on its own. One covering a DIFFERENT skill falls through to the offer, whose
    // concentration warning below names what a re-cast would end.
    if (effect && skillId && effect.changes?.some(c => c.key?.includes('.' + skillId + '.'))) return;
    // A real cast breaks existing concentration — never behind a plain "Use Guidance?". When
    // the caster is concentrating on ANYTHING (another Guidance included), the offer names
    // what would end and on whom ("This will end Guidance on Warpey.") and always asks, even
    // with promptToUse set to 'auto'.
    let concEffects = Array.from(actor.concentration?.effects ?? []);
    let warning = '';
    if (concEffects.length) {
        let concItem = Array.from(actor.concentration.items ?? [])[0];
        let spellName = concItem?.name ?? concEffects[0].name;
        let targetNames = [...new Set(concEffects.flatMap(e => e.getDependents?.() ?? []).map(d => d?.parent?.name ?? d?.name).filter(n => n))];
        warning = targetNames.length
            ? genericUtils.format('CHRISPREMADES.Macros.Guidance.ConcentrationWarningTargets', {spellName, targets: targetNames.join(', ')})
            : genericUtils.format('CHRISPREMADES.Macros.Guidance.ConcentrationWarning', {spellName});
    }
    if (prompt === 'prompt' || warning.length) {
        let content = genericUtils.format('CHRISPREMADES.Dialog.Use', {itemName: item.name});
        if (warning.length) content += '<p><strong>⚠️ ' + warning + '</strong></p>';
        // 30s auto-expiry = no Guidance, matching the Heroic Inspiration prompt.
        let selection = await dialogUtils.confirm(item.name, content, {width: 320, timeout: 30});
        if (!selection) return;
    }
    let activity = activityUtils.getActivityByIdentifier(item, 'selfUse', {strict: true});
    await workflowUtils.syntheticActivityRoll(activity, [token], {consumeResources: true, consumeUsage: true});
    if (skillId) await applyGuidanceEffect(item, activity, skillId, [actor]);
}
export let guidance = {
    name: 'Guidance',
    version: '1.3.79',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['use']
            }
        ]
    },
    skill: [
        {
            pass: 'situational',
            macro: skillCheck,
            priority: 50
        }
    ],
    config: [
        {
            value: 'promptToUse',
            label: 'CHRISPREMADES.Config.PromptToUse',
            type: 'select',
            default: 'prompt',
            category: 'mechanics',
            options: [
                {
                    label: 'CHRISPREMADES.Generic.Never',
                    value: 'never'
                },
                {
                    label: 'CHRISPREMADES.Generic.Prompt',
                    value: 'prompt'
                },
                {
                    label: 'CHRISPREMADES.Generic.Automatic',
                    value: 'auto'
                }
            ]
        },
        {
            value: 'formula',
            label: 'CHRISPREMADES.Config.Formula',
            type: 'text',
            default: '1d4',
            category: 'homebrew',
            homebrew: true
        }
    ]
};