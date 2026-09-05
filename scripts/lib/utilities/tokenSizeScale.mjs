// T219 — the token size-sync math, pure so it can be unit-tested.
//
// dnd5e's TokenDocument5e.prepareData() DERIVES a dynamic-ring token's displayed scale as
// `source.texture.scaleX * CONFIG.DND5E.actorSizes[size].dynamicTokenScale` (sm 0.8, tiny 0.5 —
// the same table as SIZE_SCALES below), where `size` is the BASE actor's size for a linked token
// and the delta's own SOURCE size for an unlinked one — so an effect-driven size change reaches the
// derivation only on a LINKED ring token. Two consequences, both fixed here:
//  1. Upstream read the token's DERIVED scale as "current" and wrote a relative result back into the
//     source, so on a ring token the ×dts factor was applied twice and compounded on every
//     apply/remove cycle (a reduce sm→tiny then restore left a goblin 0.8→0.4→0.512, never 0.8).
//     The ratio must be taken from the SOURCE scale; for a plain token source == derived anyway.
//  2. On a linked ring token the size→scale step is already the system's job, so we write no
//     texture scale at all — only the footprint.

export const SIZE_SQUARES = {
    grg: 4,
    huge: 3,
    lg: 2,
    med: 1,
    sm: 1,
    tiny: 1
};
export const SIZE_SCALES = {
    grg: 1,
    huge: 1,
    lg: 1,
    med: 1,
    sm: 0.8,
    tiny: 0.5
};
/**
 * @param {object} args
 * @param {string} args.size               the actor's NEW size key
 * @param {string} args.old                the actor's size key before the change
 * @param {number} args.sourceScaleX       the token's SOURCE texture.scaleX (`_source`, never the prepared value)
 * @param {boolean} args.systemDerivesScale true when dnd5e derives the displayed scale from the actor's
 *                                          size itself: a dynamic-ring token that is LINKED to its actor
 * @returns {{sizeDiff: number, update: object} | null} null when nothing needs to change
 */
export function resolveTokenSizeUpdate({size, old, sourceScaleX, systemDerivesScale}) {
    if (!(size in SIZE_SQUARES) || !(old in SIZE_SQUARES)) return null;
    const sizeDiff = SIZE_SQUARES[size] - SIZE_SQUARES[old];
    const scaleDiff = SIZE_SCALES[size] - SIZE_SCALES[old];
    if (!sizeDiff && !scaleDiff) return null;
    const update = {
        width: SIZE_SQUARES[size],
        height: SIZE_SQUARES[size]
    };
    if (!systemDerivesScale && scaleDiff && Number.isFinite(sourceScaleX)) {
        const scaleRatio = sourceScaleX / SIZE_SCALES[old];
        const newScale = SIZE_SCALES[size] * scaleRatio;
        update.texture = {scaleX: newScale, scaleY: newScale};
    }
    return {sizeDiff, update};
}
/**
 * Whether dnd5e itself derives this token document's displayed scale from the actor's size.
 * @param {TokenDocument|PrototypeToken} tokenDoc
 */
export function systemDerivesTokenScale(tokenDoc) {
    return !!(tokenDoc?.ring?.enabled && tokenDoc?.actorLink);
}
