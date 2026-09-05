/**
 * T223 — the 2024 long-jump rules as pure arithmetic, so the Jump action macro only
 * has to read the world and act.
 *
 *   Long jump: STR score in feet after a 10-ft run-up, half that standing. Every foot
 *   jumped costs a foot of movement. The Jump spell lets the creature jump up to 30 ft
 *   for 10 ft of movement, once on each of its turns.
 *
 * Nothing here touches Foundry: waypoints are plain objects, measuring is injected.
 */

export const JUMP_SPELL_DISTANCE = 30;
export const JUMP_SPELL_COST = 10;
export const RUN_UP_FEET = 10;

const EPSILON = 1e-6;

function onStraightLineInto(point, from, final) {
    let runX = final.x - point.x, runY = final.y - point.y;
    let stepX = final.x - from.x, stepY = final.y - from.y;
    if (Math.abs(runX) < EPSILON && Math.abs(runY) < EPSILON) return true;
    let cross = runX * stepY - runY * stepX;
    let dot = runX * stepX + runY * stepY;
    let scale = Math.hypot(runX, runY) * Math.hypot(stepX, stepY);
    if (scale < EPSILON) return true;
    return Math.abs(cross) / scale < EPSILON * 1000 && dot >= 0;
}

/**
 * The trailing slice of a movement history that is ONE straight on-foot run into the
 * final position. Foundry records every nudge as its own `movementId` group, so whole
 * groups are chained backwards while every waypoint stays collinear and same-direction
 * (the shape dnd5e-primal-companion's charge rider uses). Only `walk` waypoints count:
 * a jump, a fly or a teleport is not a run-up.
 * @param {Array<{x:number,y:number,movementId?:string,action?:string}>} history
 * @returns {Array} the slice in original order (empty when there is no run)
 */
export function trailingStraightRun(history) {
    if (!Array.isArray(history) || history.length < 2) return [];
    let final = history[history.length - 1];
    let kept = [final];
    for (let i = history.length - 2; i >= 0; i--) {
        // A waypoint's `action` describes the leg INTO it, so the leg from history[i]
        // is history[i + 1]'s action; movementId boundaries are irrelevant here.
        let leg = history[i + 1].action;
        if (leg && leg !== 'walk') break;
        if (!onStraightLineInto(history[i], kept[0], final)) break;
        kept.unshift(history[i]);
    }
    return kept.length >= 2 ? kept : [];
}

/**
 * Feet of straight run-up immediately before the jump.
 * @param {Array} history  the token's movement history this turn
 * @param {(points: Array<{x:number,y:number}>) => number} measureFeet
 */
export function runUpFeet(history, measureFeet) {
    let run = trailingStraightRun(history);
    if (!run.length) return 0;
    return measureFeet(run);
}

/**
 * The plan for one long jump.
 * @param {object} p
 * @param {number} p.rolled        the rolled running long-jump distance (STR score, with riders)
 * @param {number} p.runUp         feet of straight run-up this turn
 * @param {number} p.speed         walking speed in feet
 * @param {number} p.used          movement already spent this turn, in feet
 * @param {boolean} p.inCombat     budget applies only on the jumper's own started-combat turn
 * @param {boolean} p.spellActive  the Jump spell is on the jumper
 * @param {boolean} p.spellAvailable  its once-per-turn jump is still unspent
 * @param {number} [p.gridStep=5]  the reach is rounded UP to this many feet
 */
export function planLongJump({rolled, runUp, speed, used, inCombat, spellActive = false, spellAvailable = true, gridStep = 5}) {
    let running = runUp >= RUN_UP_FEET;
    // Rounded UP to the grid step (his call, 2026-09-06): the table places whole squares,
    // so a 17-ft reach is a 20-ft reach rather than a 15-ft one.
    let step = gridStep > 0 ? gridStep : 1;
    let natural = Math.ceil(Math.max(0, running ? rolled : rolled / 2) / step) * step;
    let spell = !!spellActive && !!spellAvailable;
    let distance = spell ? Math.max(natural, JUMP_SPELL_DISTANCE) : natural;
    let remaining = inCombat ? Math.max(0, (speed ?? 0) - (used ?? 0)) : null;
    let costOf = feet => {
        if (spell && feet <= JUMP_SPELL_DISTANCE) return Math.min(JUMP_SPELL_COST, feet);
        return feet;
    };
    let cap = distance;
    if (remaining !== null) {
        cap = 0;
        for (let feet = distance; feet >= 0; feet--) {
            if (costOf(feet) <= remaining) {
                cap = feet;
                break;
            }
        }
    }
    return {running, natural, distance, remaining, cap, spell, costOf};
}

/**
 * What one chosen jump costs against the plan.
 * @returns {{feet:number, cost:number, legal:boolean, spellUsed:boolean, remainingAfter:number|null}}
 */
export function jumpVerdict(feet, plan) {
    let cost = plan.costOf(feet);
    let legal = plan.remaining === null || cost <= plan.remaining;
    let spellUsed = plan.spell && feet <= JUMP_SPELL_DISTANCE && cost < feet;
    let remainingAfter = plan.remaining === null ? null : Math.max(0, plan.remaining - cost);
    return {feet, cost, legal, spellUsed, remainingAfter};
}
