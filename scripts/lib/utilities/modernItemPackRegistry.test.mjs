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

/*
 * T78 — applying the CPR automation replaced the DDB item and took its passive Active Effect with
 * it, which is what Visual Active Effects was showing. The marker is back, and it MUST stay inert:
 * the advantage comes from the "Silent" skill-context dialog, so any real change here would double
 * it. These two assertions are the guard against someone "helpfully" adding an advantage change.
 */
test('the Boots of Elvenkind macro and packData versions agree', () => {
    /*
     * itemUtils.isUpToDate reads the source version from the MACRO registry, while the version
     * STAMPED on an item comes from packData. If they drift, an item can be permanently "up to
     * date" against a version that was never shipped. Concretely (2026-07-27): adding the T78 marker
     * effect without bumping the macro left Warpey's already-automated boots reporting isUpToDate: 1
     * with no effect, so the Medkit would never have offered him the update.
     */
    const macroSource = readFileSync(fileURLToPath(new URL('../../macros/2024/items/trinket/bootsOfElvenkind.js', import.meta.url)), 'utf8');
    const macroVersion = macroSource.match(/version:\s*'([^']+)'/)?.[1];
    const boots = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'bootsOfElvenkind');
    assert.ok(macroVersion, 'the modern boots macro declares no version');
    assert.equal(boots.data.flags['chris-premades'].info.version, macroVersion, 'packData and macro versions disagree');
});

test('the Boots of Elvenkind marker effect exists and grants nothing', () => {
    const boots = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'bootsOfElvenkind');
    const effect = boots.data.effects?.[0];
    assert.ok(effect, 'the VAE marker effect is missing — T78 regressed');
    assert.equal(effect.transfer, true, 'must transfer, or it never reaches the actor while worn');
    assert.deepEqual(effect.changes, [], 'the marker must stay mechanically inert (see T78)');
    assert.ok(effect.description, 'VAE shows the description — an empty one is a blank tooltip');
});

/*
 * T55+T56 — the same two-halves invariant as above, for the class-feature pack. CPR's 23 maneuvers
 * were legacy-only, so a 2024-rules Battle Master matched none of them; these are the three ported
 * forward. The generic assertions run over the WHOLE pack so the next port is covered for free.
 */
const classFeatureDir = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/', import.meta.url));

function classFeatureItems() {
    return readdirSync(classFeatureDir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({file, data: JSON.parse(readFileSync(classFeatureDir + file, 'utf8'))}));
}

test('every cpr-class-features-2024 macro identifier is exported from the modern registry', () => {
    const exported = modernRegistryExports();
    const missing = [];
    for (const {file, data} of classFeatureItems()) {
        for (const identifier of macroIdentifiers(data.flags?.['chris-premades']?.macros)) {
            if (!exported.has(identifier)) missing.push(`${file} -> ${identifier}`);
        }
    }
    assert.deepEqual(missing, [], 'these identifiers resolve to nothing under rules "modern"');
});

test('every cpr-class-features-2024 entry WITH MACROS declares 2024 rules', () => {
    // Scoped to macro-bearing entries on purpose. 45 of this pack's 246 entries carry no rules at
    // all (Wizard, Fighter, Circle of Stars — the class/subclass container items rather than
    // automations), which is upstream's shape, not a defect we introduced. What matters is that
    // anything expected to RESOLVE does: getItemFromCompendium filters on
    // `system.source.rules === '2024'` for a modern lookup, so a macro-bearing entry without it is
    // unreachable — the exact failure that made all 23 maneuvers invisible in the first place.
    for (const {file, data} of classFeatureItems()) {
        if (!data.flags?.['chris-premades']?.macros) continue;
        assert.equal(data.system?.source?.rules, '2024', `${file} declares macros but can never match a modern item`);
    }
});

test('every packData _key matches its own _id', () => {
    /*
     * Caught live 2026-07-27: the three maneuver entries were derived from their legacy
     * counterparts, and changing `_id` without changing `_key` made the Foundry CLI pack them under
     * the OLD ids. Nothing errors — the pack just silently contains documents whose storage key
     * disagrees with their id. Embedded documents need the same treatment
     * (`!items.effects!<itemId>.<effectId>`); a missing one aborts the pack with the far less
     * obvious "Key cannot be null or undefined".
     */
    for (const {file, data} of [...packItems(), ...classFeatureItems()]) {
        if (!data._key) continue;
        // Assert the id half only — the collection prefix varies legitimately. These packs hold
        // `!folders!` documents (45 of them in cpr-class-features-2024, the class/subclass folders)
        // alongside `!items!`, and pinning the prefix flags every folder as broken.
        assert.equal(data._key.split('!').pop(), data._id, `${file}: _key and _id disagree`);
        for (const effect of data.effects ?? []) {
            assert.ok(effect._key, `${file}: embedded effect ${effect._id} has no _key — the pack will abort`);
            assert.equal(effect._key, `!items.effects!${data._id}.${effect._id}`, `${file}: embedded _key is wrong`);
        }
    }
});

test('the three ported maneuvers are wired end to end', () => {
    const exported = modernRegistryExports();
    for (const identifier of ['maneuversRiposte', 'maneuversGoadingAttack', 'maneuversManeuveringAttack']) {
        const entry = classFeatureItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === identifier);
        assert.ok(entry, `no cpr-class-features-2024 entry with identifier "${identifier}"`);
        assert.equal(entry.data.flags['chris-premades'].info.rules, 'modern');
        assert.ok(exported.has(identifier), `scripts/macros.js does not export ${identifier}`);
        assert.ok(entry.data.system.description.value.length > 0, `${identifier} needs its 2024 description`);
    }
});

test('the Superiority Dice driver is ported too', () => {
    /*
     * The maneuvers are inert without it. CPR does not activate a maneuver from the hotbar or the
     * HUD — `superiorityDice` is an ACTOR-level midi macro on damageRollComplete that asks "perform
     * a maneuver?" after a weapon attack's damage, adds the die to THAT damage roll, and runs the
     * chosen maneuver item. Porting the maneuvers without the driver ships three items nothing calls.
     */
    const entry = classFeatureItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'superiorityDice');
    assert.ok(entry, 'no cpr-class-features-2024 entry for the superiorityDice driver');
    assert.equal(entry.data.flags['chris-premades'].info.rules, 'modern');
    assert.ok(modernRegistryExports().has('superiorityDice'), 'scripts/macros.js does not export superiorityDice');
});

test('the ally picker degrades to the dialog when Argon is absent', () => {
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    assert.match(source, /enhancedcombathud'\)\?\.active/, 'the picker must be gated on Argon being active');
    assert.match(source, /selectTargetDialog/, 'the sheet path needs the dialog fallback');
    assert.match(source, /label: genericUtils\.translate\('CHRISPREMADES\.Macros\.Maneuvers\.SelectAlly'\)/);
});

test('the ally picker reads game.user.targets, not the picker\'s return value', () => {
    /*
     * Argon's runTargetPicker resolves to a BOOLEAN (true completed / false cancelled) and leaves
     * the selection in game.user.targets. Treating the resolved value as a token collection makes
     * the branch a silent no-op — `Array.from(true)` is `[]` — so no ally is chosen, no confirmation
     * is raised and no exemption is applied, all without an error. That shipped once (2026-07-27)
     * and read as "it works" at the table because the missing OA had an unrelated cause.
     */
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    assert.match(source, /Array\.from\(game\.user\.targets\)/, 'the picked ally must come from game.user.targets');
    assert.ok(!/Array\.from\(picked/.test(source), 'the picker\'s resolved value is a boolean, not tokens');
});

test('en and it both define the ally-picker and prompt strings', () => {
    for (const lang of ['en', 'it']) {
        const data = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../lang/${lang}.json`, import.meta.url)), 'utf8'));
        const block = data.CHRISPREMADES.Macros.Maneuvers;
        for (const key of ['SelectAlly', 'NotAnAlly', 'ManeuveringTitle', 'ManeuveringPrompt', 'ManeuveringEffect']) {
            assert.ok(block[key], `${lang}.json is missing Maneuvers.${key}`);
        }
        // The prompt has to name everyone involved — the ally being asked, who chose them, and the
        // creature the exemption is against. A placeholder dropped in translation is silent.
        assert.match(block.ManeuveringTitle, /\{name\}/, `${lang}: title must name the ally`);
        for (const ph of ['{attacker}', '{enemy}']) {
            assert.ok(block.ManeuveringPrompt.includes(ph), `${lang}: prompt is missing ${ph}`);
            assert.ok(block.ManeuveringEffect.includes(ph), `${lang}: effect text is missing ${ph}`);
        }
    }
});

test('creature names in the prompt go through the name veil', () => {
    /*
     * The prompt is composed GM-side and socketed to whoever answers, so npc-name-veil's own
     * effectiveViewer() is the wrong frame — on a GM client it reports omniscient and a veiled NPC's
     * true name lands in the dialog. The viewer must be built from the ALLY token instead.
     */
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    // Strip comments first — the file names effectiveViewer() while explaining why it is wrong here,
    // and a whole-source grep would fail on its own documentation (same trap as the useBrace test).
    const code = source.replace(/\/\/.*$/gm, '');
    assert.match(code, /npc-name-veil'\)\?\.api/, 'the veil module is never consulted');
    assert.match(code, /omniscient: false, refs: \[viewerToken\]/, 'the viewer must be framed on the ally, not the GM');
    assert.ok(!/effectiveViewer\(\)/.test(code), 'effectiveViewer() resolves from the GM client and leaks');
    assert.match(source, /enemy: attackedToken \? veiledName\(/, 'the enemy name must be veiled');
    assert.match(source, /attacker: veiledName\(/, 'the attacker name must go through the same path');
});

test('the ally effect carries its own short description', () => {
    // Without one, Visual Active Effects falls back to the origin item and shows the whole feature.
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    assert.match(source, /description: genericUtils\.format\('CHRISPREMADES\.Macros\.Maneuvers\.ManeuveringEffect'/);
    assert.match(source, /ManeuveringTitle', names\)/, 'the dialog title must be the name-carrying one');
});

test('no ported maneuver claims a bare-name alias', () => {
    // The Monster Manual ships an NPC feat called "Riposte"; a bare alias would put the Battle
    // Master automation in front of it. Aliases stay in the `Maneuver: X` form DDB produces.
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    for (const bare of ["'Riposte'", "'Goading Attack'", "'Maneuvering Attack'"]) {
        assert.ok(!source.includes(`aliases: [${bare}`), `bare alias ${bare} would collide with non-maneuver items`);
    }
    assert.match(source, /aliases: \['Maneuver: Riposte'\]/);
});

test('modern Riposte does not reuse Brace\'s handler', () => {
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    // Match the BINDING, not a bare substring — the file names useBrace in a comment explaining the
    // upstream mis-binding, and a substring check would fail on its own documentation.
    const code = source.replace(/\/\/.*$/gm, '');
    assert.ok(!/macro:\s*useBrace/.test(code), 'the modern port must not inherit the upstream useBrace mis-binding');
    assert.match(source, /async function useRiposte/);
    assert.match(code, /macro:\s*useRiposte/, 'Riposte must be bound to its own handler');
    assert.match(source, /constants\.unarmedAttacks/, '2024 Riposte allows an Unarmed Strike');
});

test('Maneuvering Attack sets the GPS opportunity-attack exemption', () => {
    const path = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));
    const source = readFileSync(path, 'utf8');
    assert.match(source, /flags\.midi-qol\.oaManeuveringAttack/, 'the ally never gets the OA exemption');
    assert.match(source, /canSense\(/, '2024 reads "see OR hear"; canSee alone is the legacy gate');
});
