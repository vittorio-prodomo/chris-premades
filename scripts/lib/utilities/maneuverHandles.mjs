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

/**
 * A maneuver's activity key from its printed name, whatever prefix or suffix a source hung on it:
 * "Riposte", "Maneuver: Goading Attack", "Maneuver Options: Parry (Str.)", "Commander’s Strike",
 * "Bait and Switch" -> riposte, goadingAttack, parry, commandersStrike, baitAndSwitch.
 */
export function keyForManeuverName(name) {
    if (typeof name !== 'string') return '';
    let bare = name
        .replace(/^\s*(Maneuver Options|Maneuvers|Maneuver|Martial Adept)\s*:\s*/i, '')
        .replace(/\s*\((Str|Dex)\.?\)\s*$/i, '')
        .replace(/['’`]/g, '');
    let words = bare.split(/[^A-Za-z0-9]+/).filter(i => i.length);
    if (!words.length) return '';
    return words.map((w, i) => i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)).join('');
}

/**
 * The premade arrives with every maneuver; keep only the chosen ones.
 *
 * @param {object} p
 * @param {string[]} [p.chosenNames]           the importer's stamp (bare DDB names); absent = do nothing
 * @param {Record<string,string>} p.activityIdentifiers  CPR key -> activity id, as on the item
 * @param {string[]} [p.hiddenActivities]
 * @param {{secondary?: Record<string,string>, effectOwners?: Record<string,string>}} [p.owners]
 *        `secondary`: a non-maneuver activity key -> the maneuver key that owns it (Sweeping Attack's
 *        attack); `effectOwners`: effect id -> the maneuver key that owns it
 * @returns {null | {removeKeys: string[], removeActivityIds: string[], removeEffectIds: string[], hiddenActivities: string[]}}
 *          null = leave the item alone. ⚠️ Also null when NOT ONE chosen name resolves to a key on the
 *          item: that is a naming mismatch, and pruning on it would empty the feature.
 */
export function planManeuverPrune({chosenNames, activityIdentifiers = {}, hiddenActivities = [], owners = {}}) {
    if (!Array.isArray(chosenNames) || !chosenNames.length) return null;
    let secondary = owners?.secondary ?? {};
    let effectOwners = owners?.effectOwners ?? {};
    let chosen = new Set(chosenNames.map(keyForManeuverName).filter(i => i));
    let maneuverKeys = Object.keys(activityIdentifiers).filter(key => !(key in secondary));
    if (!maneuverKeys.some(key => chosen.has(key))) return null;
    let keeps = key => key in secondary ? chosen.has(secondary[key]) : chosen.has(key);
    let removeKeys = Object.keys(activityIdentifiers).filter(key => !keeps(key));
    if (!removeKeys.length && !Object.values(effectOwners).some(key => !chosen.has(key))) return null;
    return {
        removeKeys,
        removeActivityIds: removeKeys.map(key => activityIdentifiers[key]),
        removeEffectIds: Object.entries(effectOwners).filter(([, key]) => !chosen.has(key)).map(([id]) => id),
        hiddenActivities: (hiddenActivities ?? []).filter(keeps)
    };
}

/**
 * midi's optional-bonus `count` of the passive maneuvers (Precision Attack, Ambush, …) reads
 * `ItemUses.<item NAME>`, and the pack says "Superiority Dice" — but a DDB-imported sheet names the
 * pool "Combat Superiority", so the lookup found nothing and midi NEVER offered the bonus (found
 * live 2026-09-17: no prompt on a miss; renaming the pool made it appear). Re-point the count at
 * whatever the actor's pool is actually called.
 *
 * @param {{key: string, value: string}[]} changes  one effect's changes
 * @param {string} poolName
 * @returns {null | object[]} the rewritten changes, or null when nothing needs rewriting
 */
export function repointItemUsesCount(changes, poolName) {
    if (!Array.isArray(changes) || typeof poolName !== 'string' || !poolName.trim()) return null;
    let wanted = 'ItemUses.' + poolName;
    let touched = false;
    let out = changes.map(change => {
        let isCount = /^flags\.midi-qol\.optional\.[^.]+\.count$/.test(change?.key ?? '');
        if (!isCount || typeof change.value !== 'string' || !change.value.startsWith('ItemUses.') || change.value === wanted) return change;
        touched = true;
        return {...change, value: wanted};
    });
    return touched ? out : null;
}
