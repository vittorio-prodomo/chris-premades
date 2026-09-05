import {DialogApp} from '../../../applications/dialog.js';
import {activityUtils, combatUtils, crosshairUtils, dialogUtils, effectUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';
import {RUN_UP_FEET, jumpVerdict, planLongJump, runUpFeet} from '../../../lib/utilities/jumpRules.mjs';
/*
 * ⚠️ FORK REWRITE (T223, 2026-09-05) of the long jump. Upstream rolled the distance, ran
 * the two checks, and TELEPORTED the token with Sequencer — no movement history, no
 * budget, no leash, no opportunity attack ever saw it. Now the flight is only the
 * picture: the token really moves with core's `jump` movement action, the plan reads
 * this turn's movement history (run-up + spent movement), the crosshair ring is the
 * movement budget while the reach stays the rolled distance, going past the ring asks
 * (never blocks), the verdict is stamped on the card, the Jump spell prices its
 * once-per-turn 30 ft at 10 ft, and the GM can set both check DCs on the fly.
 */
const SPELL_TURN_FLAG = 'jumpSpell';
async function early({trigger, workflow}) {
    let secondStoryWork = itemUtils.getItemByIdentifier(workflow.actor, 'secondStoryWork');
    let herculean = itemUtils.getItemByIdentifier(workflow.actor, 'herculean');
    let itemData = genericUtils.duplicate(workflow.item.toObject());
    if (secondStoryWork) {
        itemData.system.activities[workflow.activity.id].roll.formula = itemData.system.activities[workflow.activity.id].roll.formula.replaceAll('str', 'dex');
    }
    if (herculean) {
        itemData.system.activities[workflow.activity.id].roll.formula = '2 * ' + itemData.system.activities[workflow.activity.id].roll.formula;
    }
    if (workflow.actor.flags['chris-premades']?.stepOfTheWindJump) {
        itemData.system.activities[workflow.activity.id].roll.formula = '2 * ' + itemData.system.activities[workflow.activity.id].roll.formula;
    }
    workflow.item = await itemUtils.syntheticItem(itemData, workflow.actor);
    workflow.activity = workflow.item.system.activities.get(workflow.activity.id);
}
/** The Jump spell's effect on the actor — the official spell's effect carries no changes, so it is found by its origin item. */
function hasJumpSpell(actor) {
    return actor.appliedEffects.some(effect => {
        let itemId = effect.origin?.match(/Item\.([^.]+)/)?.[1];
        let item = itemId ? actor.items.get(itemId) : undefined;
        return item?.type === 'spell' && item.identifier === 'jump';
    });
}
function spentThisTurn(token) {
    return token.document.movementHistory.reduce((total, waypoint) => total + (Number.isFinite(waypoint.cost) ? waypoint.cost : 0), 0);
}
function buildPlan({token, actor, rolled}) {
    let inCombat = combatUtils.combatStarted() && combatUtils.isOwnTurn(token);
    // Core records movement history ONLY inside a started combat, so out of combat the
    // run-up is unknowable — and there is no budget to protect either, so the jump
    // counts as a running one rather than silently halving everybody's reach.
    let runUp = inCombat
        ? runUpFeet(token.document.movementHistory, points => token.document.measureMovementPath(points.map(p => ({x: p.x, y: p.y}))).distance)
        : RUN_UP_FEET;
    let spellActive = hasJumpSpell(actor);
    return planLongJump({
        rolled,
        runUp,
        speed: actor.system.attributes.movement?.walk ?? 0,
        used: inCombat ? spentThisTurn(token) : 0,
        inCombat,
        spellActive,
        spellAvailable: spellActive && combatUtils.perTurnCheck(actor, SPELL_TURN_FLAG, false),
        gridStep: canvas.grid.distance
    });
}
/** A check activity clone whose DC is the one chosen in the dialog. */
async function checkWithDC(workflow, identifier, dc) {
    let activity = activityUtils.getActivityByIdentifier(workflow.item, identifier);
    if (!activity) return;
    if (!Number.isFinite(dc) || dc === Number(activity.check?.dc?.formula)) return activity;
    let itemData = genericUtils.duplicate(workflow.item.toObject());
    genericUtils.setProperty(itemData, 'system.activities.' + activity.id + '.check.dc.formula', String(dc));
    let item = await itemUtils.syntheticItem(itemData, workflow.actor);
    return item.system.activities.get(activity.id);
}
/**
 * The real move: core's `jump` action, so movement history, dnd5e's ruler, the summon
 * leash and the opportunity-attack watchers all see it. Under the spell's discount the
 * jump segment is priced at {cost} instead of its distance, through the same seam
 * dnd5e prices difficult terrain with, so the recorded history stays the budget's truth.
 */
async function moveByJump(token, destination, {distance, cost, animate}) {
    // ⚠️ The seam is the PLACEABLE's `_getMovementCostFunction` (dnd5e overrides it there
    // for occupied squares); the document has no such method — proven live 09-05 when a
    // document-side override priced a 20-ft spell jump at 20.
    let discounted = cost < distance && distance > 0;
    let original = token._getMovementCostFunction;
    if (discounted) {
        let ratio = cost / distance;
        token._getMovementCostFunction = function(options) {
            let base = original.call(this, options);
            return (from, to, stepDistance, segment) => {
                let stepCost = base(from, to, stepDistance, segment);
                return segment?.action === 'jump' ? stepCost * ratio : stepCost;
            };
        };
    }
    try {
        return await token.document.move({x: destination.x, y: destination.y, action: 'jump'}, {method: 'api', showRuler: false, animate});
    } finally {
        if (discounted) delete token._getMovementCostFunction;
    }
}
async function stampCard(workflow, lines) {
    let message = await fromUuid(workflow.itemCardUuid);
    if (!message) return;
    let content = message.content + '<div class="chris-premades-jump-verdict" style="margin-top:4px;border-top:1px solid var(--color-border-light-2, #999);padding-top:4px;font-size:var(--font-size-12, 12px);">' + lines.map(line => '<div>' + line + '</div>').join('') + '</div>';
    await genericUtils.update(message, {content});
}
async function longJump({trigger, workflow}) {
    let defaultLowDC = Number(itemUtils.getConfig(workflow.item, 'lowObstacleDC')) || 10;
    let defaultTerrainDC = Number(itemUtils.getConfig(workflow.item, 'difficultTerrainDC')) || 10;
    let plan = buildPlan({token: workflow.token, actor: workflow.actor, rolled: workflow.utilityRolls[0].total});
    let planLines = [genericUtils.format('CHRISPREMADES.Macros.Jump.LongJump.' + (plan.running ? 'Running' : 'Standing'), {distance: plan.natural})];
    if (plan.spell) planLines.push(genericUtils.translate('CHRISPREMADES.Macros.Jump.LongJump.Spell'));
    if (plan.remaining !== null) planLines.push(genericUtils.format('CHRISPREMADES.Macros.Jump.LongJump.Budget', {remaining: plan.remaining}));
    let inputs = [
        [
            'checkbox',
            [
                {
                    label: 'CHRISPREMADES.Macros.Jump.LongJump.LowObstacle',
                    name: 'lowObstacle'
                },
                {
                    label: 'CHRISPREMADES.Macros.Jump.LongJump.DifficultTerrain',
                    name: 'difficultTerrain'
                }
            ],
            {
                displayAsRows: true
            }
        ]
    ];
    if (game.user.isGM) {
        inputs.push([
            'number',
            [
                {
                    label: 'CHRISPREMADES.Macros.Jump.LongJump.LowObstacleDC',
                    name: 'lowObstacleDC',
                    options: {currentValue: defaultLowDC}
                },
                {
                    label: 'CHRISPREMADES.Macros.Jump.LongJump.DifficultTerrainDC',
                    name: 'difficultTerrainDC',
                    options: {currentValue: defaultTerrainDC}
                }
            ],
            {
                displayAsRows: true
            }
        ]);
    }
    let selection = await DialogApp.dialog(workflow.item.name, planLines.map(line => '<p>' + line + '</p>').join(''), inputs, 'okCancel');
    if (!selection?.buttons) return;
    let lowDC = Number(selection.lowObstacleDC ?? defaultLowDC) || defaultLowDC;
    let terrainDC = Number(selection.difficultTerrainDC ?? defaultTerrainDC) || defaultTerrainDC;
    let playAnimation = itemUtils.getConfig(workflow.item, 'playAnimation');
    // The checks roll DURING the jump (his call, 2026-09-05): the low obstacle on take-off,
    // once the landing is chosen and the budget answered; the difficult terrain on landing.
    let rollCheck = async (identifier, dc) => {
        let activity = await checkWithDC(workflow, identifier, dc);
        if (!activity) return false;
        let result = await workflowUtils.syntheticActivityRoll(activity, [workflow.token]);
        return !!result?.failedSaves?.size;
    };
    let token = workflow.token;
    let snap = center => token.getSnappedPosition({x: center.x - token.w / 2, y: center.y - token.h / 2});
    // Core (and dnd5e's occupied-space rule) may refuse a landing spot the wall test
    // accepts: ask the same constraint the real move will apply, so the crosshair
    // already shows the spot as invalid instead of the token silently staying put.
    let landable = center => {
        let destination = snap(center);
        let [, constrained] = token.constrainMovementPath([{x: token.document.x, y: token.document.y, action: 'jump'}, {x: destination.x, y: destination.y, action: 'jump'}], {});
        return !constrained;
    };
    let position = await crosshairUtils.aimCrosshair({
        token,
        maxRange: plan.distance,
        boundaryRange: plan.cap,
        centerpoint: token.center,
        drawBoundries: true,
        trackDistance: true,
        validityFunctions: [landable],
        fudgeDistance: token.document.width * canvas.dimensions.distance / 2,
        crosshairsConfig: {
            size: token.document.parent.grid.distance * token.document.width / 2,
            icon: token.document.texture.src,
            resolution: (token.document.width % 2) ? 1 : -1
        }
    });
    if (!position || position.cancelled) return;
    if (position.valid === false) {
        genericUtils.notify('CHRISPREMADES.Macros.Jump.LongJump.OutOfReach', 'warn');
        return;
    }
    let destination = snap(position);
    let feet = Math.round(token.document.measureMovementPath([{x: token.document.x, y: token.document.y}, {x: destination.x, y: destination.y}]).distance);
    if (feet > plan.distance) {
        genericUtils.notify('CHRISPREMADES.Macros.Jump.LongJump.OutOfReach', 'warn');
        return;
    }
    let verdict = jumpVerdict(feet, plan);
    if (!verdict.legal) {
        let proceed = await dialogUtils.confirm(workflow.item.name, genericUtils.format('CHRISPREMADES.Macros.Jump.LongJump.OverBudgetPrompt', {cost: verdict.cost, remaining: plan.remaining}));
        if (!proceed) return;
    }
    let obstacleFailed = selection.lowObstacle ? await rollCheck('lowObstacle', lowDC) : false;
    let moved;
    if (playAnimation && !obstacleFailed) {
        /* eslint-disable indent */
        await new Sequence()
            .animation()
                .on(token)
                .opacity(0)
                .waitUntilFinished(-100)
            .effect()
                .file('animated-spell-effects-cartoon.air.portal')
                .atLocation(token)
                .scaleToObject(1.75)
                .belowTokens()
            .effect()
                .copySprite(token)
                .atLocation(token)
                .opacity(1)
                .duration(1000)
                .anchor({ x: 0.5, y: 1 })
                .loopProperty('sprite', 'position.y', {values: [50, 0, 50], duration: 500})
                .moveTowards(position, {rotate: false})
                .zIndex(2)
            .effect()
                .copySprite(token)
                .atLocation(token)
                .opacity(0.5)
                .scale(0.9)
                .belowTokens()
                .duration(1000)
                .anchor({x: 0.5, y: 0.5})
                .filter('ColorMatrix', {brightness: -1})
                .filter('Blur', {blurX: 5, blurY: 10})
                .moveTowards(position, {rotate: false})
                .zIndex(2)
                .waitUntilFinished(-100)
            .thenDo(async () => {
                moved = await moveByJump(token, destination, {distance: feet, cost: verdict.cost, animate: false});
            })
            .animation()
                .on(token)
                .opacity(1)
            .effect()
                .file('animated-spell-effects-cartoon.air.portal')
                .atLocation(position)
                .scaleToObject(1.75 * token.document.width)
                .belowTokens()
            .play();
        /* eslint-enable indent */
    } else if (!obstacleFailed) {
        moved = await moveByJump(token, destination, {distance: feet, cost: verdict.cost, animate: true});
    }
    // Core may still clamp the path (the spot filled up while the dice were rolling):
    // `move` reports true for a partial move, so the landing is the position itself.
    let landed = !!moved && token.document.x === destination.x && token.document.y === destination.y;
    if (landed && verdict.spellUsed) await combatUtils.setTurnCheck(workflow.actor, SPELL_TURN_FLAG);
    let addProne = landed && selection.difficultTerrain ? await rollCheck('difficultTerrain', terrainDC) : false;
    if (addProne) await effectUtils.applyConditions(workflow.actor, ['prone']);
    let lines = [];
    if (obstacleFailed || !landed) {
        // A failed low-obstacle check, or a landing core refused after all: the card
        // says so instead of claiming a jump that did not happen.
        lines.push(genericUtils.translate('CHRISPREMADES.Macros.Jump.LongJump.Blocked'));
    } else {
        let verdictLine = genericUtils.format('CHRISPREMADES.Macros.Jump.LongJump.Verdict', {feet: verdict.feet, cost: verdict.cost});
        if (plan.remaining !== null) {
            verdictLine += ' — ' + (verdict.legal
                ? genericUtils.translate('CHRISPREMADES.Macros.Jump.LongJump.VerdictLegal')
                : '<span style="color:var(--dnd5e-color-failure, #b00);font-weight:bold;">' + genericUtils.format('CHRISPREMADES.Macros.Jump.LongJump.VerdictOver', {over: verdict.cost - plan.remaining}) + '</span>');
        }
        lines.push(verdictLine);
        if (verdict.spellUsed) lines.push(genericUtils.translate('CHRISPREMADES.Macros.Jump.LongJump.VerdictSpell'));
    }
    await stampCard(workflow, lines);
}
export let jump = {
    name: 'Jump',
    version: '1.4.29',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: longJump,
                priority: 50,
                activities: ['longJump']
            },
            {
                pass: 'preambleComplete',
                macro: early,
                priority: 50,
                activities: ['longJump', 'standingHighJump', 'runningHighJump']
            }
        ]
    },
    config: [
        {
            value: 'playAnimation',
            label: 'CHRISPREMADES.Config.PlayAnimation',
            type: 'checkbox',
            default: true,
            category: 'animation'
        },
        {
            value: 'lowObstacleDC',
            label: 'CHRISPREMADES.Macros.Jump.LongJump.LowObstacleDC',
            type: 'number',
            default: 10,
            category: 'mechanics'
        },
        {
            value: 'difficultTerrainDC',
            label: 'CHRISPREMADES.Macros.Jump.LongJump.DifficultTerrainDC',
            type: 'number',
            default: 10,
            category: 'mechanics'
        }
    ]
};
