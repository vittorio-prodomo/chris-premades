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
 * ⚠️ The four upstream dangling identifiers this list used to pin (found 2026-08-03 by the guard
 * below, resolved 2026-08-25 as queue T124) are gone, each by what the 2024 rules actually say:
 *
 *   Warding Bond      — the Dismiss activity was RESTORED from the 2014 donor (same id, so the
 *                       entry's own hiddenActivities/spellActivities/unhide wiring all light up
 *                       again) and the 2024 macro re-binds the dismiss passes.
 *   Compelled Duel    — `compelledDuelMoved` REMOVED as copy residue: the 2024 spell has no
 *                       moved-save ("can't willingly move" — the 2024 targetMoved confirms
 *                       willingness and teleports back, no roll), so nothing consumes it.
 *   Summon Dragon     — Metallic/Gem REMOVED as copy residue: the 2024 reissue has ONE Draconic
 *                       Spirit with a chosen resistance (acid/cold/fire/lightning/poison); the
 *                       2024 macro has no variant dispatch.
 *
 * The list stays so a NEW dangling pair still fails loudly and gets an entry here or a fix.
 */
const KNOWN_UPSTREAM_DANGLING = [];

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
    // T123 REOPEN (2026-08-24, caught at the table): the official text has THREE modes and the
    // 08-03 port shipped two — Read Thoughts was missing entirely.
    assert.equal(named(cpr.activityIdentifiers.readThoughts), 'Read Thoughts');
    const read = activities[cpr.activityIdentifiers.readThoughts];
    assert.equal(read.type, 'utility', 'no save, no attack — reading just happens');
    assert.equal(read.target.affects.count, '1');
    assert.equal(read.target.affects.type, 'creature');
    assert.equal(read.range.value, '30', 'one creature within 30 feet, unlike Sense (self)');
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

test('Probe Deeper is hidden until a read activates it', () => {
    /*
     * T123 REOPEN: the 08-03 port hid nothing, reading "you can activate either effect" as
     * all-three-co-equal. But "either effect" is Sense/Read; Probe Deeper is only legal "as a
     * Magic action on your next turn" against a target currently being read, and offering it in
     * the cast-time midi picker let it be the first action ever taken on the spell. It is hidden
     * here, unhidden by the macro when Read Thoughts fires, and rehidden by the deleteActiveEffect
     * hook when the spell's effect goes away (the Witch Bolt sustain model).
     */
    const entry = packItems().find(i => i.data.flags?.['chris-premades']?.info?.identifier === 'detectThoughts');
    const cpr = entry.data.flags['chris-premades'];
    assert.deepEqual(cpr.hiddenActivities, ['probeDeeper']);
    // Probe can never be the cast any more, so it must not consume a slot when used mid-spell —
    // upstream shipped it spellSlot:true, silent once the usage dialog is suppressed.
    const probe = entry.data.system.activities[cpr.activityIdentifiers.probeDeeper];
    assert.equal(probe.consumption.spellSlot, false);
    // …and it must not inherit the item's concentration: an inherited duration makes a probe
    // begin a NEW concentration, whose limit-1 replacement deletes the spell's own effect.
    assert.deepEqual(probe.duration, {units: 'inst', concentration: false, override: true});
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
    // Either MODE (Sense or Read) can start the spell in 2024, so `use` is registered on both —
    // and must not create the effect twice when the caster senses first and reads afterwards.
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    assert.match(modern, /activities: \['detectThoughts', 'readThoughts'\]/);
    assert.match(modern, /effectUtils\.getEffectByIdentifier\(workflow\.actor, 'detectThoughts'\)/);
    assert.ok(!/activities: \['detectThoughts', 'probeDeeper'\]/.test(modern),
        'T123 reopen: Probe Deeper cannot open the spell — it is hidden until a read');
});

test('a Read — at cast or on a later turn — is what unlocks Probe Deeper', () => {
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    // Opened-by-Read path: the effect carries unhideActivities, so the createActiveEffect hook
    // unhides + favourites Probe Deeper and the deleteActiveEffect hook undoes both at spell end.
    assert.match(modern, /unhideActivities/);
    assert.match(modern, /activityIdentifiers: \['probeDeeper'\]/);
    assert.match(modern, /favorite: true/);
    // Opened-by-Sense path: a later Read finds the effect already created WITHOUT that flag, so it
    // must stamp the flag and do by hand what the create hook would have done.
    assert.match(modern, /setHiddenActivities/);
    assert.match(modern, /addFavorites/);
});

test('re-activating a mode on a later turn consumes nothing', () => {
    // 2024: "Until the spell ends, you can activate either effect as a Magic action on your later
    // turns" — the spell was cast ONCE. While the detectThoughts effect is up, a Sense/Read use
    // skips the usage dialog and consumes nothing (the deferred-consumption `consume = false`
    // idiom from faerie fire / magic missile, applied at preTargeting).
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    assert.match(modern, /config\.consume = false/);
    assert.match(modern, /dialog\.configure = false/);
    // ⚠️ preTargeting passes receive {trigger, activity, token, actor, config, dialog, message} —
    // there is NO workflow yet (events/midi.js:228). Destructuring `workflow` here throws into the
    // dispatcher's try/catch and the suppression silently never runs.
    assert.match(modern, /async function sustain\(\{actor, config, dialog\}\)/);
    assert.ok(!/sustain\(\{workflow/.test(modern), 'no workflow exists at preTargeting');
    /*
     * ⚠️ Caught live (2026-08-25): consumption alone is not enough. Sense/Read inherit the item's
     * concentration (their duration must stay override:false so a CAST through either starts it),
     * so a later-turn use BEGINS A NEW CONCENTRATION — whose limit-1 replacement deletes the old
     * one's dependents, i.e. the spell's own effect (the §T117 cascade). dnd5e preps
     * `concentration.begin ??= true`, so pre-setting begin:false at preTargeting is respected.
     */
    assert.match(modern, /config\.concentration \?\?= \{\}/);
    assert.match(modern, /config\.concentration\.begin = false/);
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

test('the Witch Bolt macro and packData versions agree', () => {
    /*
     * ⚠️ Not cosmetic. `itemUtils.isUpToDate` compares a `chris-premades`-sourced item against the
     * MACRO's version (`custom.getMacro(identifier, rules).version`), so a sheet copy already swapped
     * at the same version reports "Up to Date" and the Medkit's Update button never appears — a
     * packData-only fix then never reaches anyone's sheet. Bumping the macro version is what makes a
     * pack change deliverable; the pack's own `info.version` is what the swap then stamps back, so the
     * two must move together.
     */
    const macro = readFileSync(new URL('../../macros/2024/spells/witchBolt.js', import.meta.url), 'utf8');
    const doc = JSON.parse(readFileSync(
        new URL('../../../packData/cpr-spells-2024/Witch_Bolt_witchBolt2024CPR.json', import.meta.url),
        'utf8'
    ));
    const macroVersion = macro.match(/name: 'Witch Bolt',\n\s*version: '([^']+)'/)?.[1];
    assert.ok(macroVersion, 'the Witch Bolt macro declares no version');
    assert.equal(doc.flags['chris-premades'].info.version, macroVersion);
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

test('T124: Warding Bond 2024 restores the Dismiss activity the reissue dropped', () => {
    const doc = JSON.parse(readFileSync(
        new URL('../../../packData/cpr-spells-2024/Warding_Bond_9hoDcPal5ONreoSf.json', import.meta.url), 'utf8'));
    const cpr = doc.flags['chris-premades'];
    const dismiss = doc.system.activities[cpr.activityIdentifiers.wardingBondDismiss];
    assert.ok(dismiss, 'the entry declared wardingBondDismiss but shipped no such activity');
    assert.equal(dismiss.name, 'Warding Bond: Dismiss');
    assert.equal(dismiss.type, 'utility');
    assert.equal(dismiss.consumption.spellSlot, false, 'dismissing is not casting');
    // These two flags referenced the missing activity all along — with it restored they are
    // load-bearing again (hide until cast; a dismiss is a sustained roll, not a fresh cast).
    assert.ok(cpr.hiddenActivities.includes('wardingBondDismiss'));
    assert.ok(cpr.spellActivities.includes('wardingBondDismiss'));
});

test('T124: the 2024 Warding Bond macro reuses the legacy passes by REFERENCE and binds dismiss', () => {
    // Same rule as Detect Thoughts: the bundle is minified, so reuse must go through named exports.
    const legacy = readFileSync(fileURLToPath(new URL('../../macros/2014/spells/wardingBond.js', import.meta.url)), 'utf8');
    assert.match(legacy, /export \{use as wardingBondUse, dismiss as wardingBondDismissUse, early as wardingBondDismissEarly\}/);
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/wardingBond.js', import.meta.url)), 'utf8');
    assert.match(modern, /import \{wardingBondUse, wardingBondDismissUse, wardingBondDismissEarly\}/);
    // The defective local copy of use() — 2014's minus the dismiss vae/unhide block — must be gone,
    // and the dismiss passes bound (rollFinished removes the bond, preTargeting skips the dialog).
    assert.ok(!/async function use\(/.test(modern), 'the 2024 use was the 2014 one with the dismiss wiring dropped — reuse, not fork');
    assert.match(modern, /activities: \['wardingBondDismiss'\]/);
});

test('T124: Compelled Duel 2024 carries no moved-save residue', () => {
    /*
     * 2024 RAW: the target "can't willingly move to a space more than 30 feet away" — no save.
     * The 2024 targetMoved confirms willingness and teleports back; compelledDuelMoved and the
     * hiddenActivities entry pointing at it were copied from the 2014 flags and consumed by nothing.
     */
    const doc = JSON.parse(readFileSync(
        new URL('../../../packData/cpr-spells-2024/Compelled_Duel_EkzkGFHAQL86Ec0M.json', import.meta.url), 'utf8'));
    const cpr = doc.flags['chris-premades'];
    assert.deepEqual(cpr.activityIdentifiers, {compelledDuel: 'dnd5eactivity000'});
    assert.equal(cpr.hiddenActivities, undefined);
});

test('T124: Summon Dragon 2024 carries no variant residue', () => {
    // The 2024 reissue has ONE Draconic Spirit (choose acid/cold/fire/lightning/poison); the 2024
    // macro has no variant dispatch. Metallic/Gem identifiers were 2014 flag residue.
    const doc = JSON.parse(readFileSync(
        new URL('../../../packData/cpr-spells-2024/Summon_Dragon_L4K47zMyxumTGTg7.json', import.meta.url), 'utf8'));
    assert.deepEqual(doc.flags['chris-premades'].activityIdentifiers, {});
});

test('T124: the three touched spells bumped pack and macro versions together', () => {
    // ⚠️ T127: a packData change is undeliverable while the MACRO version is unchanged — equal
    // versions read "Up to Date" and the Medkit Apply is a silent no-op.
    for (const [pack, macroFile, expected] of [
        ['Warding_Bond_9hoDcPal5ONreoSf.json', '../../macros/2024/spells/wardingBond.js', '1.2.30'],
        ['Compelled_Duel_EkzkGFHAQL86Ec0M.json', '../../macros/2024/spells/compelledDuel.js', '1.2.22'],
        ['Summon_Dragon_L4K47zMyxumTGTg7.json', '../../macros/2024/spells/summonDragon.js', '1.2.33']
    ]) {
        const doc = JSON.parse(readFileSync(new URL('../../../packData/cpr-spells-2024/' + pack, import.meta.url), 'utf8'));
        assert.equal(doc.flags['chris-premades'].info.version, expected, pack);
        const macro = readFileSync(fileURLToPath(new URL(macroFile, import.meta.url)), 'utf8');
        assert.equal(macro.match(/version: '([^']+)'/)?.[1], expected, macroFile);
    }
});

test('T123 follow-up: Read Thoughts and Probe Deeper run the Argon target picker like a HUD click', () => {
    /*
     * Vittorio 2026-08-25: both arrive through the midi activity picker or the VAE button —
     * surfaces that bypass Argon's own target-picker gate — so with no target the use just failed
     * midi's requiresTargets check. The fork now mirrors the HUD behavior at dnd5e.preUseActivity
     * (the zero-footprint abort point): cancel the raw use, run Argon's picker (clearing existing
     * targets is the picker's own business, per rangepickerclear), re-invoke with a marker.
     * Cancelling the picker aborts cleanly; Argon off or its Target Picker setting off keeps the
     * old behavior.
     */
    const modern = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/detectThoughts.js', import.meta.url)), 'utf8');
    assert.match(modern, /Hooks\.on\('dnd5e\.preUseActivity'/);
    assert.match(modern, /\['readThoughts', 'probeDeeper'\]/);
    assert.match(modern, /runTargetPicker/);
    assert.match(modern, /'rangepicker'/, 'gate on the same setting the HUD button consults');
    assert.match(modern, /skipTargetPicker/, 'honour the established per-item opt-out flag');
    assert.match(modern, /detectThoughtsTargetPicked/, 'the re-invoke marker prevents a picker loop');
    assert.match(modern, /return false;/);
});
