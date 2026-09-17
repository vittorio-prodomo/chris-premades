// T232 (Vittorio, 2026-09-17): generate the "Maneuver Options" parent document from the twenty
// separate 2024 maneuver documents, so the parent can never drift from them by hand.
//
//   node packData/t232-buildManeuverOptions.mjs          # write the document
//   node packData/t232-buildManeuverOptions.mjs --check  # exit 1 if the file on disk is stale
//
// Shape (scripts/lib/utilities/maneuverHandles.mjs is the runtime half):
//  - one activity per maneuver, named after it ("Riposte"), CPR identifier = the item identifier
//    minus `maneuvers`; a maneuver's further activities keep their own identifier (Sweeping
//    Attack's attack) and are recorded as owned by it;
//  - a maneuver that is a passive effect with NO activity (Ambush, Commanding Presence, Precision
//    Attack, Tactical Assessment) gets an inert one, so the sheet still lists it as chosen;
//  - every effect is carried over, renamed without the "Maneuvers: " prefix, recorded as owned by
//    its maneuver — the prune pass removes what the character did not choose.
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {activityKeyFor} from '../scripts/lib/utilities/maneuverHandles.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cpr-class-features-2024');
const PARENT_ID = 'cprManeuverOpt24';
const OUT = path.join(dir, `Maneuver_Options_${PARENT_ID}.json`);
const VERSION = '1.0.0';
const PREFIX = 'Maneuvers: ';

/** A stable 16-character id from a key: `mo` + the key, padded/truncated. */
function activityId(key) {
    return ('mo' + key.replace(/[^A-Za-z0-9]/g, '')).padEnd(16, '0').slice(0, 16);
}

export function build() {
    let sources = fs.readdirSync(dir).filter(i => i.startsWith('Maneuvers__') && i.endsWith('.json')).sort()
        .map(i => JSON.parse(fs.readFileSync(path.join(dir, i), 'utf8')));
    let activities = {};
    let activityIdentifiers = {};
    let hiddenActivities = [];
    let secondary = {};
    let effectOwners = {};
    let effects = [];
    let template;
    let inertTemplate = Object.values(sources.find(i => i.flags['chris-premades'].info.identifier === 'maneuversManeuveringAttack').system.activities)[0];
    for (let doc of sources) {
        let cpr = doc.flags['chris-premades'];
        let identifier = cpr.info.identifier;
        let key = activityKeyFor(identifier);
        let bare = doc.name.startsWith(PREFIX) ? doc.name.slice(PREFIX.length) : doc.name;
        if (identifier === 'maneuversRiposte') template = doc;
        let declared = cpr.activityIdentifiers ?? {};
        let idByOldId = {};
        let entries = Object.entries(doc.system.activities ?? {});
        // The main activity: the one declared as `use` / as the item identifier, else the only one.
        let mainOldId = declared.use ?? declared[identifier] ?? (entries.length === 1 ? entries[0][0] : undefined);
        if (entries.length > 1 && !mainOldId) throw new Error(`${doc.name}: cannot tell the main activity`);
        for (let [oldId, activity] of entries) {
            let isMain = oldId === mainOldId;
            let ownKey = isMain ? key : Object.entries(declared).find(([, id]) => id === oldId)?.[0];
            if (!ownKey) throw new Error(`${doc.name}: activity ${oldId} has no identifier`);
            let newId = isMain ? activityId(key) : oldId;
            if (activities[newId]) throw new Error(`activity id collision: ${newId}`);
            idByOldId[oldId] = newId;
            let copy = structuredClone(activity);
            copy._id = newId;
            if (isMain) {
                copy.name = bare;
                copy.img = doc.img;
            } else {
                secondary[ownKey] = key;
                if (!copy.img) copy.img = doc.img;
            }
            activities[newId] = copy;
            activityIdentifiers[ownKey] = newId;
        }
        if (!entries.length) {
            // A passive maneuver: an inert activity so the sheet lists it. No activation (no HUD
            // button), no consumption (midi's optional-bonus flag spends the die itself).
            let newId = activityId(key);
            // Schema-faithful: clone a real macro-free utility activity rather than hand-writing one.
            let inert = structuredClone(inertTemplate);
            inert._id = newId;
            inert.name = bare;
            inert.img = doc.img;
            inert.activation = {...inert.activation, type: '', value: null};
            inert.consumption = {...inert.consumption, targets: []};
            inert.effects = [];
            activities[newId] = inert;
            activityIdentifiers[key] = newId;
        }
        for (let hidden of cpr.hiddenActivities ?? []) hiddenActivities.push(hidden === identifier ? key : hidden);
        for (let effect of doc.effects ?? []) {
            if (effects.some(i => i._id === effect._id)) throw new Error(`effect id collision: ${effect._id}`);
            let copy = structuredClone(effect);
            if (copy.name.startsWith(PREFIX)) copy.name = copy.name.slice(PREFIX.length);
            copy._key = `!items.effects!${PARENT_ID}.${copy._id}`;
            effects.push(copy);
            effectOwners[copy._id] = key;
        }
    }
    let sort = 0;
    for (let key of Object.keys(activityIdentifiers).sort()) activities[activityIdentifiers[key]].sort = (sort += 100000);
    let parent = structuredClone(template);
    parent.name = 'Maneuver Options';
    parent.img = 'icons/skills/melee/maneuver-sword-katana-yellow.webp';
    parent._id = PARENT_ID;
    parent._key = `!items!${PARENT_ID}`;
    parent.effects = effects;
    parent.system.activities = Object.fromEntries(Object.keys(activities).sort().map(i => [i, activities[i]]));
    parent.system.identifier = 'maneuver-options';
    parent.system.description = {
        value: '<p>Your chosen maneuvers. Each one is an activity of this feature; all of them spend Superiority Dice.</p>',
        chat: ''
    };
    parent.flags['chris-premades'] = {
        info: {name: 'Maneuver Options', version: VERSION, identifier: 'maneuverOptions', source: 'chris-premades', rules: 'modern'},
        macros: {midi: {item: ['maneuverOptions'], actor: ['maneuverOptions']}, item: ['maneuverOptions']},
        hiddenActivities: [...new Set(hiddenActivities)].sort(),
        activityIdentifiers: Object.fromEntries(Object.keys(activityIdentifiers).sort().map(i => [i, activityIdentifiers[i]])),
        maneuverOptions: {secondary, effectOwners}
    };
    // The ITEM-level reaction condition was Riposte's alone; every reaction here gates on its own
    // activity (`useConditionText`), so the shared flag must say nothing.
    parent.flags['midi-qol'] ??= {};
    parent.flags['midi-qol'].reactionCondition = '';
    // Our midi fork (patch #23): the reaction offer reads "Parry", not "Maneuver Options: Parry".
    parent.flags['midi-qol'].activityNamesStandAlone = true;
    return parent;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    let text = JSON.stringify(build(), null, 2) + '\n';
    if (process.argv.includes('--check')) {
        let current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
        if (current !== text) {
            console.error('Maneuver Options is STALE — run: node packData/t232-buildManeuverOptions.mjs');
            process.exit(1);
        }
        console.log('Maneuver Options is up to date.');
    } else {
        fs.writeFileSync(OUT, text);
        console.log(`wrote ${path.basename(OUT)}`);
    }
}
