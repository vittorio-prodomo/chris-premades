import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T77 guard — the beast's damage-type prompt has to say what it is asking about.
 * Both Primal Companion macros used the shared 'CHRISPREMADES.Dialog.DamageType' key
 * ("What damage type?"), which lands right after the companion-type pick with no subject.
 * They now pass their own key, so these tests assert the two halves stay in sync: the
 * macros reference the dedicated key, and en + it (the two languages we maintain) define it.
 */

const PROMPT_KEY = 'CHRISPREMADES.Macros.PrimalCompanion.DamageTypePrompt';
const SHARED_KEY = 'CHRISPREMADES.Dialog.DamageType';

const macroPaths = {
    modern: fileURLToPath(new URL('../../macros/2024/classFeatures/ranger/beastMaster/primalCompanion.js', import.meta.url)),
    legacy: fileURLToPath(new URL('../../macros/2014/classFeatures/ranger/beastMaster/primalCompanion.js', import.meta.url))
};

function lang(code) {
    const path = fileURLToPath(new URL(`../../../lang/${code}.json`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8'));
}

function promptString(code) {
    return lang(code).CHRISPREMADES?.Macros?.PrimalCompanion?.DamageTypePrompt;
}

for (const [rules, path] of Object.entries(macroPaths)) {
    test(`the ${rules} Primal Companion macro asks for the damage type with its own key`, () => {
        const source = readFileSync(path, 'utf8');
        assert.ok(source.includes(PROMPT_KEY), `${rules} macro never references ${PROMPT_KEY}`);
        assert.ok(!source.includes(SHARED_KEY), `${rules} macro still falls back to the subjectless ${SHARED_KEY}`);
    });
}

for (const code of ['en', 'it']) {
    test(`${code} defines the Primal Companion damage-type prompt`, () => {
        const prompt = promptString(code);
        assert.ok(prompt, `lang/${code}.json is missing ${PROMPT_KEY} — the dialog would render the raw key`);
        assert.notEqual(prompt, lang(code).CHRISPREMADES?.Dialog?.DamageType, `lang/${code}.json just repeats the subjectless shared string`);
    });
}

test('the prompt names the beast in both maintained languages', () => {
    assert.match(promptString('en'), /beast/i);
    assert.match(promptString('it'), /bestia/i);
});
