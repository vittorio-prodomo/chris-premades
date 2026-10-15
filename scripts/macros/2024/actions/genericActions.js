import {constants, dialogUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';
// Custom mapping for action names that don't match CONFIG.DND5E.rules slugification
let ACTION_RULE_MAPPING = {
    'Check Cover': 'cover',
    Fall: 'falling',
    Jump: 'jumping',
    'Knock Out': 'knockingacreatureout',
    Squeeze: 'squeezing',
    Stabilize: 'stabilizing',
    Suffocation: 'suffocating',
    Underwater: 'underwatercombat'
};
async function use({trigger, workflow}) {
    let rules = itemUtils.getConfig(workflow.item, 'rules');
    if (rules === 'system') rules = genericUtils.getRules(workflow.item);
    let packId = rules === 'modern' ? constants.modernPacks.actions : constants.packs.actions;
    let pack = game.packs.get(packId);
    if (!pack) return;
    let index = await pack.getIndex();
    let filter = ['Healing Surge'];
    let circleCast = genericUtils.getCPRSetting('circleCast');
    if (!circleCast) filter.push('Circle Cast');
    let documents = index.contents;
    documents = documents.filter(i => !filter.includes(i.name));
    documents = documents.map(i => {
        let wrappedDoc = genericUtils.duplicate(i);
        wrappedDoc.ruleKey = ACTION_RULE_MAPPING[i.name] ?? i.name.toLowerCase().replace(/\s+/g, '');
        let reference = CONFIG.DND5E.rules?.[wrappedDoc.ruleKey];
        if (reference) wrappedDoc.reference = reference;
        return wrappedDoc;
    });
    let selection = await dialogUtils.selectDocumentDialog(workflow.item.name, 'CHRISPREMADES.Macros.GenericActions.Select', documents, {sortAlphabetical: true, displayReference: true});
    if (!selection) return;
    // FORK PATCH (T249): a POINTER entry runs the compendium item it names as a temporary copy
    // (the official PHB Improvised Weapon) — nothing is stored on the sheet, so neither a D&D Beyond
    // re-import nor a sync touches it.
    let launchUuid = selection.flags?.['chris-premades']?.launchUuid;
    if (launchUuid) {
        let source = await fromUuid(launchUuid);
        if (!source) {
            genericUtils.notify('CHRISPREMADES.Macros.GenericActions.LaunchMissing', 'warn');
            return;
        }
        let launchData = genericUtils.duplicate(source.toObject());
        delete launchData._id;
        await workflowUtils.syntheticItemDataRoll(launchData, workflow.actor, Array.from(game.user.targets));
        return;
    }
    let documentData = genericUtils.duplicate(selection.toObject());
    documentData.system.description.value = itemUtils.getItemDescription(documentData.name);
    if (!documentData.system.description.value) {
        let reference = documents.find(i => i._id === selection.id);
        if (reference?.reference) {
            let journal = await fromUuid(reference.reference);
            if (journal) documentData.system.description.value = itemUtils.getJournalPageContent(journal);
        }
    }
    await workflowUtils.syntheticItemDataRoll(documentData, workflow.actor, []);
}
export let genericActions = {
    name: 'Generic Actions',
    version: '1.5.46',
    rules: 'modern',
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
            value: 'rules',
            label: 'CHRISPREMADES.Config.Rules',
            type: 'select',
            default: 'system',
            category: 'mechanics',
            options: [
                {
                    label: 'CHRISPREMADES.Macros.GenericActions.System',
                    value: 'system'
                },
                {
                    label: 'CHRISPREMADES.Macros.GenericActions.Legacy',
                    value: 'legacy'
                },
                {
                    label: 'CHRISPREMADES.Macros.GenericActions.Modern',
                    value: 'modern'
                }
            ]
        }
    ]
};