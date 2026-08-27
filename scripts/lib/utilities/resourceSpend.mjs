/**
 * How many uses of a limited resource remain after a spend.
 *
 * Returns null when the resource has no declared maximum — the caller then says the
 * feature was used without claiming a count it cannot know.
 *
 * @param {{spent?: number, max?: number}|null|undefined} uses
 * @returns {number|null}
 */
export function remainingUses(uses) {
    if (!Number.isFinite(uses?.max) || !Number.isFinite(uses?.spent)) return null;
    return Math.max(0, uses.max - uses.spent);
}
