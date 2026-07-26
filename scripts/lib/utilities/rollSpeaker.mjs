/**
 * ChatSpeakerData naming the creature a workflow's rolls belong to.
 *
 * T74: CPR switches midi's own damage-roll DSN display OFF (`damageRollDSN = false`,
 * integrations/diceSoNice.js) and re-shows the dice itself once rerolls have settled,
 * so those dice never receive the speaker midi passes at its own display sites. Dice
 * label modules read that speaker off `roll.options['midi-qol'].speaker`, so without
 * it an NPC's damage die is identity-less and reads "GM" while its attack die — shown
 * by midi — correctly names the creature.
 *
 * Pure by design (no Foundry globals) so `node --test` covers it: the caller hands in
 * the workflow and midi's `useTokenNames` setting, and gets back the same shape midi's
 * own `getSpeaker()` produces — token name preferred, actor name when that setting is
 * off or the token is nameless.
 * @param {{token?: any, actor?: any}|null|undefined} workflow
 * @param {{useTokenNames?: boolean}} [options]
 * @returns {{scene: string|null, token: string|null, actor: string|null, alias: string|null}|undefined}
 */
export function speakerFromWorkflow(workflow, {useTokenNames = true} = {}) {
    let tokenDocument = workflow?.token?.document ?? workflow?.token ?? null;
    let actor = workflow?.actor ?? tokenDocument?.actor ?? null;
    if (!tokenDocument && !actor) return undefined;
    let alias = (useTokenNames ? tokenDocument?.name : undefined) ?? actor?.name ?? tokenDocument?.name ?? null;
    return {
        scene: tokenDocument?.parent?.id ?? null,
        token: tokenDocument?.id ?? null,
        actor: actor?.id ?? null,
        alias
    };
}
