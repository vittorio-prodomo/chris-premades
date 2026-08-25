// ⚠️ No utils.js import here: protectionFromEvilAndGood.test.mjs imports this module under plain
// node, and utils.js touches Foundry globals at load. autoSuccessRow.mjs is pure; i18n and
// fromUuid are runtime globals reached only inside the functions.
import {paintAutoSuccessRow} from '../../../lib/utilities/autoSuccessRow.mjs';

async function save({trigger}) {
    // T129: don't ask about advantage on a save the clause-1 handler is about to FORCE — asking
    // about a save that cannot fail is noise. Same predicate as preTargetSave, keyed off the
    // activity uuid the save event stashes on the roll config. When the activity is unreachable
    // (possession, repeat saves against an already-applied effect, overtime rolls) the prompt
    // keeps its legitimate residual role — suppressed conditionally, never removed.
    let activityUuid = trigger?.config?.['chris-premades']?.activityUuid;
    if (activityUuid) {
        let activity = await fromUuid(activityUuid);
        if (activity && protectedCreatureTypes.has(raceOrType(activity.actor)) && activityHasProtectedCondition(activity)) return;
    }
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
async function preTargetSave({workflow, token}) {
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
    // T129 dedup: the attribution display name is the single place the explanation lives now
    // (the paint no longer re-appends a contained reason), so pass the localized reason here.
    // Node-safe: the guard tests import this module under plain node, where game is undefined.
    let autoSuccessReason = globalThis.game?.i18n?.localize('CHRISPREMADES.Macros.ProtectionFromEvilAndGood.AutoSuccessReason') ?? 'Protection from Evil and Good';
    for (const tracker of trackers) {
        tracker?.modifiers?.succeed(
            'protectionFromEvilAndGood',
            autoSuccessReason
        );
    }
    // T129: remember who was forced, for the display repaint after the card is drawn. midi shows
    // a forced success as a pinned 99 — mechanically its native route, visually a fake number.
    if (token) {
        workflow.chrisPremades ??= {};
        (workflow.chrisPremades.pfegAutoSucceeded ??= new Set()).add(token.id);
    }
}
// T129: the T133 AUTOSUCCESS house convention (see GPS's Sleep repaint). Runs per target at
// postTargetEffectApplication — the target pass that fires AFTER displaySaves has drawn the card;
// the real roll stays in the hover breakdown, the reason lands in the attribution tooltip.
// ⚠️ displaySaves REPLACES its card block, so re-calling it per painted target is safe.
async function repaintAutoSuccess({workflow, token}) {
    let forced = workflow?.chrisPremades?.pfegAutoSucceeded;
    if (!token || !forced?.has(token.id)) return;
    forced.delete(token.id);
    let row = workflow.saveDisplayData?.find(d => d.id === token.id);
    if (!row) return;
    paintAutoSuccessRow(row, {
        label: game.i18n.localize('CHRISPREMADES.Macros.ProtectionFromEvilAndGood.AutoSuccess'),
        reason: game.i18n.localize('CHRISPREMADES.Macros.ProtectionFromEvilAndGood.AutoSuccessReason')
    });
    await workflow.displaySaves(false);
}
export let protectionFromEvilAndGood = {
    name: 'Protection from Evil and Good',
    version: '1.3.140',
    preTargetSave,
    repaintAutoSuccess,
    save: [
        {
            pass: 'context',
            macro: save,
            priority: 50
        }
    ]
};
