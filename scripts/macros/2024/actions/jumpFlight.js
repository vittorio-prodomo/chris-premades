/*
 * T249 — Jump's flight (T223), shared with the drop actions. Moved verbatim from jump.js;
 * the only addition is an optional destination ELEVATION for a move that lands lower.
 */
/**
 * The real move: core's `jump` action, so movement history, dnd5e's ruler, the summon
 * leash and the opportunity-attack watchers all see it. Under the spell's discount the
 * jump segment is priced at {cost} instead of its distance, through the same seam
 * dnd5e prices difficult terrain with, so the recorded history stays the budget's truth.
 */
export async function moveByJump(token, destination, {distance, cost, animate}) {
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
        let moved = await token.document.move({x: destination.x, y: destination.y, action: 'jump'}, {method: 'api', showRuler: false, animate});
        // A drop (T249) lands lower. The FALL is free, so it is NOT part of the jump move: one move with the
        // elevation in it makes core lay a 3D path whose vertical steps escape the cost wrap above (seen live
        // 2026-10-15: 27.9 ft charged for a 10-ft leap from a 30-ft roof). Core's `displace` action is a
        // zero-cost teleport, recorded in the history at cost 0.
        if (moved && destination.elevation !== undefined && destination.elevation !== token.document.elevation) {
            moved = await token.document.move({x: destination.x, y: destination.y, elevation: destination.elevation, action: 'displace'}, {method: 'api', showRuler: false, animate: false});
        }
        return moved;
    } finally {
        if (discounted) delete token._getMovementCostFunction;
    }
}
/**
 * The flight picture plus the real move. Returns whether the token landed exactly at
 * `destination` (core may clamp a path while the dice roll; `move` reports true then).
 */
export async function flyTo({token, position, destination, distance, cost, sounds = {}, playRunUp = false, playAnimation = true}) {
    let moved;
    if (playAnimation) {
        /* eslint-disable indent */
        await new Sequence()
            .sound()
                .playIf(playRunUp)
                .file(sounds.runUp)
                .waitUntilFinished(-600)
            .sound()
                .playIf(!!sounds.takeoff)
                .file(sounds.takeoff)
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
                moved = await moveByJump(token, destination, {distance, cost, animate: false});
            })
            .sound()
                .playIf(!!sounds.landing)
                .file(sounds.landing)
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
    } else {
        if (sounds.takeoff) await new Sequence().sound().file(sounds.takeoff).play();
        moved = await moveByJump(token, destination, {distance, cost, animate: true});
        if (moved) {
            await token.movementAnimationPromise;
            if (sounds.landing) await new Sequence().sound().file(sounds.landing).play();
        }
    }
    return !!moved && token.document.x === destination.x && token.document.y === destination.y;
}
