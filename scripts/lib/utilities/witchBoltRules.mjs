/**
 * Pure decision logic for Witch Bolt (2024). No Foundry globals — everything arrives as plain data
 * so it can be unit tested. The macro does the document work; this decides what should happen.
 */

/** dnd5e's own Total Cover status. Half and Three-Quarters must NOT end the spell — RAW is total only. */
const COVER_TOTAL = 'coverTotal';
const DEAD = 'dead';

function asSet(statuses) {
    if (statuses instanceof Set) return statuses;
    return new Set(statuses ?? []);
}

/**
 * Why the spell should end right now, or null to continue.
 * Order is deliberate: a target that is gone cannot be measured or inspected.
 * @param {object} p
 * @param {number} p.distance        caster→target, in feet. -1 means "could not measure" and never ends the spell.
 * @param {number} p.maxRange        the spell's range in feet (config-tunable, default 60)
 * @param {Set<string>|string[]} p.targetStatuses
 * @param {boolean} p.targetPresent
 * @returns {null|'range'|'cover'|'dead'|'missing'}
 */
export function evaluateEndCondition({distance, maxRange, targetStatuses, targetPresent}) {
    if (!targetPresent) return 'missing';
    const statuses = asSet(targetStatuses);
    if (statuses.has(DEAD)) return 'dead';
    if (statuses.has(COVER_TOTAL)) return 'cover';
    if (typeof distance === 'number' && distance >= 0 && distance > maxRange) return 'range';
    return null;
}

/**
 * Whether to raise the turn-start Bonus Action offer.
 * Declining is not an end condition — RAW, skipping the bonus action does not end the spell.
 * @param {object} p
 * @param {boolean} p.effectPresent
 * @param {boolean} p.bonusActionUsed
 * @param {null|string} p.endReason
 * @returns {boolean}
 */
export function shouldOfferSustain({effectPresent, bonusActionUsed, endReason}) {
    if (!effectPresent) return false;
    if (bonusActionUsed) return false;
    if (endReason) return false;
    return true;
}
