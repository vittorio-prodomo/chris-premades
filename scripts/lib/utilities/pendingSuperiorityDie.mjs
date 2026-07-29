/**
 * Should a superiority die that was banked earlier this turn be spent on the attack that just hit?
 * (T81 Batch B, slice 2 — the "next attack this turn" tracker.)
 *
 * Most maneuvers put their die on the attack you are resolving right now, which is why the driver
 * can simply offer them at `damageRollComplete`. Two 2024 maneuvers do not:
 *
 *   - **Feinting Attack** — a Bonus Action that spends the die immediately, then pays out on "your
 *     next attack roll against that target this turn, if that attack hits".
 *   - **Lunging Attack** — a Bonus Action + Dash, paying out on a later melee hit this turn.
 *
 * In both cases the die is already PAID FOR when this runs; the only question is whether this
 * particular attack is the one it lands on. That asymmetry drives the failure preference below.
 *
 * Pure logic (plain data in, boolean out) so it is node-testable without Foundry.
 *
 * @param {object} pending                    the banked die, from `flags.chris-premades.superiorityDie.pending`
 * @param {string} pending.die                the die to append, e.g. "d8"
 * @param {string} [pending.targetId]         token id this die is reserved for; omit for "any target"
 * @param {boolean} [pending.requiresMelee]   true when only a melee attack qualifies (Lunging Attack)
 * @param {boolean} [pending.requiresMovement] true when the attacker must have moved (Lunging Attack)
 * @param {object} attack                     the attack that just resolved
 * @param {string} [attack.actionType]        midi's action type, e.g. "mwak" / "rwak"
 * @param {string[]} [attack.hitTargetIds]    token ids this attack HIT (not merely targeted)
 * @param {boolean} [attack.movedThisTurn]    did the attacker move before this attack, this turn?
 * @returns {boolean} true when this attack should receive the banked die
 */
export function shouldConsumePendingDie(pending, attack) {
    // A malformed entry fails CLOSED. That costs the player a die they already spent, which is the
    // lesser evil: appending an unrecognised formula would corrupt the damage total instead, and a
    // die that silently fails to appear is at least visible to the person who expected it.
    if (!pending || typeof pending.die !== 'string' || !/^d\d+$/.test(pending.die)) return false;

    // "If that attack HITS" — a miss banks nothing and must not burn the reservation, because the
    // maneuver is still live for a later attack this turn.
    const hitTargetIds = Array.isArray(attack?.hitTargetIds) ? attack.hitTargetIds : [];
    if (!hitTargetIds.length) return false;

    // Lunging Attack is melee-only ("immediately before hitting with a melee attack").
    if (pending.requiresMelee && attack?.actionType !== 'mwak') return false;

    // Lunging Attack also wants "you move at least 5 feet in a straight line immediately before".
    // See `movedFarEnough` for why that whole clause reduces to "did you move at all this turn".
    if (pending.requiresMovement && attack?.movedThisTurn !== true) return false;

    // Feinting Attack reserves its die for the creature you feinted against; hitting someone else
    // this turn does not consume it. A pending die with no targetId is unrestricted.
    if (pending.targetId && !hitTargetIds.includes(pending.targetId)) return false;

    return true;
}

/**
 * Did the attacker move far enough this turn to satisfy Lunging Attack?
 *
 * ⚠️ **The RAW clause is five tests, and on a 5 ft square grid three of them are free** (Vittorio's
 * reading, 2026-07-29, and it is the more correct one):
 *
 *   - *"at least 5 feet"* — one grid space IS 5 ft, so any movement qualifies.
 *   - *"in a straight line"* — a single grid-to-grid step is a straight 5 ft segment **by
 *     construction**, diagonals included. The rule says "you move at least 5 feet in a straight line",
 *     NOT "all your movement is in a straight line", so the final leg alone always satisfies it. Only
 *     the latter reading would need path geometry.
 *   - *"on this turn"* — core clears each token's movement history at the start of its own turn
 *     (`client/documents/combat.mjs` → `_clearMovementHistoryOnStartTurn`), so the window is
 *     maintained for us and this function never has to scope it.
 *
 * *"Immediately before"* and *"as part of the Attack action"* are deliberately NOT enforced — they
 * need event ordering and action-container modelling Foundry does not reliably expose, and Vittorio
 * adjudicates them at the table.
 *
 * ⚠️ Reads `cost` rather than geometric distance, because that is what core records per waypoint.
 * Cost equals distance except through difficult terrain, where it is HIGHER — so this errs
 * permissive, never restrictive. On a 5 ft grid that is unreachable anyway (any step already clears
 * the threshold); it only matters on a gridless scene, where a sub-5 ft final leg is possible.
 *
 * @param {object[]} movementHistory  `token.document.movementHistory`
 * @param {number} minimumDistance    grid units that count as "moved", normally `canvas.grid.distance`
 * @returns {boolean}
 */
export function satisfiesMovementRequirement({historyRecorded, movementHistory, minimumDistance}) {
    // ⚠️ Core records movement history ONLY for a combatant in a STARTED combat
    // (`TokenDocument#_shouldRecordMovementHistory`: no combatant -> false; else
    // `combatant.parent.started`). Outside that, the history is permanently empty -- so testing it
    // would silently mean "Lunging Attack never pays out", spending the die for nothing.
    //
    // Waive the requirement instead. Out of combat there are no turns and no movement budget, so
    // "move 5 feet in a straight line ... on this turn" has nothing to bite on; refusing the die
    // would punish the player for a distinction the rules do not draw outside initiative. This is
    // the same permissive direction as not enforcing "immediately before".
    if (!historyRecorded) return true;
    return movedFarEnough(movementHistory, minimumDistance);
}

export function movedFarEnough(movementHistory, minimumDistance) {
    if (!Array.isArray(movementHistory)) return false;
    const total = movementHistory.reduce((sum, waypoint) => {
        const cost = Number(waypoint?.cost);
        // Core seeds `cost ??= Infinity` for waypoints it cannot price; those must not count as
        // movement, and must not poison the sum either.
        return sum + (Number.isFinite(cost) && cost > 0 ? cost : 0);
    }, 0);
    const threshold = Number.isFinite(minimumDistance) && minimumDistance > 0 ? minimumDistance : 0;
    return total > 0 && total >= threshold;
}

/**
 * Pick which banked die a resolved attack should consume, when more than one is live.
 *
 * You can hold two at once — feint one creature, then Lunge — and RAW caps maneuvers at one per
 * attack ("You can use only one maneuver per attack", 2024 Combat Superiority), so exactly one may
 * pay out. Preference goes to the most SPECIFIC reservation: a die reserved for this very target
 * beats an unrestricted one, because the unrestricted one can still be spent on a later attack
 * while the reserved one only pays out against that creature.
 *
 * @param {object[]} pendingEntries  banked dice, in creation order
 * @param {object} attack            see {@link shouldConsumePendingDie}
 * @returns {object|null} the entry to consume, or null when none qualifies
 */
export function selectPendingDie(pendingEntries, attack) {
    const eligible = (Array.isArray(pendingEntries) ? pendingEntries : [])
        .filter(entry => shouldConsumePendingDie(entry, attack));
    if (!eligible.length) return null;
    return eligible.find(entry => entry.targetId) ?? eligible[0];
}
