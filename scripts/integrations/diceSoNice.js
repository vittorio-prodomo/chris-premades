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
    await MidiQOL.displayDSNForRoll(damageRolls, 'damageRoll', undefined, speakerFromWorkflow(workflow, {useTokenNames}));
}
export let diceSoNice = {
    preItemRoll,
    damageRollComplete
};