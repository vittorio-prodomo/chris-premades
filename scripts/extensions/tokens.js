import {actorUtils, genericUtils, socketUtils, tokenUtils} from '../utils.js';
import {resolveTokenSizeUpdate, systemDerivesTokenScale, SIZE_SQUARES as sizes} from '../lib/utilities/tokenSizeScale.mjs';
// T219 (fork): the size/scale tables and the ring-aware math live in tokenSizeScale.mjs. The ratio
// is taken from each token's SOURCE scale (the prepared value carries dnd5e's ring factor and
// compounded on every apply/remove cycle), and a LINKED ring token gets no scale write at all
// because dnd5e derives it from the actor's size.
async function updateTokenSize(actor, animate, old) {
    let size = actor.system.traits.size;
    let probe = resolveTokenSizeUpdate({size, old, sourceScaleX: 1, systemDerivesScale: true});
    if (!probe) return;
    let sizeDiff = probe.sizeDiff;
    let forToken = tokenDoc => resolveTokenSizeUpdate({size, old, sourceScaleX: tokenDoc._source?.texture?.scaleX ?? tokenDoc.texture.scaleX, systemDerivesScale: systemDerivesTokenScale(tokenDoc)})?.update;
    if (!actor.token) {
        let prototypeUpdate = forToken(actor.prototypeToken);
        if (prototypeUpdate) await genericUtils.update(actor, {prototypeToken: prototypeUpdate});
    }
    let tokens = actorUtils.getTokens(actor);
    if (!tokens.length) return;
    let scene = tokens[0].document.parent;
    let pixels = scene.grid.size * sizeDiff;
    let allUpdates = tokens.map(i => {
        let update = forToken(i.document) ?? {};
        update._id = i.document.id;
        if (sizeDiff > 0) {
            let room = tokenUtils.checkForRoom(i, sizeDiff);
            let roomCenter = tokenUtils.checkForRoom(i, sizeDiff - 1);
            let direction;
            if (roomCenter.n && roomCenter.e && roomCenter.s && roomCenter.w && sizeDiff % 2 == 0)  {
                direction = 'center';
            } else {
                direction = tokenUtils.findDirection(room);
            }
            switch (direction) {
                case 'ne': update.y = i.document.y - pixels; break;
                case 'sw': update.x = i.document.x - pixels; break;
                case 'nw': update.x = i.document.x - pixels; update.y = i.document.y - pixels; break;
                case 'center': update.x = i.document.x - (scene.grid.size * (sizeDiff / 2)); update.y = i.document.y - (scene.grid.size * (sizeDiff / 2)); break;
            }
        } else if (sizeDiff < 0) {
            if (sizeDiff % 2 == 0) {
                update.x = i.document.x - (scene.grid.size * (sizeDiff / 2));
                update.y = i.document.y - (scene.grid.size * (sizeDiff / 2));
            }
        }
        return update;
    });
    await genericUtils.updateEmbeddedDocuments(scene, 'Token', allUpdates, {animate: animate, 'chris-premades': {movement: {ignore: true}}});
    // T219 — a LINKED ring token gets no scale key from us (dnd5e derives it from the actor's size), and
    // core never re-prepares a token document when its actor's effects change (only render flags), so a
    // same-footprint change (med<->sm, sm<->tiny) leaves the ring drawn at the OLD size. A flags-only
    // write does not re-prepare either. What does: re-sending the footprint keys with `diff: false`
    // — but only once the effect cascade has settled, hence the deferral (an in-flow write left it
    // stale; verified live both ways).
    let derivedTokens = tokens.filter(i => systemDerivesTokenScale(i.document));
    if (!derivedTokens.length) return;
    let refresh = derivedTokens.map(i => ({_id: i.document.id, width: sizes[size], height: sizes[size]}));
    setTimeout(() => genericUtils.updateEmbeddedDocuments(scene, 'Token', refresh, {diff: false, animate: false, 'chris-premades': {movement: {ignore: true}}}).catch(console.error), 300);
}
async function createDeleteUpdateActiveEffect(...args) {
    let effect, updates, options, userId;
    if (args.length === 3) {
        [effect, options, userId] = args;
    } else {
        [effect, updates, options, userId] = args;
    }
    if (!socketUtils.isTheGM()) return;
    if (effect.target?.documentName !== 'Actor') return;
    let change = effect.changes.find(i => i.key === 'system.traits.size');
    if (!change) return;
    let animate = effect.flags?.['chris-premades']?.effect?.sizeAnimation ?? true;
    let old = genericUtils.getProperty(options, 'chris-premades.effect.size.old');
    if (!old) return;
    await updateTokenSize(effect.target, animate, old);
}
async function preCreateUpdateActiveEffect(effect, updates, options, userId) {
    if (effect.target?.documentName !== 'Actor') return;
    let change = (updates.changes ?? effect.changes).find(i => i.key === 'system.traits.size');
    if (!change) return;
    genericUtils.setProperty(options, 'chris-premades.effect.size.old', effect.target.system.traits.size);
}
async function preDeleteActiveEffect(effect, options, userId) {
    if (effect.target?.documentName !== 'Actor') return;
    let change = effect.changes.find(i => i.key === 'system.traits.size');
    if (!change) return;
    genericUtils.setProperty(options, 'chris-premades.effect.size.old', effect.target.system.traits.size);
}
export let tokens = {
    createDeleteUpdateActiveEffect,
    preCreateUpdateActiveEffect,
    preDeleteActiveEffect
};
