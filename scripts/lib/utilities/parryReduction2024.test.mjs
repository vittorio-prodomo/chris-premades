import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T81 — Parry's damage REDUCTION, and midi's reaction prompt.
 *
 * ⚠️ THE PREMISE THAT STARTED THIS WAS WRONG, and the correction is the point of the file.
 * "Parry has no offer prompt" came from reading CPR's registry and noticing the legacy `promptParry`
 * pass was never ported. Live testing showed midi ALREADY offers it: its ReactionDialog fires on
 * being hit and lists "Maneuvers: Parry". Worse, midi's default gate is *exactly* Parry's trigger —
 * `utils.ts:5508`, `if (!reactionCondition) reactionCondition = 'reaction === "isHit"'`.
 *
 * So we do NOT build a second prompt. We use midi's, move it to the trigger RAW actually names, and
 * add only the half that was genuinely missing: turning the roll into damage reduction.
 */

const packDir = fileURLToPath(new URL('../../../packData/cpr-class-features-2024/', import.meta.url));
const modernManeuvers = fileURLToPath(new URL('../../macros/2024/classFeatures/fighter/battleMaster/maneuvers.js', import.meta.url));

function byIdentifier(identifier) {
    for (const file of readdirSync(packDir).filter(f => f.startsWith('Maneuvers__') && f.endsWith('.json'))) {
        const pack = JSON.parse(readFileSync(packDir + file, 'utf8'));
        if (pack.flags['chris-premades']?.info?.identifier === identifier) return { file, pack };
    }
    return null;
}
const soleActivity = (p) => Object.values(p.system.activities)[0];
const source = () => readFileSync(modernManeuvers, 'utf8');
function handler(name) {
    const fn = source().match(new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}`))?.[0];
    assert.ok(fn, `handler ${name} not found`);
    return fn;
}
function registryEntry(identifier) {
    const entry = source().match(new RegExp(`export let ${identifier} = \\{[\\s\\S]*?\\n\\};`))?.[0];
    assert.ok(entry, `${identifier} has no registry entry`);
    return entry;
}

test('Parry rolls the reduction instead of applying healing', () => {
    /*
     * RAW: "…expend one Superiority Die to REDUCE THE DAMAGE by the number you roll plus your
     * Strength or Dexterity modifier". Slice 4a used a heal activity because the official PHB item
     * does — but the official item does it only because a static encoding cannot reduce damage, and
     * the difference bites at the boundary: at 4 HP taking 9 with a 7-point parry, reducing leaves
     * you standing at 2, healing drops you to −5 first (0 HP, Unconscious, dying) and lifts you back.
     */
    const act = soleActivity(byIdentifier('maneuversParry').pack);
    assert.equal(act.type, 'utility');
    assert.equal(act.activation?.type, 'reaction');
    assert.equal(act.healing, undefined, 'healing would apply on use and double with the reduction');
    const formula = act.roll?.formula ?? '';
    assert.match(formula, /max\(/);
    assert.match(formula, /@abilities\.str\.mod/);
    assert.match(formula, /@abilities\.dex\.mod/);
});

test('midi offers Parry on the DAMAGE trigger, which is what RAW names', () => {
    /*
     * 2024: "When another creature DAMAGES you with a melee attack roll…". midi's untouched default
     * is `isHit`, which fires before damage is known — so the player would decide blind. `isDamaged`
     * fires inside processDamageRoll with the total known and before it is applied. That is not the
     * informed-reroll problem T80 guards against: here the RAW trigger IS the damage.
     */
    const act = soleActivity(byIdentifier('maneuversParry').pack);
    assert.match(act.useConditionText ?? '', /reaction === "isDamaged"/);
});

test('Parry is applied WITHOUT a second confirmation', () => {
    // midi already asked. A CPR prompt on top would mean two dialogs for one reaction, which is the
    // whole reason this item was rebuilt rather than merged as first written.
    const fn = handler('applyParryReduction');
    assert.ok(!/confirmUseItem|dialogUtils\.confirm/.test(fn), 'midi already asked — do not ask again');
    assert.match(fn, /modifyDamageAppliedFlat\(ditem, -/);
});

test('the reduction rides the pass where the damage is still mutable', () => {
    // `targetApplyDamage` runs on midi's preTargetDamageApplication hook, which fires AFTER
    // processDamageRoll has resolved the isDamaged reaction — so the rolled total is already stashed
    // by the time this runs, and `ditem` can still be changed.
    const entry = registryEntry('maneuversParry');
    assert.match(entry, /pass: 'targetApplyDamage'/);
    assert.match(entry, /macro: applyParryReduction/);
});

test('the rolled total is stashed by Parry\'s own use and cleared when spent', () => {
    /*
     * Two passes, because the roll and the damage live in different workflows: Parry's own use knows
     * the total, the attacker's workflow owns the damage item. A stash that is not cleared would
     * silently reduce the NEXT attack too.
     */
    const stash = handler('stashParryReduction');
    /*
     * ⚠️ Reads the ACTIVITY's roll rather than rolling again. A utility activity with
     * `roll.visible: false` auto-rolls its formula, so `workflow.utilityRoll` is already there; the
     * legacy handler rolls in code only because its own activity ships an empty formula. Doing both
     * posts two identical roll cards for one parry — observed live before this was corrected.
     */
    assert.match(stash, /workflow\.utilityRoll/, 'the activity already rolled it');
    assert.ok(!/new Roll\(/.test(stash), 'rolling again duplicates the card');
    assert.equal(soleActivity(byIdentifier('maneuversParry').pack).roll?.visible, false,
        'a visible roll would be a click-to-roll button arriving after the reduction');
    assert.match(registryEntry('maneuversParry'), /pass: 'rollFinished'[\s\S]*?macro: stashParryReduction/);
    const apply = handler('applyParryReduction');
    assert.match(apply, /unsetFlag|-=parry|setFlag\([^)]*null/, 'the stash must be cleared once consumed');
});

test('a stale stash cannot leak into an unrelated attack', () => {
    // The stash is only meaningful for the damage that triggered the reaction. Guard on the pass
    // reading it exactly once and on it being scoped to a melee attack, as Parry requires.
    const apply = handler('applyParryReduction');
    assert.match(apply, /isAttackType\(workflow, 'meleeAttack'\)/, 'Parry answers melee attacks only');
});

test('midi no longer offers Riposte on a HIT', () => {
    /*
     * ⚠️ A SEPARATE PRE-EXISTING BUG, found while testing this one. midi listed "Maneuver: Riposte"
     * in the same on-hit dialog, but 2024 Riposte triggers on a MISS — it ships no condition and so
     * inherited the `isHit` default. Our own `offerRiposte` already gates the miss correctly, so
     * midi's generic offer is pure noise and would double-prompt if merely re-pointed at isMissed.
     */
    const act = soleActivity(byIdentifier('maneuversRiposte').pack);
    assert.equal(act.useConditionText, 'false', 'suppress midi\'s offer; ours is already miss-gated');
    assert.match(handler('offerRiposte'), /if \(workflow\.hitTargets\?\.has\(trigger\.token\)\) return;/);
});

test('EVERY 2024 maneuver declares in packData the pass kinds its registry registers', () => {
    /*
     * ⚠️ THE LANDMINE THIS ITEM WALKED INTO, generalised — and it caught two SHIPPED bugs.
     *
     * `events/midi.js` collects passes from `item.flags['chris-premades'].macros`: `midi.item`,
     * `midi.actor` and `item` are read separately, and a kind the packData does not list is simply
     * never collected. No error, no warning, the pass just never runs.
     *
     * Found live: Parry's new passes did nothing because Parry shipped macro-free and had no
     * `macros` block at all. Auditing the rest then showed **Rally and Evasive Footwork register the
     * §T83 `added` consumption re-pointer but never declared it** — so on a real add their die
     * consumption stays pointed at the COMPENDIUM placeholder, which is exactly the "0 of 1 usage
     * while Combat Superiority sits at 4/4" failure. It went unnoticed because the live tests called
     * `correctActivityItemConsumption` by hand.
     */
    const src = readFileSync(modernManeuvers, 'utf8');
    /*
     * Detect by PASS NAME rather than by parsing the nested literal. A lazy regex over `midi: {…}`
     * swallowed Parry's sibling `item: [...]` block and under-reported it — which is how the very
     * first version of this guard passed Parry while it was still broken. Pass names are
     * unambiguous: `created`/`itemMedkit`/`actorMunch` are only ever registered under `item`, and
     * the midi passes are named distinctly.
     */
    const registryKinds = (identifier) => {
        const entry = src.match(new RegExp(`export let ${identifier} = \\{[\\s\\S]*?\\n\\};`))?.[0];
        if (!entry) return null;
        const kinds = new Set();
        if (/pass: '(created|itemMedkit|actorMunch)'/.test(entry)) kinds.add('item');
        if (/midi: \{/.test(entry)) {
            const midiBlock = entry.slice(entry.indexOf('midi: {'));
            if (/\n\s{8}item: \[/.test(midiBlock)) kinds.add('midi.item');
            if (/\n\s{8}actor: \[/.test(midiBlock)) kinds.add('midi.actor');
        }
        return kinds;
    };
    const problems = [];
    for (const file of readdirSync(packDir).filter(f => f.startsWith('Maneuvers__') && f.endsWith('.json'))) {
        const pack = JSON.parse(readFileSync(packDir + file, 'utf8'));
        const cpr = pack.flags['chris-premades'];
        const identifier = cpr?.info?.identifier;
        const registered = registryKinds(identifier);
        if (!registered) continue;
        const declared = new Set();
        if (cpr.macros?.item) declared.add('item');
        for (const k of Object.keys(cpr.macros?.midi ?? {})) declared.add(`midi.${k}`);
        const missing = [...registered].filter(k => !declared.has(k));
        if (missing.length) problems.push(`${identifier} registers ${missing.join(', ')} but packData declares none of it`);
    }
    assert.deepEqual(problems, [], 'these passes are silently inert');
});

test('both items bumped their versions in registry and packData together', () => {
    for (const id of ['maneuversParry', 'maneuversRiposte']) {
        const registryVersion = registryEntry(id).match(/version: '([^']+)'/)?.[1];
        assert.equal(registryVersion, byIdentifier(id).pack.flags['chris-premades'].info.version,
            `${id}: isUpToDate reads the registry stamp, the medkit reads packData`);
    }
});
