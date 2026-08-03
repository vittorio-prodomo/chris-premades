async function save({trigger}) {
    return {label: 'CHRISPREMADES.Macros.ProtectionFromEvilAndGood.Save', type: 'advantage'};
}
const protectedCreatureTypes = new Set(['aberration', 'celestial', 'elemental', 'fey', 'fiend', 'undead']);
const protectedConditions = new Set(['charmed', 'frightened']);
const conditionChangeKeys = new Set(['macro.CE', 'macro.CUB', 'macro.StatusEffect', 'StatusEffect']);
function raceOrType(actor) {
    if (actor?.system?.details?.type?.value) return actor.system.details.type.value.toLowerCase();
    return (actor?.system?.details?.race?.name ?? actor?.system?.details?.race)?.toLowerCase() ?? '';
}
function activityHasProtectedCondition(activity) {
    for (const effect of activity?.applicableEffects ?? []) {
        const conditions = [
            ...effect.statuses ?? [],
            ...effect.flags?.['chris-premades']?.conditions ?? [],
            ...effect.flags?.dnd5e?.riders?.statuses ?? [],
            ...effect.changes?.filter(change => conditionChangeKeys.has(change.key)).map(change => change.value) ?? []
        ];
        if (conditions.some(condition => protectedConditions.has(condition?.toLowerCase()))) return true;
    }
    return false;
}
async function preTargetSave({workflow}) {
    if (!protectedCreatureTypes.has(raceOrType(workflow?.actor))) return;
    if (!activityHasProtectedCondition(workflow?.activity)) return;
    const saveDetails = workflow.saveDetails;
    const defaultTracker = saveDetails?.modifierTracker;
    if (!defaultTracker) return;

    // Midi queues only advantageByChoice trackers into the eventual roll. For a normal
    // one-ability save that map is absent, so preserve the tracker exposed to preTargetSave.
    if (!saveDetails.advantageByChoice && saveDetails.rollAbilities?.length === 1) {
        saveDetails.advantageByChoice = {
            [saveDetails.rollAbilities[0]]: {
                hasAdvantage: saveDetails.advantage,
                hasDisadvantage: saveDetails.disadvantage,
                tracker: defaultTracker
            }
        };
    }

    const trackers = new Set([
        defaultTracker,
        ...Object.values(saveDetails.advantageByChoice ?? {}).map(choice => choice.tracker)
    ]);
    for (const tracker of trackers) {
        tracker?.modifiers?.succeed(
            'protectionFromEvilAndGood',
            'Protection from Evil and Good'
        );
    }
}
export let protectionFromEvilAndGood = {
    name: 'Protection from Evil and Good',
    version: '1.3.139',
    preTargetSave,
    save: [
        {
            pass: 'context',
            macro: save,
            priority: 50
        }
    ]
};
