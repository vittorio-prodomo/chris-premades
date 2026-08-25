/*
 * T153 — turn-order comparator lift for Primal Companion beasts.
 *
 * A numeric initiative offset (hunter − 0.01) can never guarantee "immediately after the hunter":
 * with two hunters tied, equality leaves no room between them. Instead the beast MIRRORS its
 * hunter's initiative and the combat sort comparator is lifted so a beast inherits its hunter's
 * whole sort identity, losing ties only to the hunter itself.
 *
 * Pure and Foundry-free: the caller supplies the base comparator and an anchor resolver
 * (combatant -> {anchor, isBeast}), so this stays node-testable.
 *
 * Effectively each combatant sorts by the lexicographic key
 *   [base rank of anchor, anchor id, isBeast, base rank within the anchor's block]
 * which is transitive — safe for Array#sort.
 */
export function liftPrimalSort(baseCompare, resolveAnchor) {
    return (a, b) => {
        let ra = resolveAnchor(a);
        let rb = resolveAnchor(b);
        if (ra.anchor === rb.anchor) {
            if (ra.isBeast !== rb.isBeast) return ra.isBeast ? 1 : -1;
            return baseCompare(a, b);
        }
        let cmp = baseCompare(ra.anchor, rb.anchor);
        if (cmp) return cmp;
        // Base tie between DIFFERENT anchors: fall back to anchor id so each anchor's block stays
        // contiguous — sort stability would otherwise interleave a beast away from its hunter.
        return (ra.anchor?.id ?? '') > (rb.anchor?.id ?? '') ? 1 : -1;
    };
}
