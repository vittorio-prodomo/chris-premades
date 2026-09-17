// T232 (Vittorio, 2026-09-17): maneuvers as ACTIVITIES of one "Maneuver Options" parent item.
//
// Until now every maneuver was its own item ("Maneuvers: Riposte", DDB's "Maneuver: Riposte"),
// found by its CPR item identifier (`maneuversRiposte`). The parent shape keeps ONE item,
// identifier `maneuverOptions`, whose activities carry the bare maneuver names and a CPR
// activity identifier derived from the old item identifier (`maneuversRiposte` -> `riposte`).
//
// Both shapes are served side by side: a handle says which one a maneuver was found in, and the
// callers use the document through it. Pure — no Foundry here.

export const MANEUVER_PARENT_IDENTIFIER = 'maneuverOptions';
const ITEM_PREFIX = 'maneuvers';

/** `maneuversGoadingAttack` -> `goadingAttack`. Anything not so prefixed passes through. */
export function activityKeyFor(identifier) {
    if (typeof identifier !== 'string' || !identifier.startsWith(ITEM_PREFIX) || identifier.length === ITEM_PREFIX.length) return identifier;
    let rest = identifier.slice(ITEM_PREFIX.length);
    return rest[0].toLowerCase() + rest.slice(1);
}

/** `goadingAttack` -> `maneuversGoadingAttack`. */
export function identifierFor(activityKey) {
    if (typeof activityKey !== 'string' || !activityKey.length) return activityKey;
    return ITEM_PREFIX + activityKey[0].toUpperCase() + activityKey.slice(1);
}

/**
 * Which of these maneuvers does the actor have, and in which shape?
 * The parent's activity wins over a same-named separate item, so a half-migrated sheet never
 * offers one maneuver twice.
 *
 * @param {string[]} identifiers                       CPR item identifiers, in offer order
 * @param {object} lookups
 * @param {(identifier: string) => any} lookups.itemByIdentifier   the separate-item shape
 * @param {(key: string) => any} lookups.parentActivityByKey      the parent's activity, by key
 * @returns {{identifier: string, kind: 'activity' | 'item', doc: any}[]}
 */
export function resolveManeuverHandles(identifiers, {itemByIdentifier, parentActivityByKey}) {
    let handles = [];
    for (let identifier of identifiers ?? []) {
        let activity = parentActivityByKey?.(activityKeyFor(identifier));
        if (activity) {
            handles.push({identifier, kind: 'activity', doc: activity});
            continue;
        }
        let item = itemByIdentifier?.(identifier);
        if (item) handles.push({identifier, kind: 'item', doc: item});
    }
    return handles;
}

/**
 * What the player should read for this maneuver: the activity's own name under the parent
 * ("Riposte"), the item's name otherwise ("Maneuver: Riposte").
 */
export function maneuverLabel({underParent, activityName, itemName}) {
    if (underParent && typeof activityName === 'string' && activityName.trim().length) return activityName;
    return itemName;
}
