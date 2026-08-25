import {activityUtils, combatUtils, dialogUtils, effectUtils, genericUtils, itemUtils, rollUtils, workflowUtils} from '../../../utils.js';
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
async function skillCheck({trigger: {actor, entity: item, roll, token, skillId}}) {
    let prompt = itemUtils.getConfig(item, 'promptToUse');
    if (prompt === 'never') return;
    if (combatUtils.inCombat()) return;
    let effect = effectUtils.getEffectByIdentifier(actor, 'guidanceEffect');
    if (effect) return;
    // ⚠️ FORK PATCH (queue T144a): the offer is now a REAL cast, so accepting it while already
    // concentrating on Guidance (e.g. cast on an ally) would restart concentration and delete
    // the ally's buff for a self d4. Skip the offer in that case — a deliberate re-cast is
    // still available from the sheet/HUD.
    if (effectUtils.getConcentrationEffect(actor, item)) return;
    if (prompt === 'prompt') {
        let selection = await dialogUtils.confirmUseItem(item);
        if (!selection) return;
    }
    let activity = activityUtils.getActivityByIdentifier(item, 'selfUse', {strict: true});
    // ⚠️ FORK PATCH (queue T144a, Vittorio's design): accepting the offer is a REAL cast.
    // The selfUse activity now carries an EXPLICIT 1-minute concentration duration in
    // packData (it is a RIDER — riders never inherit the item duration, so override:false
    // is silently dead for it); the synthetic roll therefore starts concentration. The
    // chosen-skill effect is applied to the caster for the skill just rolled, as a
    // concentration dependent. The d4 still lands on the CURRENT roll via addToRoll (the
    // effect arrives too late for it); further checks of that skill ride the effect.
    await workflowUtils.syntheticActivityRoll(activity, [token], {consumeResources: true, consumeUsage: true});
    if (skillId) await applyGuidanceEffect(item, activity, skillId, [actor]);
    let formula = itemUtils.getConfig(item, 'formula');
    return await rollUtils.addToRoll(roll, flavoredBonus(formula, item));
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
            pass: 'bonus',
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