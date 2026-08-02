import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T123 — the spell-pack half of the two-sides invariant (see modernItemPackRegistry.test.mjs for
 * items/class features and modernSpeciesPackRegistry.test.mjs for species).
 *
 * Detect Thoughts was the third instance of the same silent gap: `detectThoughts` was exported from
 * legacyMacros.js only and had no cpr-spells-2024 entry, so a 2024-rules copy resolved to the plain
 * dnd5e.spells24 spell with no automation at all.
 *
 * ⚠️ Unlike Fey Ancestry (T121) this was NOT a re-registration. The 2024 spell is restructured —
 * the opener is "Sense Thoughts", both modes are co-equal instead of Probe Deeper being hidden
 * until cast — and CPR binds passes through its own `activityIdentifiers` map from CPR identifier
 * to ACTIVITY ID, so an entry whose map points at ids the item does not have goes silently inert.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-spells-2024/', import.meta.url));
const modernRegistryPath = fileURLToPath(new URL('../../macros.js', import.meta.url));

function modernRegistryExports() {
    const source = readFileSync(modernRegistryPath, 'utf8');
    const names = new Set();
    for (const match of source.matchAll(/^export \{([^}]*)\} from/gm)) {
        for (const raw of match[1].split(',')) {
            const name = raw.includes(' as ') ? raw.split(' as ').pop() : raw;
            if (name.trim()) names.add(name.trim());
        }
    }
    return names;
}

function packItems() {
    return readdirSync(packDir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({file, data: JSON.parse(readFileSync(packDir + file, 'utf8'))}))
        .filter(i => i.data._key?.startsWith('!items!'));
}

/*
 * ⚠️ PRE-EXISTING UPSTREAM BREAKAGE, found by the guard below on the day it was written (T123,
 * 2026-08-03) and NOT introduced by us. Each of these declares a CPR identifier whose activity is
 * absent from the 2024 pack entry, so the pass bound to it can never resolve:
 *
 *   Warding Bond      — `wardingBondDismiss` is missing, and wardingBond.js looks it up with
 *                       `{strict: true}`, i.e. it raises errors.missingActivity rather than
 *                       degrading quietly. The 2024 entry has only Warding Bond + its Damage rider.
 *   Compelled Duel    — `compelledDuelMoved` missing; the single activity present has an EMPTY name.
 *   Summon Dragon     — the Metallic and Gem variants both dangle, leaving one of three summonable.
 *
 * Listed rather than fixed because reconstructing four missing activities is its own piece of work
 * (raised as queue T124), and listed rather than ignored because an unexplained allowlist is how
 * this kind of debt becomes permanent. The assertion is EXACT equality, so fixing one — or adding a
 * new dangling pair — fails this test and forces the list to be revisited.
 */
const KNOWN_UPSTREAM_DANGLING = [
    'Compelled_Duel_EkzkGFHAQL86Ec0M.json: compelledDuelMoved -> 2xnYUd891b0vOwZN',
    'Summon_Dragon_L4K47zMyxumTGTg7.json: summonDraconicSpiritGem -> q43Wpz943aBmcQFD',
    'Summon_Dragon_L4K47zMyxumTGTg7.json: summonDraconicSpiritMetallic -> tt2PihfUt3ejpirS',
    'Warding_Bond_9hoDcPal5ONreoSf.json: wardingBondDismiss -> lP7h2QXXLeU6ltip'
];

test('every cpr-spells-2024 activityIdentifiers entry points at an activity the item HAS', () => {
    /*
     * The generalised guard, and the one specific to this pack. `activityUtils.getIdentifier` reads
     * this map to decide which CPR identifier an activity carries; a dangling id means every pass
     * bound to that identifier is never collected — no error, no warning. Porting a spell forward
     * is exactly when this breaks, because 2024 reissues activities with different ids.
     */
    const dangling = [];
    for (const {file, data} of packItems()) {
        const map = data.flags?.['chris-premades']?.activityIdentifiers ?? {};
        const activityIds = Object.keys(data.system?.activities ?? {});
        for (const [identifier, activityId] of Object.entries(map)) {
            if (!activityIds.includes(activityId)) dangling.push(`${file}: ${identifier} -> ${activityId}`);
        }
    }
    assert.deepEqual(dangling.sort(), KNOWN_UPSTREAM_DANGLING,
        'a CPR identifier resolves to no activity on its own item — if this is a NEW entry, the pass it binds is dead');
});

test('every CPR-authored 2024 spell is reachable by name from the modern registry', () => {
    const exported = modernRegistryExports();
    const unreachable = [];
    for (const {file, data} of packItems()) {
        const info = data.flags?.['chris-premades']?.info;
        if (info?.source !== 'chris-premades') continue;
        if (!exported.has(info.identifier)) unreachable.push(`${file} -> ${info.identifier}`);
    }
    assert.deepEqual(unreachable, [], 'scripts/macros.js does not export these identifiers');
});

test('Detect Thoughts has a modern packData entry wired to the 2024 activities', () => {
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'detectThoughts');
    assert.ok(entry, 'no cpr-spells-2024 entry with identifier "detectThoughts"');
    const cpr = entry.data.flags['chris-premades'];
    assert.equal(entry.data.name, 'Detect Thoughts');
    assert.equal(entry.data.system.source.rules, '2024');
    assert.equal(cpr.info.rules, 'modern');
    assert.deepEqual(cpr.macros.midi.item, ['detectThoughts']);

    const activities = entry.data.system.activities;
    const named = id => activities[id]?.name;
    assert.equal(named(cpr.activityIdentifiers.detectThoughts), 'Sense Thoughts',
        '2024 renames the opener; the CPR identifier stays detectThoughts but must point at it');
    assert.equal(named(cpr.activityIdentifiers.probeDeeper), 'Probe Deeper');
    assert.equal(activities[cpr.activityIdentifiers.probeDeeper].type, 'save',
        'the late pass keys on this being the save that can end the spell');
});

test('Probe Deeper is declared a sustained roll, not a fresh cast', () => {
    /*
     * `workflowUtils.isSustainedRoll` reads `spellActivities`. Without it, every "when you cast a
     * spell" hook (Blessed Healer, Beguiling Magic, Hide breaking…) re-fires when the caster probes
     * on a later turn — the spell was cast once, rounds earlier.
     */
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'detectThoughts');
    assert.deepEqual(entry.data.flags['chris-premades'].spellActivities, ['probeDeeper']);
});

test('⚠️ the 2024 entry hides NOTHING, unlike its 2014 counterpart', () => {
    // 2014 hid Probe Deeper until the spell was cast and the macro unhid it. 2024: "you can
    // activate either effect as a Magic action on your later turns". Declaring hiddenActivities
    // here would hide a mode the rules say is available from the start.
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'detectThoughts');
    assert.equal(entry.data.flags['chris-premades'].hiddenActivities, undefined);
});

test('Detect Thoughts is registered in the modern macro registry', () => {
    assert.ok(modernRegistryExports().has('detectThoughts'), 'scripts/macros.js does not export detectThoughts');
});

test('the 2024 macro reuses the legacy passes by REFERENCE, not by function name', () => {
    /*
     * ⚠️ This module is webpack-minified, so `macro.name === 'late'` is mangled at runtime and
     * indexing `midi.item[n]` depends on upstream ordering. The legacy file therefore exports the
     * two reusable passes by name. A regression here fails silently: the pass binds to undefined.
     */
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    assert.match(modern, /import \{detectThoughtsLate, detectThoughtsEarly\}/);
    assert.ok(!/macro\.name ===/.test(modern), 'minified builds mangle function names');
    assert.ok(!/midi\.item\[\d\]/.test(modern), 'upstream ordering is not ours to depend on');

    const legacy = readFileSync(fileURLToPath(new URL('../../macros/2014/spells/detectThoughts.js', import.meta.url)), 'utf8');
    assert.match(legacy, /export \{late as detectThoughtsLate, early as detectThoughtsEarly\}/);
});

test('the opener pass is idempotent across both 2024 entry points', () => {
    // Either mode can start the spell in 2024, so `use` is registered on both — and must not create
    // the effect twice when the caster senses first and probes afterwards.
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    assert.match(modern, /activities: \['detectThoughts', 'probeDeeper'\]/);
    assert.match(modern, /getEffectByIdentifier\(workflow\.actor, 'detectThoughts'\)\) return/);
});

test('the Detect Thoughts macro and packData versions agree', () => {
    const macroSource = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    const macroVersion = macroSource.match(/version:\s*'([^']+)'/)?.[1];
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'detectThoughts');
    assert.ok(macroVersion, 'the modern Detect Thoughts macro declares no version');
    assert.equal(entry.data.flags['chris-premades'].info.version, macroVersion);
});

test('every cpr-spells-2024 _key matches its own _id', () => {
    for (const {file, data} of packItems()) {
        assert.equal(data._key.split('!').pop(), data._id, `${file}: _key and _id disagree`);
        for (const effect of data.effects ?? []) {
            assert.ok(effect._key, `${file}: embedded effect ${effect._id} has no _key — the pack will abort`);
            assert.equal(effect._key, `!items.effects!${data._id}.${effect._id}`, `${file}: embedded _key is wrong`);
        }
    }
});
