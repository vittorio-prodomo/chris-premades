/**
 * Whole seconds left before a timed dialog auto-declines.
 *
 * Rounds UP so the countdown starts at the full timeout rather than one below it,
 * and clamps at zero so a late tick never renders a negative.
 *
 * @param {number} deadlineMs
 * @param {number} nowMs
 * @returns {number}
 */
export function secondsRemaining(deadlineMs, nowMs) {
    return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
