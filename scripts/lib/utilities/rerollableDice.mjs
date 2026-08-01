/**
 * Does this set of evaluated rolls contain a die a reroll feature could act on? (T97)
 *
 * Sibling of T66's `rollUtils.hasRerollableDamage`, one step closer to the roll: T66 asks the
 * ACTIVITY whether its damage parts declare any dice (right for Savage Attacker, which rerolls
 * `workflow.damageRolls[i]` only for i < `activity.damage.parts.length`). This asks the
 * EVALUATED rolls, which is the right question for Heroic Inspiration and Piercer — both
 * substitute a single die anywhere in `workflow.damageRolls`, including dice that no damage
 * part declares, because `workflowUtils.bonusDamage` APPENDS a roll past `damage.parts.length`
 * (the T93 delivery). Gating those two on the activity would silently kill a legitimate offer
 * on a flat-damage attack carrying an appended superiority die.
 *
 * A 2024 Unarmed Strike deals a flat `1 + @mod` — no dice at all — so an offer raised on it
 * can only spend a resource for exactly zero benefit. Worse for Heroic Inspiration: accepting
 * the empty dialog used to throw, because `dialogUtils.selectDie` returns an empty ARRAY (which
 * is truthy) and the caller then reads `selection[0].split(...)`.
 *
 * Mirrors `selectDie`'s own enumeration exactly — a term is selectable when it is not
 * deterministic AND actually rolled at least one result — so "the predicate says yes" and "the
 * checkbox list is non-empty" can never disagree.
 *
 * Fails OPEN: a shape this cannot read (a non-array `rolls`, or a bare roll object) keeps the
 * existing offer, because silently deleting a feature is the worse failure. An explicitly
 * empty / absent roll list is not an odd shape — there is simply nothing to select.
 *
 * Pure logic (reads plain roll shapes) so it is node-testable without Foundry.
 *
 * @param {Array<{terms?: Array<{isDeterministic?: boolean, results?: Array}>}>} rolls evaluated damage rolls
 * @returns {boolean} true when at least one term offers a die to substitute
 */
export function hasSelectableDie(rolls) {
    if (rolls === null || rolls === undefined) return false;
    if (!Array.isArray(rolls)) return true;
    return rolls.some(roll => {
        if (!Array.isArray(roll?.terms)) return false;
        return roll.terms.some(term => !term?.isDeterministic && term?.results?.length > 0);
    });
}
