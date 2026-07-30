/**
 * Ambush, the initiative half (T81 carry-forward, 2026-07-30).
 *
 * 2024 RAW: *"When you make a Dexterity (Stealth) check or an Initiative roll, you can expend one
 * Superiority Die and add the die to the roll, unless you have the Incapacitated condition."*
 *
 * The Stealth half ships declaratively as `flags.midi-qol.optional.Ambush.skill.ste`. The initiative
 * half cannot: midi's `optional` vocabulary covers skill / check / save / attack / damage and has no
 * initiative category — and adding one upstream would not have worked either, because the real wall
 * is in CORE. Every initiative path (sheet dialog, tracker button, "Roll All", `Actor5e#rollInitiative`)
 * converges on `Combat#rollInitiative`, which does:
 *
 *     const roll = combatant.getInitiativeRoll(formula);
 *     await roll.evaluate();
 *     updates.push({_id: id, initiative: roll.total});
 *
 * It **discards `evaluate()`'s return value** and reads `.total` off the original object. So the
 * whole "return a modified roll" convention that CPR's bonus channels rest on — and `MidiQOL.addRollTo`,
 * which builds a NEW roll via `fromTerms` — is silently dropped for initiative. The die therefore has
 * to be added to the recorded number after it lands, not folded into the roll.
 *
 * ⚠️ **Timing is a deliberate rules call, not an implementation accident** (Vittorio, 2026-07-30).
 * The offer is raised *after* his own d20 is known but *before* the rest of the field is revealed.
 * 2024 is silent on whether a Battle Master may wait and see — but it rewrote every ability meant to
 * react to a result so that the trigger IS the result (Bardic Inspiration: "when the creature *fails*
 * a D20 Test"; Precision Attack, this maneuver's own sibling: "when you *miss*"), and Ambush says
 * "when you *make*". Against that, an Initiative roll has no success or failure for a strict reading
 * to hang on, and your own number tells you nothing until others roll. Offering post-roll but
 * pre-reveal is permissive on the genuinely ambiguous axis while withholding the field information
 * the text never contemplated. The pre-reveal half is enforced by holding the CCT carousel — see
 * `extensions/ambushInitiative.js`.
 *
 * Pure logic (plain data in, plain data out) so it is node-testable without Foundry.
 */

/** Default seconds before an unanswered offer declines itself. Vittorio's call, 2026-07-30. */
export const DEFAULT_OFFER_TIMEOUT_SECONDS = 30;
const MIN_OFFER_TIMEOUT_SECONDS = 5;
const MAX_OFFER_TIMEOUT_SECONDS = 300;

/**
 * Should this initiative landing raise the offer at all?
 *
 * ⚠️ Fails CLOSED on anything malformed. An offer that cannot be honoured is worse than no offer:
 * the §T66 lesson is that a prompt which spends a resource and changes nothing reads as a lie.
 *
 * @param {object} p
 * @param {boolean} p.hasAmbush                  does the actor carry the Ambush maneuver item?
 * @param {boolean} p.isIncapacitated            RAW gate — "unless you have the Incapacitated condition"
 * @param {number} p.superiorityDiceRemaining    uses left across every pool that can pay for it
 * @param {number} p.initiative                  the value that just landed on the combatant
 * @param {boolean} p.alreadyOffered             one-shot guard for this combat+combatant
 * @returns {boolean}
 */
export function isEligibleForAmbushOffer({
    hasAmbush,
    isIncapacitated,
    superiorityDiceRemaining,
    initiative,
    alreadyOffered
} = {}) {
    if (!hasAmbush) return false;
    if (alreadyOffered) return false;
    if (isIncapacitated) return false;
    if (!Number.isFinite(superiorityDiceRemaining) || superiorityDiceRemaining <= 0) return false;
    // A cleared initiative (null) or a non-numeric one is not a roll landing.
    if (!Number.isFinite(initiative)) return false;
    return true;
}

/**
 * Which single user should raise the prompt.
 *
 * Every client sees the `updateCombatant` hook, so exactly one must act or the table gets N copies
 * of the same dialog. Same deterministic policy as [[dnd5e-alert-initiative-swap]]: the active
 * non-GM owner with the lowest id, else the active GM.
 *
 * ⚠️ The chosen client is also the one that will WRITE the result, and that is fine unprivileged:
 * core's `Combatant.#canUpdate` allowlists `initiative` for a user who owns the combatant, so a
 * player adds their own die without any GM round-trip.
 *
 * @param {{id: string, isGM: boolean, active: boolean, isOwner: boolean}[]} users
 * @param {object} [options]
 * @param {string} [options.activeGMId]
 * @returns {string|null} the user id that should prompt
 */
export function selectAmbushPrompter(users, {activeGMId} = {}) {
    const owners = (Array.isArray(users) ? users : [])
        .filter(user => user?.active && !user.isGM && user.isOwner && typeof user.id === 'string')
        .map(user => user.id)
        .sort((a, b) => a.localeCompare(b));
    return owners[0] ?? activeGMId ?? null;
}

/**
 * The combatant's initiative after the die lands.
 *
 * ⚠️ Plain addition on purpose: with `initiativeDexTiebreaker` on, dnd5e parks the tiebreaker in the
 * DECIMALS (ability score / 100), so 14.16 + 5 must stay 19.16. Rounding or re-flooring here would
 * quietly discard the tiebreak and create ties the system had already resolved.
 *
 * @returns {number|null} null when either input is unusable, so the caller writes nothing
 */
export function applyAmbushDie(initiative, dieTotal) {
    if (!Number.isFinite(initiative)) return null;
    if (!Number.isFinite(dieTotal) || dieTotal <= 0) return null;
    return initiative + dieTotal;
}

/**
 * `"d8"` → `"1d8"`, rejecting anything that is not a plain die so a malformed scale value cannot
 * reach `new Roll()`. Same shape guard as the pending-die tracker's.
 * @returns {string|null}
 */
export function superiorityDieFormula(die) {
    if (typeof die !== 'string' || !/^d\d+$/.test(die)) return null;
    return `1${die}`;
}

/** Clamp the configured auto-decline timer; anything unusable falls back to the default. */
export function normaliseOfferTimeout(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return DEFAULT_OFFER_TIMEOUT_SECONDS;
    return Math.min(MAX_OFFER_TIMEOUT_SECONDS, Math.max(MIN_OFFER_TIMEOUT_SECONDS, Math.round(value)));
}
