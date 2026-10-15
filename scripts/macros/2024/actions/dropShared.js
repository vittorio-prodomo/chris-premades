/*
 * T249 — plumbing shared by Landing on a Creature and Plunging Attack: the target, the drop
 * height, the landing square next to the target (Jump's long-jump reach and budget), the
 * fall dice, and the card stamp (moved here from jump.js).
 */
import {combatUtils, crosshairUtils, dialogUtils, genericUtils, rollUtils} from '../../../utils.js';
import {RUN_UP_FEET, jumpVerdict, planLongJump} from '../../../lib/utilities/jumpRules.mjs';
import {dropHeight, fallDiceCount, isAdjacent} from '../../../lib/utilities/dropRules.mjs';

export async function pickSingleTarget(token, label) {
    // Exactly one creature already targeted, and not the faller itself: use it. Anything else asks.
    if (game.user.targets.size === 1 && game.user.targets.first() !== token) return game.user.targets.first();
    let argon = game.modules.get('enhancedcombathud')?.active ? game.modules.get('enhancedcombathud').api : undefined;
    if (typeof argon?.runTargetPicker !== 'function') {
        genericUtils.notify('CHRISPREMADES.Macros.DropAttack.TargetFirst', 'warn');
        return null;
    }
    let picked = await argon.runTargetPicker({token, targets: 1, label: genericUtils.translate(label)});
    if (!picked) return null;
    let target = game.user.targets.first();
    return target && target !== token ? target : null;
}
export async function askDropHeight(title, actorName) {
    let feet = await dialogUtils.numberDialog(title, genericUtils.format('CHRISPREMADES.Macros.DropAttack.NoElevation', {name: actorName}), {label: 'CHRISPREMADES.Macros.DropAttack.HeightLabel', name: 'height', options: {currentValue: 20}});
    feet = Number(feet);
    return Number.isFinite(feet) && feet > 0 ? feet : null;
}
export async function resolveDropHeight(token, target, title) {
    return dropHeight(token.document.elevation, target.document.elevation) ?? await askDropHeight(title, token.actor.name);
}
function gridRect(doc) {
    let size = canvas.grid.size;
    return {x: Math.round(doc.x / size), y: Math.round(doc.y / size), w: doc.width, h: doc.height};
}
export async function chooseLandingSquare({token, target, item}) {
    let actor = token.actor;
    let inCombat = combatUtils.combatStarted() && combatUtils.isOwnTurn(token);
    let spent = inCombat ? token.document.movementHistory.reduce((t, w) => t + (Number.isFinite(w.cost) ? w.cost : 0), 0) : 0;
    let plan = planLongJump({rolled: actor.system.abilities.str.value, runUp: RUN_UP_FEET, speed: actor.system.attributes.movement?.walk ?? 0, used: spent, inCombat, gridStep: canvas.grid.distance});
    let snap = center => token.getSnappedPosition({x: center.x - token.w / 2, y: center.y - token.h / 2});
    let targetRect = gridRect(target.document);
    let adjacent = center => {
        let d = snap(center);
        return isAdjacent({...gridRect({x: d.x, y: d.y, width: token.document.width, height: token.document.height})}, targetRect);
    };
    let landable = center => {
        let d = snap(center);
        let [, constrained] = token.constrainMovementPath([{x: token.document.x, y: token.document.y, action: 'jump'}, {x: d.x, y: d.y, action: 'jump'}], {});
        return !constrained;
    };
    let position = await crosshairUtils.aimCrosshair({
        token, maxRange: plan.distance, boundaryRange: plan.cap, centerpoint: token.center, drawBoundries: true, trackDistance: true,
        validityFunctions: [adjacent, landable],
        fudgeDistance: token.document.width * canvas.dimensions.distance / 2,
        crosshairsConfig: {size: token.document.parent.grid.distance * token.document.width / 2, icon: token.document.texture.src, resolution: (token.document.width % 2) ? 1 : -1}
    });
    if (!position || position.cancelled) return null;
    if (position.valid === false) {
        genericUtils.notify('CHRISPREMADES.Macros.DropAttack.NotAdjacent', 'warn');
        return null;
    }
    let destination = snap(position);
    let feet = Math.round(token.document.measureMovementPath([{x: token.document.x, y: token.document.y}, {x: destination.x, y: destination.y}]).distance);
    if (feet > plan.distance) {
        genericUtils.notify('CHRISPREMADES.Macros.Jump.LongJump.OutOfReach', 'warn');
        return null;
    }
    let verdict = jumpVerdict(feet, plan);
    if (!verdict.legal) {
        let proceed = await dialogUtils.confirm(item.name, genericUtils.format('CHRISPREMADES.Macros.Jump.LongJump.OverBudgetPrompt', {cost: verdict.cost, remaining: plan.remaining}));
        if (!proceed) return null;
    }
    return {destination: {...destination, elevation: target.document.elevation}, position, feet, verdict, plan};
}
export async function rollFallDice(height, actor) {
    let count = fallDiceCount(height);
    if (!count) return {roll: null, total: 0};
    // ⚠️ With chatMessage, rollDice returns {message, roll} — not the roll (read 2026-10-15 after a live
    // run where every fall total came back undefined).
    let {roll} = await rollUtils.rollDice(count + 'd6', {entity: actor, chatMessage: true, flavor: genericUtils.translate('CHRISPREMADES.Macros.DropAttack.FallDice')});
    return {roll, total: roll.total};
}
export async function stampCard(workflow, lines) {
    let message = await fromUuid(workflow.itemCardUuid);
    if (!message) return;
    let content = message.content + '<div class="chris-premades-jump-verdict" style="margin-top:4px;border-top:1px solid var(--color-border-light-2, #999);padding-top:4px;font-size:var(--font-size-12, 12px);">' + lines.map(line => '<div>' + line + '</div>').join('') + '</div>';
    await genericUtils.update(message, {content});
}
