/**
 * Build the ActiveEffect data for Arcane Ward. (T109)
 *
 * The ward lives as a single self-authored effect on the ACTOR, not transferred from the
 * feature item — so dnd5e's `ActiveEffect5e#getSource()` cannot reach the feature through
 * its `parent`, and falls through to `fromUuid(this.origin)`. Without an origin the sheet's
 * Source column renders empty, unlike every item-transferred effect (Lucky and friends).
 * Setting `origin` to the granting feature restores both the name and the hover tooltip,
 * because the sheet gates the tooltip on the resolved source being an Item.
 *
 * ⚠️ Note this deliberately reclassifies the effect for a DDB re-import: ddb-importer sorts
 * backed-up effects by whether their origin points at an item, so with an origin the ward is
 * cleared like any item effect. Accepted 2026-08-02 (Vittorio) — his "Retain Active Effects"
 * is off, under which the ward was already being wiped every re-import, and it self-heals on
 * the next abjuration cast.
 *
 * Pure (no Foundry globals) so it is node-testable; localisation happens at the call site.
 *
 * @param {object} params
 * @param {string} params.name          Display name, which carries the current HP.
 * @param {string} params.description   VAE tooltip body.
 * @param {string} params.img           The feature's image.
 * @param {string} [params.originUuid]  UUID of the granting feature; omitted if unknown.
 * @param {number} params.hp            Current ward HP.
 * @param {number} params.max           Maximum ward HP.
 * @returns {object} Effect data ready for effectUtils.createEffect.
 */
export function buildArcaneWardEffectData({name, description, img, originUuid, hp, max}) {
    const data = {
        name,
        description,
        img,
        flags: {'chris-premades': {arcaneWard: {hp, max}}}
    };
    if (originUuid) data.origin = originUuid;
    return data;
}
