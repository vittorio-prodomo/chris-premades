/**
 * T57 — how a template-driven push picks its direction.
 *
 * Stock behaviour is radial: every creature is shoved along the line from the caster to
 * itself, so a Thunderwave fans its victims outward. The 'parallel' mode instead shoves
 * every creature along the template's own direction (BG3's feel — the clump is translated,
 * not dispersed). Only DIRECTIONAL templates qualify: a cone or a ray, which is also what a
 * non-grid-aligned cube is stored as. A circle is a genuine burst and always stays radial —
 * an explosion that shoves everyone the same way looks wrong.
 *
 * Pure on purpose: no canvas, no settings lookup, no Foundry globals.
 */

/** The setting's choice list, in display order. */
export const PUSH_DIRECTION_MODES = ['radial', 'parallel'];

const DIRECTIONAL_TEMPLATE_TYPES = ['ray', 'cone'];

/** A template whose own `direction` is meaningful as a push vector. */
export function isDirectionalTemplate(template) {
    if (!template) return false;
    if (!DIRECTIONAL_TEMPLATE_TYPES.includes(template.t)) return false;
    return typeof template.direction === 'number' && Number.isFinite(template.direction);
}

/**
 * The angle (radians) every target of this cast should be pushed along, or `null` to keep
 * the stock caster-to-target ray.
 */
export function resolvePushAngle({mode, template} = {}) {
    if (mode !== 'parallel') return null;
    if (!isDirectionalTemplate(template)) return null;
    return template.direction * (Math.PI / 180);
}
