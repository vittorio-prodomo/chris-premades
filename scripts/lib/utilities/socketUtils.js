import {socket, sockets} from '../sockets.js';
import {genericUtils} from '../../utils.js';
function gmID() {
    let gmID = game.settings.get('chris-premades', 'gmID');
    let preferredGMId = game.settings.get('midi-qol', 'PreferredGM');  
    if (preferredGMId !== '') {
        let preferredGM = game.users.get(preferredGMId);
        if (preferredGM?.active) gmID = preferredGM.id;
    }
    // FORK PATCH — never route a prompt to a GM who is not connected. Upstream checks `.active` for
    // midi's PreferredGM but takes the stored `gmID` setting on faith, so a stale value (here: the
    // agent's own user) silently sends every GM-bound prompt to `socket.executeAsUser` for an absent
    // user. Nothing errors, nothing renders, and the caller's `.then()` never resolves — which is
    // exactly how the Maneuvering Attack confirmation vanished on 2026-07-27, and is the same shape
    // as the known Heroic Inspiration stall when a PC's owner is offline.
    if (!game.users.get(gmID)?.active) gmID = game.users.activeGM?.id ?? gmID;
    return gmID;
}
function isTheGM() {
    return gmID() === game.user.id;
}
function hasPermission(entity, userId) {
    let user = game.users.get(userId);
    if (!user) return false;
    return entity.testUserPermission(user, 'OWNER');
}
function firstOwner(document, useId) {
    if (!document) return;
    document = document instanceof TokenDocument ? document.actor : document instanceof foundry.canvas.placeables.Token ? document.document.actor : document;
    let permissions = genericUtils.getProperty(document ?? {}, 'ownership') ?? {};
    let playerOwners = Object.entries(permissions).filter(([id, level]) => !game.users.get(id)?.isGM && game.users.get(id)?.active && level === 3).map(([id]) => id);
    if (playerOwners.length > 0) {
        let playerId = document instanceof Actor.implementation ? 
            playerOwners.find(id => game.users.get(id)?.character?.uuid === document.uuid) ?? playerOwners[0] : 
            playerOwners[0];
        return useId ? playerId : game.users.get(playerId);
    }
    return useId ? gmID() : game.users.get(gmID());
}
async function remoteRollItem(item, config, options, userId) {
    if (game.user.id === userId) return await MidiQOL.completeItemUse(item, config, options);
    return await socket.executeAsUser(sockets.rollItem.name, userId, item.uuid, config, options);
}
export let socketUtils = {
    gmID,
    isTheGM,
    hasPermission,
    firstOwner,
    remoteRollItem
};