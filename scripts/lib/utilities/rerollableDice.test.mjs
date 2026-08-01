import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasSelectableDie } from './rerollableDice.mjs';

/*
 * T97 — never offer a reroll on a damage roll with no dice in it.
 *
 * Sibling of T66 (`rollUtils.hasRerollableDamage`, which gates Savage Attacker on the
 * ACTIVITY's damage parts). T66 deliberately scoped to Savage Attacker; this closes the two
 * holes it named: Heroic Inspiration's damage pass and Piercer.
 *
 * ⚠️ Why a SECOND predicate rather than reusing hasRerollableDamage: Savage Attacker rerolls
 * `workflow.damageRolls[i]` only for i < activity.damage.parts.length, so an activity-scoped
 * question is the right one there. Heroic Inspiration and Piercer both act on the EVALUATED
 * `workflow.damageRolls`, which can carry dice that no damage part declares — `bonusDamage`
 * appends a roll past `damage.parts.length` (that is the whole T93 fix). Gating those two on
 * the activity would suppress a legitimate offer on, say, an Unarmed Strike carrying an
 * appended superiority die. The roll-derived question is the accurate one.
 */

const helpers = new URL('./', import.meta.url);
const die = (faces, results) => ({faces, isDeterministic: false, results: results.map(result => ({result}))});
const flat = value => ({isDeterministic: true, number: value});
const roll = (...terms) => ({terms});

test('a damage roll containing a die can be rerolled', () => {
    assert.equal(hasSelectableDie([roll(die(6, [3]), flat(2))]), true);
});

test('a flat-damage roll offers nothing — a 2024 Unarmed Strike is `1 + @mod`', () => {
    assert.equal(hasSelectableDie([roll(flat(1), flat(3))]), false);
});

test('an APPENDED die keeps the offer even when the activity itself is flat', () => {
    // workflowUtils.bonusDamage appends a roll past damage.parts.length (T93). Heroic
    // Inspiration and Piercer can both substitute that die, so the offer is honest.
    assert.equal(hasSelectableDie([roll(flat(1)), roll(die(8, [5]))]), true);
});

test('a die term that rolled nothing is not selectable', () => {
    assert.equal(hasSelectableDie([roll(die(6, []))]), false);
});

test('no damage rolls at all means nothing to select', () => {
    assert.equal(hasSelectableDie([]), false);
    assert.equal(hasSelectableDie(null), false);
    assert.equal(hasSelectableDie(undefined), false);
});

test('fails OPEN on a shape it does not recognise, rather than deleting a feature', () => {
    assert.equal(hasSelectableDie('not a roll list'), true);
    assert.equal(hasSelectableDie({terms: []}), true);
});

test('a roll with no usable terms contributes nothing but does not throw', () => {
    assert.equal(hasSelectableDie([{}, roll(flat(2))]), false);
    assert.equal(hasSelectableDie([{}, roll(die(4, [1]))]), true);
});

/*
 * Source guards. Both call sites raise a checkbox dialog built from the same non-deterministic
 * terms this predicate counts, so an empty list is a dialog with nothing in it — and for
 * Heroic Inspiration, accepting it used to throw (`selection[0]` is undefined on an empty
 * array, and `[]` is truthy so the existing `if (!selection) return` never caught it).
 */

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Body of a named function declaration, up to the first line that closes it at column 0. */
function functionBody(source, name) {
    const start = source.indexOf('function ' + name);
    assert.notEqual(start, -1, name + ' no longer exists — this guard is testing nothing');
    const end = source.indexOf('\n}', start);
    return source.slice(start, end === -1 ? undefined : end);
}

test('selectDie refuses to raise a dialog with no dice in it', () => {
    const source = stripComments(readFileSync(fileURLToPath(new URL('./dialogUtils.js', helpers)), 'utf8'));
    assert.match(
        source,
        /import\s*\{[^}]*hasSelectableDie[^}]*\}\s*from\s*'\.\/rerollableDice\.mjs'/,
        'dialogUtils must import the shared predicate rather than re-deriving it'
    );
    const body = functionBody(source, 'selectDie');
    const gate = body.indexOf('hasSelectableDie');
    const dialog = body.search(/DialogApp\.dialog|socket\.executeAsUser/);
    assert.ok(gate !== -1, 'selectDie no longer gates on hasSelectableDie (T97)');
    assert.ok(
        dialog !== -1 && gate < dialog,
        'the gate must run BEFORE the dialog is raised — after it, the offer has already been made'
    );
});

test('Piercer refuses to offer a substitution when no die was rolled', () => {
    // The 2024 Piercer spreads this same object (`2024/feats/piercer.js`), so gating here
    // covers both rulesets.
    const source = stripComments(
        readFileSync(fileURLToPath(new URL('../../macros/2014/feats/piercer.js', helpers)), 'utf8')
    );
    assert.match(
        source,
        /import\s*\{[^}]*hasSelectableDie[^}]*\}\s*from\s*'[^']*rerollableDice\.mjs'/,
        'piercer must import the shared predicate rather than re-deriving it'
    );
    const body = functionBody(source, 'damageReroll');
    const gate = body.indexOf('hasSelectableDie');
    const dialog = body.indexOf('DialogApp.dialog');
    assert.ok(gate !== -1, 'Piercer no longer gates on hasSelectableDie (T97)');
    assert.ok(
        dialog !== -1 && gate < dialog,
        'the gate must run BEFORE Piercer raises its reroll dialog'
    );
});
