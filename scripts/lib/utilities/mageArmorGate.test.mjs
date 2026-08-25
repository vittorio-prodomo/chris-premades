import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T154 — Mage Armor must be blocked on a target wearing armor.
 *
 * 2024 (and 2014) RAW verbatim: "a willing creature who isn't wearing armor". Nothing enforced it —
 * Nigel successfully cast it onto Warpey in Studded Leather. There is no CPR pack entry for Mage
 * Armor, so the gate is a fork-owned dnd5e.preUseActivity hook (the ONLY abort point with zero
 * side effects — midi lays down economy markers and the chat card before any CPR pass runs).
 */
const gatePath = fileURLToPath(new URL('../../macros/2024/spells/mageArmor.js', import.meta.url));
const registryPath = fileURLToPath(new URL('../../macros.js', import.meta.url));

test('T154: the Mage Armor gate exists, hooks preUseActivity, and blocks armored targets', () => {
    const source = readFileSync(gatePath, 'utf8');
    assert.match(source, /Hooks\.on\('dnd5e\.preUseActivity'/,
        'preItemRoll/preambleComplete abort too late — economy markers and the card already exist');
    assert.match(source, /equippedArmor/, 'dnd5e exposes the worn armor at system.attributes.ac.equippedArmor');
    assert.match(source, /return false;/, 'returning false from preUseActivity is the clean abort');
    // Keyed on the slugified item identifier, not the localized display name.
    assert.match(source, /identifier !== 'mage-armor'/);
});

test('T154: the gate file is loaded by the bundle', () => {
    // A module-scope Hooks.on only runs if the file is imported. macros.js is the load chain.
    const registry = readFileSync(registryPath, 'utf8');
    assert.match(registry, /import '\.\/macros\/2024\/spells\/mageArmor\.js';/);
});

test('T154: the refusal is localized, en and it', () => {
    const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../../lang/en.json', import.meta.url)), 'utf8'));
    const it = JSON.parse(readFileSync(fileURLToPath(new URL('../../../lang/it.json', import.meta.url)), 'utf8'));
    assert.ok(en.CHRISPREMADES.Macros.MageArmor?.WearingArmor, 'en key missing');
    assert.ok(it.CHRISPREMADES.Macros.MageArmor?.WearingArmor, 'it key missing — his client runs Italian');
    assert.match(en.CHRISPREMADES.Macros.MageArmor.WearingArmor, /\{targetName\}/);
    assert.match(it.CHRISPREMADES.Macros.MageArmor.WearingArmor, /\{targetName\}/);
});
