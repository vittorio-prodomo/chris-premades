import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {protectionFromEvilAndGood} from '../../macros/2014/spells/protectionFromEvilAndGood.js';

/*
 * T126 — Protection from Evil and Good clause 1 (2026-08-03).
 *
 * Deliberately limited to the agreed happy path: a save activity whose applicable effect explicitly
 * advertises Charmed or Frightened. No-save effects, bare status applications, and conditions created
 * later by another macro are outside this handler.
 */

const PROTECTED_TYPES = ['aberration', 'celestial', 'elemental', 'fey', 'fiend', 'undead'];

function makeWorkflow({sourceType, statuses = [], riders = [], cprConditions = []}) {
    const successes = [];
    const effect = {
        changes: [],
        statuses: new Set(statuses),
        flags: {
            dnd5e: {riders: {statuses: riders}},
            'chris-premades': {conditions: cprConditions}
        }
    };
    return {
        successes,
        workflow: {
            // A real Foundry Actor document does not expose the condition-sandbox alias
            // `actor.raceOrType`; creature type lives in the system data model.
            actor: {system: {details: {type: {value: sourceType}}}},
            activity: {
                effects: [{effect}],
                applicableEffects: [effect]
            },
            saveDetails: {
                modifierTracker: {
                    modifiers: {
                        succeed: (source, label) => successes.push({source, label})
                    }
                }
            }
        }
    };
}

async function runHandler(workflow) {
    const handler = protectionFromEvilAndGood.preTargetSave;
    assert.equal(typeof handler, 'function', 'PfEG exposes no preTargetSave handler');
    await handler({workflow});
}

test('an Undead Frightened rider auto-succeeds with exact PfEG attribution', async () => {
    const {workflow, successes} = makeWorkflow({sourceType: 'undead', statuses: ['frightened']});
    await runHandler(workflow);
    assert.deepEqual(successes, [{
        source: 'protectionFromEvilAndGood',
        label: 'Protection from Evil and Good'
    }]);
});

test('a one-ability save carries the modified tracker into Midi\'s queued roll', async () => {
    const {workflow} = makeWorkflow({sourceType: 'undead', statuses: ['frightened']});
    workflow.saveDetails.rollAbilities = ['wis'];
    workflow.saveDetails.advantage = true;
    workflow.saveDetails.disadvantage = false;
    const tracker = workflow.saveDetails.modifierTracker;

    await runHandler(workflow);

    assert.deepEqual(Object.keys(workflow.saveDetails.advantageByChoice), ['wis']);
    assert.strictEqual(workflow.saveDetails.advantageByChoice.wis.tracker, tracker);
    assert.equal(workflow.saveDetails.advantageByChoice.wis.hasAdvantage, true);
    assert.equal(workflow.saveDetails.advantageByChoice.wis.hasDisadvantage, false);
});

test('each distinct tracker in an existing multi-ability choice is succeeded exactly once', async () => {
    const {workflow} = makeWorkflow({sourceType: 'undead', statuses: ['frightened']});
    const calls = {default: 0, strength: 0, dexterity: 0};
    const makeTracker = key => ({modifiers: {succeed: () => calls[key]++}});
    const strengthTracker = makeTracker('strength');
    workflow.saveDetails.modifierTracker = makeTracker('default');
    workflow.saveDetails.advantageByChoice = {
        str: {tracker: strengthTracker},
        dex: {tracker: makeTracker('dexterity')},
        con: {tracker: strengthTracker}
    };

    await runHandler(workflow);

    assert.deepEqual(calls, {default: 1, strength: 1, dexterity: 1});
});

test('a Fiend Charmed rider auto-succeeds, including dnd5e rider metadata', async () => {
    const {workflow, successes} = makeWorkflow({sourceType: 'fiend', riders: ['charmed']});
    await runHandler(workflow);
    assert.equal(successes.length, 1);
});

test('a CPR-authored Charmed effect qualifies through its explicit conditions metadata', async () => {
    const {workflow, successes} = makeWorkflow({sourceType: 'fiend', cprConditions: ['charmed']});
    await runHandler(workflow);
    assert.equal(successes.length, 1);
});

test('all six protected creature types qualify', async () => {
    for (const sourceType of PROTECTED_TYPES) {
        const {workflow, successes} = makeWorkflow({sourceType, statuses: ['charmed']});
        await runHandler(workflow);
        assert.equal(successes.length, 1, sourceType);
    }
});

test('a protected creature causing an unrelated save does not auto-succeed', async () => {
    const {workflow, successes} = makeWorkflow({sourceType: 'undead', statuses: ['poisoned']});
    await runHandler(workflow);
    assert.deepEqual(successes, []);
});

test('a Humanoid Charmed rider does not auto-succeed', async () => {
    const {workflow, successes} = makeWorkflow({sourceType: 'humanoid', statuses: ['charmed']});
    await runHandler(workflow);
    assert.deepEqual(successes, []);
});

test('missing workflow data fails closed rather than breaking someone else\'s save', async () => {
    await runHandler({});
});

test('the existing save-context handler still requests advantage', async () => {
    const [saveHandler] = protectionFromEvilAndGood.save;
    assert.equal(saveHandler.pass, 'context');
    assert.equal((await saveHandler.macro({trigger: {}})).type, 'advantage');
});

function readPack(relativePath) {
    return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

function targetMacroChange(pack) {
    const effect = pack.effects.find(i => i.flags?.['chris-premades']?.info?.identifier === 'protectionFromEvilAndGood');
    assert.ok(effect, 'PfEG pack entry has no identified applied effect');
    return effect.changes.find(i => i.key === 'flags.midi-qol.onUseMacroName');
}

test('both pack editions retain the existing attack-disadvantage rule', () => {
    const packs = [
        readPack('../../../packData/cpr-spells/Protection_from_Evil_and_Good_LAjtSpMEyIDbeOct.json'),
        readPack('../../../packData/cpr-spells-2024/Protection_from_Evil_and_Good_YLdLnvBtK8ksdXgd.json')
    ];
    for (const pack of packs) {
        const effect = pack.effects.find(i => i.flags?.['chris-premades']?.info?.identifier === 'protectionFromEvilAndGood');
        const change = effect?.changes.find(i => i.key === 'flags.midi-qol.grants.disadvantage.attack.all');
        assert.equal(change?.value, "['aberration', 'celestial', 'elemental', 'fey', 'fiend', 'undead'].includes(actor.raceOrType)");
    }
});

test('the 2014 applied effect registers the legacy target handler at preTargetSave', () => {
    const pack = readPack('../../../packData/cpr-spells/Protection_from_Evil_and_Good_LAjtSpMEyIDbeOct.json');
    assert.equal(
        targetMacroChange(pack)?.value,
        'function.chrisPremades.legacyMacros.protectionFromEvilAndGood.preTargetSave,preTargetSave'
    );
});

test('the 2024 applied effect registers the modern target handler at preTargetSave', () => {
    const pack = readPack('../../../packData/cpr-spells-2024/Protection_from_Evil_and_Good_YLdLnvBtK8ksdXgd.json');
    assert.equal(
        targetMacroChange(pack)?.value,
        'function.chrisPremades.macros.protectionFromEvilAndGood.preTargetSave,preTargetSave'
    );
});

/*
 * T129 — the clause-2 advantage prompt and the "99" display, both raised at the table 2026-08-24.
 */
const pfegMacroPath = fileURLToPath(new URL('../../macros/2014/spells/protectionFromEvilAndGood.js', import.meta.url));

test('T129: the advantage prompt is suppressed when the auto-success will fire anyway', () => {
    // Asking about advantage on a save that cannot fail is noise. Same predicate as preTargetSave,
    // keyed off the activity uuid the fork stashes on the roll config; when the activity is
    // unreachable (possession, repeat saves vs an applied effect, overtime rolls) the prompt keeps
    // its legitimate residual role — suppressed conditionally, never removed.
    const source = readFileSync(pfegMacroPath, 'utf8');
    const saveFn = source.slice(source.indexOf('async function save('), source.indexOf('const protectedCreatureTypes'));
    assert.match(saveFn, /chris-premades.*activityUuid|activityUuid/);
    assert.match(saveFn, /protectedCreatureTypes\.has\(raceOrType\(/);
    assert.match(saveFn, /activityHasProtectedCondition\(/);
});

test('T129: a forced save repaints as AUTOSUCCESS instead of the pinned 99', () => {
    const source = readFileSync(pfegMacroPath, 'utf8');
    // preTargetSave remembers who it forced; the repaint pass runs after the card is drawn.
    assert.match(source, /pfegAutoSucceeded/);
    assert.match(source, /paintAutoSuccessRow/);
    assert.match(source, /displaySaves\(false\)/);
    assert.match(source, /repaintAutoSuccess/);
});

test('T129: both edition effects wire the repaint at postTargetEffectApplication', () => {
    // ⚠️ midi's comma format ("macroName,pass") — the bracket form parses the pass as undefined.
    // postTargetEffectApplication is the target pass that fires AFTER displaySaves has drawn the
    // card; preTargetSave itself runs before the roll even exists.
    const legacy = JSON.parse(readFileSync(new URL('../../../packData/cpr-spells/Protection_from_Evil_and_Good_LAjtSpMEyIDbeOct.json', import.meta.url), 'utf8'));
    const modern = JSON.parse(readFileSync(new URL('../../../packData/cpr-spells-2024/Protection_from_Evil_and_Good_YLdLnvBtK8ksdXgd.json', import.meta.url), 'utf8'));
    const values = doc => doc.effects.flatMap(e => e.changes.filter(c => c.key === 'flags.midi-qol.onUseMacroName').map(c => c.value));
    assert.ok(values(legacy).includes('function.chrisPremades.legacyMacros.protectionFromEvilAndGood.repaintAutoSuccess,postTargetEffectApplication'), 'legacy effect misses the repaint pass');
    assert.ok(values(modern).includes('function.chrisPremades.macros.protectionFromEvilAndGood.repaintAutoSuccess,postTargetEffectApplication'), 'modern effect misses the repaint pass');
    // T127 deliverability: pack change -> versions move together, both editions + the macro.
    const macroVersion = readFileSync(pfegMacroPath, 'utf8').match(/version: '([^']+)'/)?.[1];
    assert.equal(macroVersion, '1.3.140');
    assert.equal(legacy.flags['chris-premades'].info.version, '1.3.140');
    assert.equal(modern.flags['chris-premades'].info.version, '1.3.140');
    const modernMacro = readFileSync(fileURLToPath(new URL('../../macros/2024/spells/protectionFromEvilAndGood.js', import.meta.url)), 'utf8');
    assert.match(modernMacro, /version: '1\.3\.140'/);
});

test('T129: the AUTOSUCCESS convention strings exist, en and it', () => {
    const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../../lang/en.json', import.meta.url)), 'utf8'));
    const it = JSON.parse(readFileSync(fileURLToPath(new URL('../../../lang/it.json', import.meta.url)), 'utf8'));
    for (const [lang, label] of [[en, 'AUTOSUCCESS'], [it, 'AUTOSUCCESSO']]) {
        const pfeg = lang.CHRISPREMADES.Macros.ProtectionFromEvilAndGood;
        assert.equal(pfeg.AutoSuccess, label, 'label must match the GPS house convention');
        assert.ok(pfeg.AutoSuccessReason, 'attribution reason missing');
        assert.ok(pfeg.Save, 'the reworded prompt label must still exist');
    }
    // The reworded prompt should lead with the action, not read like a lore statement.
    assert.match(en.CHRISPREMADES.Macros.ProtectionFromEvilAndGood.Save, /^Roll with advantage/);
    assert.match(it.CHRISPREMADES.Macros.ProtectionFromEvilAndGood.Save, /^Tira con vantaggio/);
});

test('T129 dedup: the forced-success attribution carries the LOCALIZED reason', () => {
    /*
     * The attribution display name is what the green tooltip row shows; with the paint no longer
     * re-appending a contained reason, this row is the single place the explanation lives — so it
     * must be the localized AutoSuccessReason, not the bare English spell name. Node-safe: under
     * plain node (these tests import the macro) game is undefined and the literal falls back.
     */
    const source = readFileSync(pfegMacroPath, 'utf8');
    assert.match(source, /globalThis\.game\?\.i18n\?\.localize\('CHRISPREMADES\.Macros\.ProtectionFromEvilAndGood\.AutoSuccessReason'\) \?\? 'Protection from Evil and Good'/);
});
