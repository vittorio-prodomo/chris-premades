import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T65 guard — a premade only reaches a 2024 item if BOTH halves line up:
 * the macro identifier has to be exported from the MODERN registry (scripts/macros.js,
 * which is what genericUtils.getCPRIdentifiers/custom.getMacro read for rules 'modern')
 * AND a matching packData entry has to live in cpr-items-2024. Boots of Elvenkind had
 * the macro registered in legacyMacros.js only, so the swap silently missed on every
 * modern-rules world. These tests assert the two sides agree.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-items-2024/', import.meta.url));
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
        .map(file => ({file, data: JSON.parse(readFileSync(packDir + file, 'utf8'))}));
}

function macroIdentifiers(macros) {
    // macros is a nested shape: {skill: ['x']} or {midi: {item: ['y']}}
    if (typeof macros === 'string') return [macros];
    if (Array.isArray(macros)) return macros.flatMap(macroIdentifiers);
    if (macros && typeof macros === 'object') return Object.values(macros).flatMap(macroIdentifiers);
    return [];
}

test('every cpr-items-2024 macro identifier is exported from the modern registry', () => {
    const exported = modernRegistryExports();
    const missing = [];
    for (const {file, data} of packItems()) {
        for (const identifier of macroIdentifiers(data.flags?.['chris-premades']?.macros)) {
            if (!exported.has(identifier)) missing.push(`${file} -> ${identifier}`);
        }
    }
    assert.deepEqual(missing, [], 'these identifiers resolve to nothing under rules "modern"');
});

test('every cpr-items-2024 entry declares 2024 rules and a CPR identifier', () => {
    for (const {file, data} of packItems()) {
        assert.equal(data.system?.source?.rules, '2024', `${file} must be 2024-rules or it can never match a modern item`);
        assert.ok(data.flags?.['chris-premades']?.info?.identifier, `${file} is missing flags.chris-premades.info.identifier`);
    }
});

test('Boots of Elvenkind has a modern packData entry wired to the skill macro', () => {
    const boots = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'bootsOfElvenkind');
    assert.ok(boots, 'no cpr-items-2024 entry with identifier "bootsOfElvenkind"');
    assert.equal(boots.data.name, 'Boots of Elvenkind');
    assert.deepEqual(boots.data.flags['chris-premades'].macros.skill, ['bootsOfElvenkind']);
    assert.equal(boots.data.flags['chris-premades'].info.rules, 'modern');
});

test('Boots of Elvenkind is registered in the modern macro registry', () => {
    assert.ok(modernRegistryExports().has('bootsOfElvenkind'), 'scripts/macros.js does not export bootsOfElvenkind');
});

test('the modern Boots of Elvenkind macro keeps the legacy skill-context gate', () => {
    const path = fileURLToPath(new URL('../../macros/2024/items/trinket/bootsOfElvenkind.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    assert.match(source, /rules: 'modern'/);
    assert.match(source, /skill:/);
});
