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

test('Witch Bolt ships a modern pack entry wired to the witchBolt macro', () => {
    const raw = readFileSync(
        new URL('../../../packData/cpr-spells-2024/Witch_Bolt_witchBolt2024CPR.json', import.meta.url),
        'utf8'
    );
    const doc = JSON.parse(raw);
    const cp = doc.flags['chris-premades'];

    assert.equal(doc.name, 'Witch Bolt');
    assert.equal(doc._id, 'witchBolt2024CPR');
    assert.equal(doc._key, '!items!witchBolt2024CPR');
    assert.equal(cp.info.rules, 'modern');
    assert.equal(cp.info.source, 'chris-premades');

    // ⚠️ A CPR pass is silently inert unless the item declares its KIND (T83).
    assert.deepEqual(cp.macros.midi.item, ['witchBolt']);

    // ⚠️ Identifiers live on the ITEM, not the activity — getActivityByIdentifier reads only this map.
    assert.deepEqual(cp.activityIdentifiers, {
        witchBolt: 'witchBoltAtk0000',
        witchBoltSustain: 'witchBoltSus0000'
    });

    /*
     * ⚠️ `effects.js` unhideActivities/rehideActivities BOTH bail at their `hiddenActivities` read
     * (`extensions/effects.js:99`, `:124`) — before the favourites loop — so without this key the
     * macro's `unhideActivities` + `favorite: true` block is dead code, the Sustain activity is
     * permanently visible on the sheet, and it is never favourited on cast nor un-favourited when the
     * spell ends. Call Lightning, the model this feature followed, declares `['stormBolt']`.
     */
    assert.deepEqual(cp.hiddenActivities, ['witchBoltSustain']);

    /*
     * ⚠️ `workflowUtils.isSustainedRoll` reads `spellActivities`; absent, it returns false for the
     * sustain and every "when you cast a spell" consumer (hide.js, beguilingMagic, blessedHealer,
     * improvedBlessedStrikes, sanctuary, arcaneWard) re-fires on each bonus-action sustain. RAW,
     * sustaining is not casting. Same shape as Detect Thoughts' `probeDeeper`.
     */
    assert.deepEqual(cp.spellActivities, ['witchBoltSustain']);

    const attack = doc.system.activities.witchBoltAtk0000;
    const sustain = doc.system.activities.witchBoltSus0000;

    // Defect 1: an empty string means "auto-detect", which adopts the sustain activity as Other Damage.
    assert.equal(attack.otherActivityId, 'none');
    assert.equal(attack.type, 'attack');
    assert.deepEqual(attack.damage.parts[0].scaling, {mode: 'whole', number: 1, formula: ''});
    assert.equal(attack.damage.parts[0].number, 2);
    assert.equal(attack.damage.parts[0].denomination, 12);
    assert.deepEqual(attack.effects, [{_id: 'witchBoltEff0000'}]);

    assert.equal(sustain.type, 'damage');
    assert.equal(sustain.activation.type, 'bonus');
    assert.equal(sustain.consumption.spellSlot, false);
    assert.equal(sustain.damage.parts[0].number, 1);
    assert.equal(sustain.damage.parts[0].denomination, 12);
    // RAW: only the INITIAL damage scales with slot level.
    assert.equal(sustain.damage.parts[0].scaling.mode, '');

    // Defect 2: rounds:1 expires one round in, and its deletion takes the concentration with it.
    const effect = doc.effects.find((e) => e._id === 'witchBoltEff0000');
    assert.equal(effect.name, 'Sustained Lightning');
    assert.equal(effect.duration.rounds, null);
    assert.equal(effect.duration.turns, null);
    assert.equal(effect.duration.seconds, 60);
    assert.equal(effect._key, '!items.effects!witchBolt2024CPR.witchBoltEff0000');

    // The target-side watchers ride on the applied effect, declared here rather than stamped at
    // runtime. ⚠️ getRules defaults to 'legacy' for effects, so the rules key is not optional.
    assert.equal(effect.flags['chris-premades'].rules, 'modern');
    assert.deepEqual(effect.flags['chris-premades'].macros, {
        movement: ['witchBoltTarget'],
        effect: ['witchBoltTarget']
    });

    /*
     * The macro has to find this effect on the target from BOTH routes — the one midi applies on a hit
     * and the one the macro applies itself after a miss — to link it to concentration exactly once.
     * An identifier on the packData effect is what makes `effectUtils.getEffectByIdentifier` work for
     * both, and is the established shape (100 packData effects declare `info.identifier`).
     */
    assert.equal(effect.flags['chris-premades'].info.identifier, 'witchBoltTarget');
});

test('the Witch Bolt macro binds the target effect to concentration and covers the miss case', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');

    // Finding 4: DAE sets only `origin`; dnd5e's getDependents() is dependentOn-driven, so the link
    // to the caster's concentration has to be made explicitly or a concentration-side end orphans the
    // target's effect. Same fix as GPS's entangle2024.js.
    assert.match(source, /MidiQOL\.addConcentrationDependent\(/);

    // Finding 6: midi applies an attack activity's effects to hitTargets only, but the sustain works
    // "even if the first attack missed" — so the miss path must apply the target effect itself, built
    // from the item's own effect so the packData flags survive.
    assert.match(source, /getEffectByIdentifier\(target\.actor, 'witchBoltTarget'\)/);
    assert.match(source, /applicableEffects/);
    assert.match(source, /witchBoltEff0000/);
});

test('the sustain offer degrades gracefully when gambits-premades is absent', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');

    // Finding 5: GPS is not in module.json's relationships.requires, and an undefined socket result
    // reads as a decline — indistinguishable from the player saying no. Fall back to CPR's own remote
    // -capable confirm, and say so out loud so "no offer appeared" is diagnosable.
    assert.match(source, /dialogUtils\.confirm\(title, 'CHRISPREMADES\.Macros\.WitchBolt\.Sustain', \{userId\}\)/);
    assert.match(source, /console\.warn\(/);
});

test('the caster token is resolved from the uuid stashed at cast time, not re-derived', () => {
    const source = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');

    // `getActiveTokens()[0]` picks an arbitrary token for a linked actor with several on the scene,
    // which measures range from the wrong body. Warding Bond stashes `bondUuid` for the same reason.
    assert.match(source, /casterTokenUuid: workflow\.token\?\.document\.uuid/);
    // Exactly one remaining getActiveTokens CALL (comments explaining why it is a last resort do not
    // count): the fallback inside resolveCasterToken, reached only when neither the dispatcher nor the
    // stashed uuid yields a token.
    const calls = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
        .filter((line) => line.includes('getActiveTokens'));
    assert.deepEqual(calls.map((l) => l.trim()), [
        'return stashed?.object ?? sourceEffect.parent?.getActiveTokens?.()[0];'
    ]);
});
