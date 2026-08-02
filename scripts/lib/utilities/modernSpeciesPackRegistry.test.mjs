import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T121 — the species-feature half of the same two-sides invariant guarded for items and class
 * features in modernItemPackRegistry.test.mjs.
 *
 * A premade only reaches a 2024-rules sheet item if BOTH halves line up:
 *   1. `genericUtils.getCPRIdentifiers(name, 'modern')` maps the item's NAME to a CPR identifier,
 *      and it builds that map from the MODERN registry (scripts/macros.js) alone; and
 *   2. a packData entry carrying that identifier lives in the pack `compendiumUtils.getCPRAutomation`
 *      searches — for a `feat` whose `system.type.value === 'race'` under modern rules that is
 *      `constants.modernPacks.speciesFeatures` = cpr-species-features-2024.
 *
 * Fey Ancestry had NEITHER: `feyAncestry` was exported from legacyMacros.js only and its packData
 * entry existed only in cpr-race-features (2014). So `getCPRIdentifiers` returned [], the by-name
 * fallback found nothing in the modern pack, and the lookup fell through to the plain
 * `dnd5e.origins24` copy — which carries no effects. Both elves in the campaign therefore had a
 * feature whose own description promises Advantage on Charmed saves and nothing delivering it.
 *
 * ⚠️ The miss is SILENT, exactly as in T65: the swap still returns *an* item, just the unautomated
 * official one. Read `info.source` and the effects, never mere truthiness.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-species-features-2024/', import.meta.url));
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

function macroIdentifiers(macros) {
    if (typeof macros === 'string') return [macros];
    if (Array.isArray(macros)) return macros.flatMap(macroIdentifiers);
    if (macros && typeof macros === 'object') return Object.values(macros).flatMap(macroIdentifiers);
    return [];
}

test('every cpr-species-features-2024 macro identifier is exported from the modern registry', () => {
    const exported = modernRegistryExports();
    const missing = [];
    for (const {file, data} of packItems()) {
        for (const identifier of macroIdentifiers(data.flags?.['chris-premades']?.macros)) {
            if (!exported.has(identifier)) missing.push(`${file} -> ${identifier}`);
        }
    }
    assert.deepEqual(missing, [], 'these identifiers resolve to nothing under rules "modern"');
});

test('every CPR-authored species feature is reachable by name from the modern registry', () => {
    /*
     * The generalised guard, and the one that would have caught Fey Ancestry the day it was written.
     * A macro-free premade (a pure transfer effect, like this one and Celestial Resistance) carries
     * no `macros` flag at all, so the identifier check above never sees it. What it still needs is a
     * modern registry ENTRY, because that registry is the only name -> identifier map
     * getCPRIdentifiers consults. Without one the pack entry is unreachable no matter how correct it is.
     */
    const exported = modernRegistryExports();
    const unreachable = [];
    for (const {file, data} of packItems()) {
        const info = data.flags?.['chris-premades']?.info;
        if (info?.source !== 'chris-premades') continue;
        if (!exported.has(info.identifier)) unreachable.push(`${file} -> ${info.identifier}`);
    }
    assert.deepEqual(unreachable, [], 'scripts/macros.js does not export these identifiers');
});

test('every cpr-species-features-2024 entry declares 2024 rules and a CPR identifier', () => {
    for (const {file, data} of packItems()) {
        assert.equal(data.system?.source?.rules, '2024', `${file} must be 2024-rules or it can never match a modern item`);
        assert.ok(data.flags?.['chris-premades']?.info?.identifier, `${file} is missing flags.chris-premades.info.identifier`);
    }
});

test('every cpr-species-features-2024 _key matches its own _id', () => {
    // Same trap as T81: deriving an entry from an existing one and changing `_id` without `_key`
    // packs it under the OLD id, silently. A missing embedded `_key` aborts the pack outright with
    // "Key cannot be null or undefined".
    const all = readdirSync(packDir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({file, data: JSON.parse(readFileSync(packDir + file, 'utf8'))}));
    for (const {file, data} of all) {
        assert.equal(data._key.split('!').pop(), data._id, `${file}: _key and _id disagree`);
        for (const effect of data.effects ?? []) {
            assert.ok(effect._key, `${file}: embedded effect ${effect._id} has no _key — the pack will abort`);
            assert.equal(effect._key, `!items.effects!${data._id}.${effect._id}`, `${file}: embedded _key is wrong`);
        }
    }
});

test('Fey Ancestry has a modern packData entry in the species pack', () => {
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'feyAncestry');
    assert.ok(entry, 'no cpr-species-features-2024 entry with identifier "feyAncestry"');
    assert.equal(entry.data.name, 'Fey Ancestry');
    assert.equal(entry.data.flags['chris-premades'].info.rules, 'modern');
    assert.equal(entry.data.system.source.rules, '2024');
    // The pack is only SEARCHED for a feat whose subtype is `race` (compendiumUtils.js:35) — any
    // other value and getCPRAutomation never opens this pack at all.
    assert.equal(entry.data.system.type.value, 'race', 'a non-race feat never reaches the species pack');
    assert.ok(entry.data.system.description.value.length > 0, 'needs its 2024 description');
});

test('Fey Ancestry is registered in the modern macro registry', () => {
    assert.ok(modernRegistryExports().has('feyAncestry'), 'scripts/macros.js does not export feyAncestry');
});

test('the modern Fey Ancestry macro declares modern rules', () => {
    const path = fileURLToPath(new URL('../../macros/2024/speciesFeatures/elf/feyAncestry.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    assert.match(source, /rules: 'modern'/);
    assert.match(source, /name: 'Fey Ancestry'/);
});

test('the Fey Ancestry macro and packData versions agree', () => {
    // itemUtils.isUpToDate compares the version STAMPED on an item (from packData) against the
    // registry's. Drift makes an item permanently "up to date" against a version never shipped.
    const macroSource = readFileSync(fileURLToPath(new URL('../../macros/2024/speciesFeatures/elf/feyAncestry.js', import.meta.url)), 'utf8');
    const macroVersion = macroSource.match(/version:\s*'([^']+)'/)?.[1];
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'feyAncestry');
    assert.ok(macroVersion, 'the modern Fey Ancestry macro declares no version');
    assert.equal(entry.data.flags['chris-premades'].info.version, macroVersion, 'packData and macro versions disagree');
});

test('Fey Ancestry grants the Charmed condition-resistance flag, and transfers', () => {
    /*
     * This effect IS the whole automation — there is no macro. `conditionResistance.preambleComplete`
     * (macros/mechanics/conditionResistance.js) reads
     * `actor.flags['chris-premades'].CR[condition]` for each condition the incoming activity applies
     * and, when set, grants a one-turn `flags.midi-qol.advantage.save.all` effect. So the key string
     * is load-bearing to the character, and `transfer` is load-bearing to it reaching the actor at all.
     */
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'feyAncestry');
    const effect = entry.data.effects?.[0];
    assert.ok(effect, 'Fey Ancestry has no effect — the automation is the effect');
    assert.equal(effect.transfer, true, 'a non-transfer effect never reaches the actor');
    assert.equal(effect.disabled, false);
    const change = effect.changes.find(c => c.key === 'flags.chris-premades.CR.charmed');
    assert.ok(change, 'the Charmed condition-resistance change is missing');
    assert.equal(change.value, '1', 'conditionResistance accepts "1"/"true"/an ability id');
    assert.equal(change.mode, 5, 'OVERRIDE — matches the legacy entry and every other CR grant');
});

test('Fey Ancestry does NOT claim immunity to magical sleep', () => {
    /*
     * 2014 Fey Ancestry was "advantage on saves against being charmed, AND magic can't put you to
     * sleep". 2024 keeps only the Charmed clause — the sleep half moved into the Sleep spell's own
     * text ("Creatures that don't sleep, such as elves … automatically succeed"). Encoding a sleep
     * immunity here would both double that rule and misstate 2024 RAW.
     */
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'feyAncestry');
    const serialised = JSON.stringify(entry.data.effects);
    assert.ok(!/traits\.ci/.test(serialised), '2024 Fey Ancestry grants no condition immunity');
    assert.ok(!/sleep/i.test(serialised), 'the sleep clause is not part of 2024 Fey Ancestry');
});
