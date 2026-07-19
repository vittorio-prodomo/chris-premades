/**
 * Rebuild a roll's formula, appending a die modifier (`r1`, `min3`, …) plus a
 * source flavor to each non-deterministic term, so the expanded roll can show
 * WHY a die was rerolled/floored. Preserves any existing term flavor (a fire
 * die rerolled by Elemental Adept reads `fire · Elemental Adept`). Idempotent:
 * a term already carrying the modifier is left untouched.
 *
 * Pure string logic (operates on term-shaped objects) so it is node-testable
 * without Foundry.
 *
 * @param {Array<{isDeterministic:boolean, expression:string, formula:string, flavor?:string}>} terms
 * @param {string} modifier  e.g. "r1", "min3"
 * @param {string} source    feature/feat name, e.g. "Healer"
 * @returns {string} the new formula
 */
export function buildModifierFormula(terms, modifier, source) {
    let formula = '';
    for (const term of terms) {
        if (term.isDeterministic) {
            formula += term.expression;
        } else if (term.expression.toLowerCase().includes(modifier.toLowerCase())) {
            formula += term.formula; // already modified — keep, never double-apply
        } else {
            const flavor = term.flavor ? `${term.flavor} · ${source}` : source;
            formula += `${term.expression}${modifier}[${flavor}]`;
        }
    }
    return formula;
}
