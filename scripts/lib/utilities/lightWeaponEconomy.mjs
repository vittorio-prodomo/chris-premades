/*
 * T163 — pure decision core for the Light-property attack economy and Nick mastery.
 *
 * RAW 2024, Light property: "you can make one extra attack with a different Light weapon as a
 * Bonus Action later on the same turn"; Nick (weapon mastery): "When you make the extra attack of
 * the Light property, you can make it as part of the Attack action instead of as a Bonus Action.
 * You can make this extra attack only once per turn."
 *
 * The declared attack MODE is the trust boundary: an 'offhand' attack IS the Light extra (staying
 * permissive about ordering, per the standing T80 posture); what the mastery changes is only what
 * that extra costs. The actor's mastery list is what activates a weapon's mastery label — a
 * scimitar 'carries' nick, but only a scimitar-master gets the fold (Warpey masters
 * longbow+shortsword, so his scimitar offhand is a plain bonus-action extra).
 */
export function classifyOffhandAttack({attackMode, weaponMastery, actorMasters, nickUsedThisTurn}) {
    if (attackMode !== 'offhand') return {kind: 'none'};
    if (weaponMastery === 'nick' && actorMasters && !nickUsedThisTurn) return {kind: 'nick-extra'};
    return {kind: 'bonus-extra'};
}

// Layer 2: midi's fast-forward makes the default mode the OUTCOME, so default to offhand exactly
// when the Light-extra setup exists: a different Light weapon already attacked this turn and the
// extra has not been taken yet. dnd5e's own native offhand rule (no ability mod unless negative)
// then applies itself, which is the other half of the original T163 report.
export function shouldDefaultOffhand({isLightWeapon, hasOffhandMode, lightMainThisTurn, sameItem, extraUsedThisTurn}) {
    return Boolean(isLightWeapon && hasOffhandMode && lightMainThisTurn && !sameItem && !extraUsedThisTurn);
}
