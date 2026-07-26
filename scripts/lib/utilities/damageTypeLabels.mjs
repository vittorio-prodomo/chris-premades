/**
 * Resolve legacy `DND5E.Damage<Type>` i18n keys (T72).
 *
 * CPR's damage-type picker dialogs pass literal keys like `DND5E.DamageBludgeoning` as button
 * labels. dnd5e does not define those keys — `game.i18n.has('DND5E.DamageBludgeoning')` is false —
 * so every such button renders the raw key to the player. Upstream since the 2024 content landed;
 * 83 occurrences across 18 macro files, all routed through `dialogUtils.buttonDialog`.
 *
 * The system already carries the localized name at `CONFIG.DND5E.damageTypes[<type>].label`, so we
 * resolve from there instead. Fixing it at the single dialog chokepoint rather than at all 83 call
 * sites keeps the diff against upstream small — this fork has to survive merges.
 *
 * Kept free of Foundry globals (lookups are injected) so it can be unit tested under node, matching
 * the `rerollNotes.mjs` precedent.
 */

const LEGACY_DAMAGE_KEY = /^DND5E\.Damage([A-Za-z]+)$/;

/**
 * Swap a legacy damage-type key for the system's localized label.
 *
 * Deliberately self-disabling: if the key resolves through i18n it is left untouched, so the day
 * dnd5e (or a translation module) defines these keys again, this quietly stops interfering.
 * Every unrecognised input passes through unchanged — a picker must never lose a button.
 *
 * @param {any} label button label as passed by the macro
 * @param {object} [lookups]
 * @param {(key: string) => boolean} [lookups.has] i18n key existence check (`game.i18n.has`)
 * @param {Record<string, {label?: string}>} [lookups.types] `CONFIG.DND5E.damageTypes`
 * @returns {any} the localized label, or the original input
 */
export function resolveDamageLabel(label, {has, types} = {}) {
    if (typeof label !== 'string') return label;
    if (typeof has === 'function' && has(label)) return label;
    const match = LEGACY_DAMAGE_KEY.exec(label);
    if (!match) return label;
    const resolved = types?.[match[1].toLowerCase()]?.label;
    return typeof resolved === 'string' && resolved.length ? resolved : label;
}
