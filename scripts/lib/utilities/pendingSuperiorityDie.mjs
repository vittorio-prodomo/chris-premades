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
 * @param {object} attack                     the attack that just resolved
 * @param {string} [attack.actionType]        midi's action type, e.g. "mwak" / "rwak"
 * @param {string[]} [attack.hitTargetIds]    token ids this attack HIT (not merely targeted)
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

    // Feinting Attack reserves its die for the creature you feinted against; hitting someone else
    // this turn does not consume it. A pending die with no targetId is unrestricted.
    if (pending.targetId && !hitTargetIds.includes(pending.targetId)) return false;

    return true;
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
