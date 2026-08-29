import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T77 guard — the beast's damage-type prompt has to say what it is asking about.
 * Both Primal Companion macros used the shared 'CHRISPREMADES.Dialog.DamageType' key
 * ("What damage type?"), which lands right after the companion-type pick with no subject.
 * They passed their own key instead, so this test asserts the surviving (2014) macro and
 * the en + it lang keys stay in sync. The 2024 macro was deleted (primal-companion-native
 * plan, T9): 2024 Primal Companion is rebuilt on dnd5e's native Summon activity, and its
 * damage-type prompt now lives in the dnd5e-primal-companion module (own lang keys, ported
 * verbatim from these same CHRISPREMADES strings — see that module's lang/en.json + it.json).
 * The lang keys tested below stay live because the 2014 macro still uses them.
 */

const PROMPT_KEY = 'CHRISPREMADES.Macros.PrimalCompanion.DamageTypePrompt';
const SHARED_KEY = 'CHRISPREMADES.Dialog.DamageType';

const macroPaths = {
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
