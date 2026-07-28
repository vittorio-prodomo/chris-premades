/**
 * Would a reroll offered on this saving throw be able to change anything? (T86)
 *
 * A concentration save is pass/fail against a DC the roller already knows (10, or half
 * the damage just taken) and nothing downstream reads its margin — so once it has
 * succeeded, rerolling a die can only spend a resource for exactly zero benefit. Offering
 * Heroic Inspiration there is the same class of noise as T66's flat-damage offer.
 *
 * Deliberately narrow: it recognises ONLY concentration saves. An ordinary save keeps its
 * offer on a success, because its DC is not always known to the roller and suppressing on
 * success would leak the outcome (the anti-RAW shape rejected in T2).
 *
 * Fails OPEN — no target number, no `isSuccess`, or an unrecognised config keeps the
 * existing offer rather than silently removing a feature.
 *
 * Pure logic (reads plain roll/config shapes) so it is node-testable without Foundry.
 *
 * @param {{hookNames?: string[]}} config dnd5e roll process config; dnd5e's rollConcentration
 *                                        appends "concentration" to hookNames
 * @param {{options?: {target?: number}, isSuccess?: boolean}} roll the evaluated d20 roll
 * @returns {boolean} true when the roll is a concentration save that already succeeded
 */
export function isSettledConcentrationSave(config, roll) {
    if (!Array.isArray(config?.hookNames) || !config.hookNames.includes('concentration')) return false;
    if (typeof roll?.options?.target !== 'number' || Number.isNaN(roll.options.target)) return false;
    return roll.isSuccess === true;
}
