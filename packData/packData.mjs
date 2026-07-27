import {compilePack, extractPack} from '@foundryvtt/foundryvtt-cli';
let packs = [
    'cpr-3rd-party-class-features',
    'cpr-3rd-party-items',
    'cpr-3rd-party-feats',
    'cpr-actions',
    'cpr-class-feature-items',
    'cpr-class-features',
    'cpr-feats',
    'cpr-feat-features',
    'cpr-item-features',
    'cpr-items',
    'cpr-miscellaneous',
    'cpr-miscellaneous-items',
    'cpr-monster-features',
    'cpr-race-features',
    'cpr-spell-features',
    'cpr-spells',
    'cpr-summon-features',
    'cpr-summons',
    'cpr-spells-2024',
    'cpr-class-features-2024',
    'cpr-items-2024',
    'cpr-summons-2024',
    'cpr-summon-features-2024',
    'cpr-feats-2024',
    //'cpr-feat-features-2024',
    'cpr-feat-features-2024',
    'cpr-embedded-macro-sample-items',
    'cpr-actions-2024',
    'cpr-feature-items-2024',
    'cpr-3rd-party-class-features-2024',
    'cpr-3rd-party-spells',
    'cpr-monster-features-2024',
    'cpr-3rd-party-spells-2024',
    'cpr-species-features-2024',
    'cpr-other-features',
    'cpr-3rd-party-feats-2024',
    'cpr-3rd-party-items-2024',
    'cpr-class-feature-items-2024'
];
/*
 * With no arguments this rebuilds every pack, as it always has. Naming packs rebuilds only
 * those — `npm run buildCompendiums cpr-items-2024` — which is what you want after editing a
 * single packData entry. Foundry must be STOPPED either way: a running server write-locks the
 * pack LevelDBs.
 */
let selected = process.argv.slice(2);
let unknown = selected.filter(i => !packs.includes(i));
if (unknown.length) {
    console.error('unknown pack(s): ' + unknown.join(', '));
    process.exit(1);
}
for (let i of (selected.length ? selected : packs)) {
    await compilePack('./packData/' + i, './packs/' + i, {log: true});
}
/*
 * Leave before teardown. On node >=25 abstract-level throws "Iterator is not open: cannot call
 * all() after close()" while closing down, AFTER every pack is written — which used to abort the
 * loop and leave later packs unbuilt. compilePack having resolved means the writes are done.
 */
process.exit(0);