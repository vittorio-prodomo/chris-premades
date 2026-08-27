import {speakerFromWorkflow} from '../lib/utilities/rollSpeaker.mjs';
async function preItemRoll(workflow) {
    workflow.workflowOptions.damageRollDSN = false;
}
async function damageRollComplete(workflow) {
    let damageRolls = [...workflow.damageRolls, ...(workflow.bonusDamageRolls ?? []), ...(workflow.otherDamageRolls ?? [])];
    // T74: these dice are ours, not midi's (preItemRoll turned its display off), so we
    // owe them the roller's identity — otherwise a label module has nothing to name and
    // an NPC's damage die reads "GM" beside an attack die that reads the creature.
    let useTokenNames = MidiQOL.configSettings?.()?.useTokenNames ?? true;
    // ⚠️ T189: identity alone is not enough. midi's own frame-one stamp names the KIND of
    // a roll (patch #16), but these dice never pass through it — we display them — so a
    // label module could say who rolled them and never what they were. Stamp the kind the
    // same way T74 stamped the speaker; the item name makes the pill read "Damage Roll ·
    // Longbow", matching how attacks already name their weapon.
    for (let damageRoll of damageRolls) {
        if (!damageRoll?.options) continue;
        let midiOptions = damageRoll.options['midi-qol'] ??= {};
        midiOptions.rollContext ??= {type: 'damage', itemName: workflow.item?.name ?? null};
    }
    await MidiQOL.displayDSNForRoll(damageRolls, 'damageRoll', undefined, speakerFromWorkflow(workflow, {useTokenNames}));
}
export let diceSoNice = {
    preItemRoll,
    damageRollComplete
};